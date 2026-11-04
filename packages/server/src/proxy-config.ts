import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

/**
 * 出口代理（给被墙的源用：Nyaa / 动漫花园 / ACG.RIP）
 *
 * 优先级：
 *  1. WE_PROXY，例如 http://127.0.0.1:7890 或 socks5://127.0.0.1:7890
 *  2. 数据目录下 proxy.json（{ "url": "http://127.0.0.1:7890" }）
 *  3. 自动探测常见本地端口
 */

const DATA_DIR = process.env.WE_DATA_DIR || path.join(os.homedir(), '.watch-everywhere');
const CONFIG = path.join(DATA_DIR, 'proxy.json');

const COMMON_PORTS = [7890, 7897, 1087, 1080, 8118, 6152, 8889, 10809, 20171, 10808];

export interface ProxySetting {
  url: string;
  /** 自动探测来的 */
  auto?: boolean;
}

let cached: { at: number; value: ProxySetting | null } = { at: 0, value: null };

export function readProxyConfig(): ProxySetting | null {
  if (process.env.WE_PROXY) return { url: process.env.WE_PROXY.trim() };
  try {
    const row = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    if (row?.url) return { url: String(row.url) };
  } catch {
    /* 没配置 */
  }
  return null;
}

export function saveProxyConfig(url: string) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify({ url }, null, 2));
  cached = { at: 0, value: null };
}

function portOpen(port: number, host = '127.0.0.1', timeout = 900): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeout);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

/** 探测本地常见的代理端口（只看端口是否在听，是否真的能出去由调用方验证） */
export async function detectProxy(): Promise<ProxySetting | null> {
  // 命中缓存：成功缓存 10 分钟，失败只缓存 15 秒（代理可能刚启动）
  const ttl = cached.value ? 10 * 60_000 : 15_000;
  if (cached.at && Date.now() - cached.at < ttl) return cached.value;
  for (const port of COMMON_PORTS) {
    if (await portOpen(port)) {
      const value = { url: `http://127.0.0.1:${port}`, auto: true };
      cached = { at: Date.now(), value };
      return value;
    }
  }
  cached = { at: Date.now(), value: null };
  return null;
}

export async function getProxy(): Promise<ProxySetting | null> {
  return readProxyConfig() || (await detectProxy());
}

/** axios 的 proxy 配置 */
export function axiosProxy(url: string) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80),
      protocol: u.protocol.replace(':', ''),
      ...(u.username ? { auth: { username: u.username, password: u.password } } : {})
    };
  } catch {
    return undefined;
  }
}
