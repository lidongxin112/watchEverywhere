import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Koa from 'koa';
import Router from '@koa/router';
import { bodyParser } from '@koa/bodyparser';
import cors from '@koa/cors';
import { friendlyMessage } from '@watch-everywhere/core';
import { routes } from './api';
import { DATA_DIR } from './store';
import { flushAll } from './db';
import { ensureBuiltinSource, liveSourcesStore, registerLiveProxy } from './live';
import { registerMediaProxy } from './media';
import { registerAiStream } from './ai';
import { startSubscriptionScheduler } from './subscription';
import { startWatchScheduler } from './watch';
import { pushLog } from './logs';
import { selfHealRules } from './self-heal';
import { repairResources } from './repair';
import { startIptv, stopIptv } from './iptv';

/** 打包成单文件可执行程序后 __dirname 由 CJS 提供；开发态用 import.meta.url */
const HERE = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
/** 前端构建产物目录（packages/web 构建输出到这里；桌面版用 WE_PUBLIC_DIR 指到内置资源） */
export const PUBLIC_DIR = process.env.WE_PUBLIC_DIR || path.resolve(HERE, '../public');

const DISCONNECT_CODES = new Set(['ECONNRESET', 'EPIPE', 'ECONNABORTED', 'ERR_STREAM_PREMATURE_CLOSE', 'ERR_STREAM_DESTROYED', 'ERR_CANCELED']);

/** 连接被对方（播放器或上游）中途断开 */
export function isDisconnectError(err: any) {
  return DISCONNECT_CODES.has(err?.code) || /aborted|socket hang up/i.test(err?.message || '');
}

export function createServer() {
  const app = new Koa();
  const router = new Router({ prefix: '/api' });

  for (const [route, handler] of Object.entries(routes)) {
    router.post(`/${route}`, async (ctx) => {
      const args = (ctx.request as any).body || {};
      const start = Date.now();
      try {
        const data = await handler(args);
        ctx.body = { code: 0, data, msg: '' };
      } catch (err) {
        const msg = friendlyMessage(err);
        pushLog('error', route, msg);
        console.warn(`[api] ${route} 失败: ${msg}`);
        ctx.body = { code: -1, data: null, msg };
      } finally {
        if (process.env.WE_DEBUG) console.log(`[api] ${route} ${Date.now() - start}ms`);
      }
    });
  }

  // 直播播放代理（GET，返回清单 / 视频流）
  registerLiveProxy(router);
  registerMediaProxy(router);
  // AI 问片：流式对话
  registerAiStream(router);
  startSubscriptionScheduler();
  startWatchScheduler();

  app.use(cors());
  app.use(bodyParser({ jsonLimit: '20mb', encoding: 'utf-8' } as any));
  app.use(router.routes()).use(router.allowedMethods());

  // 内置资源（SEA 单文件版把前端产物编译进可执行文件里）
  const embedded: Record<string, string> | undefined = (globalThis as any).__WE_ASSETS__;

  // 生产环境托管前端页面（hash 路由，只需返回 index.html）
  // 用 readFileSync 自己托管：打包成单文件可执行程序后 koa-static 的流式读取不可靠
  if (embedded && Object.keys(embedded).length) {
    const MIME: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.map': 'application/json; charset=utf-8'
    };
    app.use(async (ctx, next) => {
      if (ctx.method !== 'GET' && ctx.method !== 'HEAD') return next();
      if (ctx.path.startsWith('/api/')) return next();
      const key = decodeURIComponent(ctx.path);
      const hit = embedded[key] || (/\.[a-z0-9]+$/i.test(key) ? '' : embedded['/index.html']);
      if (!hit) return next();
      ctx.type = MIME[path.extname(key).toLowerCase()] || 'text/html; charset=utf-8';
      ctx.body = Buffer.from(hit, 'base64');
      return;
    });
  } else if (fs.existsSync(PUBLIC_DIR)) {
    const MIME: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.map': 'application/json; charset=utf-8'
    };
    const indexFile = path.join(PUBLIC_DIR, 'index.html');
    app.use(async (ctx, next) => {
      if (ctx.method !== 'GET' && ctx.method !== 'HEAD') return next();
      if (ctx.path.startsWith('/api/')) return next();
      let file = path.join(PUBLIC_DIR, decodeURIComponent(ctx.path));
      if (!file.startsWith(PUBLIC_DIR)) return next();
      if (ctx.path.endsWith('/') || !path.extname(file)) file = indexFile;
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = indexFile;
      if (!fs.existsSync(file)) return next();
      ctx.type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      ctx.body = fs.readFileSync(file);
    });
  }

  // 播放器切台 / 关闭页面 / hls.js 放弃分片时会中途断开连接，属于正常现象，不打印
  app.on('error', (err: any, ctx: any) => {
    if (isDisconnectError(err)) return;
    console.error(`[server] ${ctx?.method || ''} ${ctx?.path || ''}`, err);
  });

  return app;
}

