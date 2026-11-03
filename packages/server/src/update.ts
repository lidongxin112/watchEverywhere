import fs from 'node:fs';
import path from 'node:path';

/**
 * 版本 / 更新检查 / 公告
 *
 * 分发方式：把打好的安装包放到自己的服务器（或 GitHub Releases），
 * 再放一份 latest.json，客户端启动或点“检查更新”时拉这份清单比对版本号。
 *
 * latest.json 格式：
 * {
 *   "version": "0.2.0",
 *   "publishedAt": "2026-11-10",
 *   "notes": "修复 xxx；新增 xxx",
 *   "platforms": {
 *     "mac-arm64":  { "url": "https://…/watchEverywhere-mac-arm64.zip",  "size": 123 },
 *     "mac-x64":    { "url": "https://…/watchEverywhere-mac-x64.zip",    "size": 123 },
 *     "win-x64":    { "url": "https://…/watchEverywhere-win-x64.exe",    "size": 123 }
 *   }
 * }
 */

declare const __APP_VERSION__: string | undefined;

function readVersion(): string {
  const injected = (globalThis as any).__WE_VERSION__;
  if (typeof injected === 'string' && injected) return injected;
  if (process.env.WE_VERSION) return process.env.WE_VERSION;
  try {
    // 开发态：从仓库根 package.json 读
    const here = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
    for (const rel of ['../../../package.json', '../../package.json', '../package.json', './package.json']) {
      const file = path.resolve(here, rel);
      if (fs.existsSync(file)) {
        const v = JSON.parse(fs.readFileSync(file, 'utf8')).version;
        if (v) return String(v);
      }
    }
  } catch {
    /* ignore */
  }
  return '0.0.0';
}

export const APP_VERSION = readVersion();

/** 每次调用时读环境变量，方便测试/运行时改配置 */
const updateUrl = () => process.env.WE_UPDATE_URL || '';
const noticeUrl = () => process.env.WE_NOTICE_URL || '';


export type Platform = 'mac-arm64' | 'mac-x64' | 'win-x64' | 'linux-x64';

/** 是否运行在单文件可执行程序里（SEA / pkg） */
export function isStandalone(): boolean {
  if ((process as any).pkg) return true;
  try {
    const sea = require('node:sea');
    return typeof sea.isSea === 'function' ? sea.isSea() : false;
  } catch {
    return false;
  }
}

export function detectPlatform(): Platform {
  const arch = process.arch;
  if (process.platform === 'darwin') return arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  if (process.platform === 'win32') return 'win-x64';
  return 'linux-x64';
}

/** 比较 a/b 版本号：a>b 返回 1，相等 0，小于 -1（忽略前缀 v 和预发布后缀） */
export function compareVersion(a: string, b: string): number {
  const norm = (v: string) =>
    String(v)
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
  const x = norm(a);
  const y = norm(b);
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export interface UpdateInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
  notes?: string;
  publishedAt?: string;
  url?: string;
  size?: number;
  /** 安装包 sha256（清单里带就校验） */
  sha256?: string;
  platform: Platform;
  checkedAt: number;
  error?: string;
}

let cache: { at: number; data: UpdateInfo } | null = null;
const TTL = 30 * 60 * 1000;

export async function checkUpdate(force = false): Promise<UpdateInfo> {
  const platform = detectPlatform();
  const base: UpdateInfo = {
    current: APP_VERSION,
    latest: APP_VERSION,
    hasUpdate: false,
    platform,
    checkedAt: Date.now()
  };
  const url = updateUrl();
  if (!url) return { ...base, error: '未配置 WE_UPDATE_URL' };
  if (!force && cache && Date.now() - cache.at < TTL) return cache.data;

  try {
    const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: any = await res.json();
    const latest = String(json.version || '0');
    const p = (json.platforms || {})[platform] || {};
    const data: UpdateInfo = {
      ...base,
      latest,
      hasUpdate: compareVersion(latest, APP_VERSION) > 0,
      notes: json.notes,
      publishedAt: json.publishedAt,
      url: p.url,
      size: p.size,
      sha256: p.sha256
    };
    cache = { at: Date.now(), data };
    return data;
  } catch (e: any) {
    return { ...base, error: String(e?.message || e) };
  }
}

/** 远程公告（可选）：推送一句话通知给所有客户端 */
export async function fetchNotices(): Promise<any[]> {
  const url = noticeUrl();
  if (!url) return [];
  try {
    const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) return [];
    const json = await res.json();
    const list = Array.isArray(json) ? json : json.notices || [];
    return list.slice(0, 20);
  } catch {
    return [];
  }
}

/** 桌面版：把内置的 web 产物目录指给 PUBLIC_DIR 用 */
export function resolveBundledPublic(dirname: string): string {
  const candidate = path.join(dirname, 'public');
  return fs.existsSync(candidate) ? candidate : '';
}
