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

  app.use(cors());
  app.use(bodyParser({ jsonLimit: '20mb' }));
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

export function start(port = Number(process.env.PORT) || 8898) {
  const app = createServer();
  const server = app.listen(port, () => {
    console.log(`\n  watchEverywhere 服务已启动`);
    console.log(`  ➜ 接口: http://localhost:${port}/api`);
    if (fs.existsSync(PUBLIC_DIR)) console.log(`  ➜ 页面: http://localhost:${port}/`);
    console.log(`  ➜ 数据目录: ${DATA_DIR}\n`);
    // 内置 iPTV：就绪后自动添加 / 更新「内置 iPTV」直播源
    startIptv(ensureBuiltinSource).catch((e) => console.warn('[iptv] 启动失败', e));
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