/**
 * 端口被占用时不直接崩：
 *  - 如果占用者是 watchEverywhere 自己（/api/app/info 能通），说明已经有一个实例在跑，挂起本进程即可
 *  - 否则打印一句人话再退出，避免一屏 stack
 */
async function handlePortInUse(port: number): Promise<'reuse' | 'foreign'> {
  // 先打自己的轻量探针（响应很快，不会被业务卡住）
  for (const path of ['/api/app/ping', '/api/app/info']) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(2500)
      });
      const json: any = await res.json().catch(() => null);
      if (json && json.code === 0 && (json.data?.pong || json.data?.version)) return 'reuse';
    } catch {
      /* 换下一个探针 */
    }
  }
  return 'foreign';
}

/** 谁占着这个端口？返回 PID 和命令行片段，方便用户自己处理 */
async function portOwner(port: number): Promise<{ pid: string; cmd: string } | null> {
  try {
    const { execFileSync } = await import('node:child_process');
    const pids = execFileSync('lsof', ['-ti', `:${port}`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    if (!pids.length) return null;
    const pid = pids[0];
    const cmd = execFileSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' }).trim();
    return { pid, cmd };
  } catch {
    return null;
  }
}

/** 占用者是不是 watchEverywhere（可能只是卡住了） */
function looksLikeOurs(cmd: string) {
  return /watchEverywhere|src\/run\.ts|packages\/server\/src|dist\/watchEverywhere/i.test(cmd);
}

export function start(port = Number(process.env.PORT) || 8898) {
  const app = createServer();
  const server = app.listen(port, () => {
    console.log(`\n  watchEverywhere 服务已启动`);
    console.log(`  ➜ 接口: http://localhost:${port}/api`);
    if (fs.existsSync(PUBLIC_DIR)) console.log(`  ➜ 页面: http://localhost:${port}/`);
    console.log(`  ➜ 数据目录: ${DATA_DIR}\n`);
    // 规则文件为空/损坏时用内置包自愈
    selfHealRules()
      .then(() => {
        const r = repairResources();
        if (r.favorites || r.history || r.chapterHistory) {
          console.log(`[repair] 收藏 ${r.favorites} 条、历史 ${r.history} 条、进度 ${r.chapterHistory} 条已重新绑定规则`);
        }
      })
      .catch((e) => console.warn('[self-heal] 失败', e));
    // 内置 iPTV：就绪后自动添加 / 更新「内置 iPTV」直播源
    startIptv(ensureBuiltinSource).catch((e) => console.warn('[iptv] 启动失败', e));
  });
  server.on('error', async (err: any) => {
    if (err?.code !== 'EADDRINUSE') throw err;
    const kind = await handlePortInUse(port);
    if (kind === 'reuse') {
      console.log(`\n  ⚠️  端口 ${port} 已被另一个 watchEverywhere 实例占用，直接沿用那个实例。`);
      console.log(`     要重启请先关掉它：lsof -ti:${port} | xargs kill\n`);
    } else {
      const owner = await portOwner(port);
      if (owner && looksLikeOurs(owner.cmd)) {
        console.error(`\n  ⚠️  端口 ${port} 被「之前启动的 watchEverywhere」占着，但它没响应（可能卡住了）。`);
        console.error(`     结束它再启动：kill ${owner.pid}   （强制：kill -9 ${owner.pid}）`);
        console.error(`     或者让新实例换端口：PORT=8899 npm run dev:server\n`);
      } else {
        console.error(`\n  ✗ 端口 ${port} 被其他程序占用${owner ? `（PID ${owner.pid}：${owner.cmd.slice(0, 80)}）` : ''}。`);
        console.error(`     换个端口再启动：PORT=8899 npm run dev:server`);
        if (owner) console.error(`     或者结束占用进程：kill ${owner.pid}`);
        console.error('');
      }
      process.exit(1);
    }
    // 让进程活着（dev 下 concurrently -k 不会因为本进程退出而杀掉 web）
    setInterval(() => {}, 1 << 30);
  });

  let exiting = false;
  const exit = async () => {
    if (exiting) return;
    exiting = true;
    flushAll();
    liveSourcesStore.flush();
    await stopIptv();
    process.exit(0);
  };
  process.on('SIGINT', exit);
  process.on('SIGTERM', exit);
  return server;
}
