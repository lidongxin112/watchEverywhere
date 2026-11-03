/**
 * 内置 iPTV（https://github.com/akiralereal/iptv）进程管理
 *
 * watchEverywhere 启动时把 vendor/iptv 作为子进程拉起，并自动添加「内置 iPTV」直播源，
 * 不需要再单独用 Docker 部署。iPTV 意外退出会自动重启，watchEverywhere 退出时一起关闭。
 *
 * 环境变量：
 *   WE_IPTV=0          不启动内置 iPTV
 *   WE_IPTV_PORT=1905  iPTV 端口
 *   WE_IPTV_DIR=...    iPTV 代码目录（默认 <项目>/vendor/iptv）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import axios from 'axios';
import { DATA_DIR } from './store';

// 打包成单文件可执行程序后 __dirname 由 CJS 提供；开发态回退到 import.meta.url
const HERE = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
export const IPTV_DIR = process.env.WE_IPTV_DIR || path.resolve(HERE, '../../../vendor/iptv');
export const IPTV_DATA_DIR = path.join(DATA_DIR, 'iptv');
export const BUILTIN_SOURCE_ID = 'builtin-iptv';

export interface IptvStatus {
  enabled: boolean;
  installed: boolean;
  /** managed: 由 watchEverywhere 启动；external: 端口上已有 iPTV（如 Docker） */
  mode: 'managed' | 'external' | 'none';
  state: 'stopped' | 'starting' | 'running' | 'error';
  port: number;
  pass: string;
  adminPath: string;
  error: string;
  restarts: number;
  logs: string[];
}

const status: IptvStatus = {
  enabled: process.env.WE_IPTV !== '0',
  installed: false,
  mode: 'none',
  state: 'stopped',
  port: Number(process.env.WE_IPTV_PORT) || 1905,
  pass: '',
  adminPath: 'admin',
  error: '',
  restarts: 0,
  logs: []
};

let child: ChildProcess | null = null;
let stopping = false;
let onReady: (() => void) | null = null;

const tag = '\x1b[35m[iptv]\x1b[0m';

/** iPTV 自己的系统配置（后台改过端口 / 访问密码 / 后台路径时要跟着变） */
function readIptvConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(IPTV_DATA_DIR, 'system-config.json'), 'utf8'));
    const p = parseInt(cfg.port);
    if (Number.isInteger(p) && p > 0 && p < 65536) status.port = p;
    status.pass = String(cfg.pass || '').trim();
    status.adminPath = String(cfg.adminPath || 'admin').replace(/^\/+|\/+$/g, '') || 'admin';
  } catch {
    /* 第一次启动还没有配置文件 */
  }
}

/** 订阅地址（带访问密码路径） */
export function iptvPlaylistUrl() {
  readIptvConfig();
  return `http://127.0.0.1:${status.port}/${status.pass ? `${encodeURIComponent(status.pass)}/` : ''}interface.m3u`;
}

async function alive() {
  try {
    await axios.get(`http://127.0.0.1:${status.port}/`, { timeout: 2000, validateStatus: () => true, maxRedirects: 0 });
    return true;
  } catch (e: any) {
    // 有 HTTP 响应（哪怕 4xx/5xx）都说明服务在
    return !!e?.response;
  }
}

function pushLog(line: string) {
  status.logs.push(line);
  if (status.logs.length > 200) status.logs.splice(0, status.logs.length - 200);
  // 默认只打印关键信息，WE_DEBUG=1 时打印全部
  if (process.env.WE_DEBUG || /error|错误|失败|异常|listen|监听|启动|running|http:\/\//i.test(line)) console.log(`${tag} ${line}`);
}

function spawnIptv() {
  fs.mkdirSync(IPTV_DATA_DIR, { recursive: true });
  status.state = 'starting';
  status.error = '';
  child = spawn(process.execPath, ['app.js'], {
    cwd: IPTV_DIR,
    env: {
      ...process.env,
      mport: String(status.port),
      mdataDir: IPTV_DATA_DIR,
      TZ: process.env.TZ || 'Asia/Shanghai'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const onData = (buf: Buffer) =>
    buf
      .toString()
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .forEach(pushLog);
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) {
      status.state = 'stopped';
      return;
    }
    status.state = 'error';
    status.error = `iPTV 已退出（code=${code}${signal ? `, signal=${signal}` : ''}）`;
    status.restarts++;
    const delay = Math.min(60, 5 * status.restarts) * 1000;
    console.warn(`${tag} ${status.error}，${delay / 1000} 秒后自动重启`);
    setTimeout(() => !stopping && spawnIptv(), delay);
  });
  waitReady();
}

async function waitReady() {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline && !stopping && (child || status.mode === 'external')) {
    if (await alive()) {
      status.state = 'running';
      console.log(`${tag} 已就绪：频道管理后台 http://localhost:${status.port}/${status.pass ? `${status.pass}/` : ''}${status.adminPath}`);
      onReady?.();
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!stopping && status.state === 'starting') {
    status.state = 'error';
    status.error = 'iPTV 启动超时，可以设置 WE_DEBUG=1 查看完整日志';
  }
}

/**
 * 启动内置 iPTV
 * @param ready 就绪后回调（用于自动添加直播源）
 */
export async function startIptv(ready: () => void) {
  onReady = ready;
  if (!status.enabled) return;
  status.installed = fs.existsSync(path.join(IPTV_DIR, 'app.js')) && fs.existsSync(path.join(IPTV_DIR, 'node_modules'));
  readIptvConfig();

  // 端口上已经有 iPTV（例如之前用 Docker 部署的），直接复用
  if (await alive()) {
    status.mode = 'external';
    status.state = 'running';
    console.log(`${tag} 检测到 ${status.port} 端口已有 iPTV 在运行，直接使用`);
    ready();
    return;
  }
  if (!status.installed) {
    status.state = 'error';
    status.error = '内置 iPTV 未安装，请在项目目录执行 npm run iptv:update';
    console.warn(`${tag} ${status.error}`);
    return;
  }
  status.mode = 'managed';
  console.log(`${tag} 正在启动内置 iPTV（端口 ${status.port}，数据目录 ${IPTV_DATA_DIR}）...`);
  // 先把直播源加上，页面能显示「正在启动」；就绪后会再同步一次地址
  ready();
  spawnIptv();
}

/** 关闭内置 iPTV（最多等 3 秒，超时强制结束） */
export function stopIptv(): Promise<void> {
  stopping = true;
  const c = child;
  if (!c || c.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (c.exitCode === null) c.kill('SIGKILL');
      resolve();
    }, 3000);
    c.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    c.kill('SIGTERM');
  });
}

export function getIptvStatus(): IptvStatus {
  readIptvConfig();
  return { ...status, logs: status.logs.slice(-50) };
}
