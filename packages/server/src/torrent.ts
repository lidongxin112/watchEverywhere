import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import { pushLog } from './logs';

/**
 * 磁力在线播放（服务端边下边播）
 *
 * 浏览器播不了种子里的 mkv，所以这里分两步：
 *   1. torrent-stream 打开磁力，按需拉取分片（只下正在看的那部分）
 *   2. mp4/webm 直接给 <video>；mkv 先用 ffmpeg 无损转封装成 fMP4 再流出去
 *
 * 引擎按 infoHash 缓存，闲置 10 分钟自动关闭。
 */

const DATA_DIR = process.env.WE_DATA_DIR || path.join(os.homedir(), '.watch-everywhere');
const CACHE_DIR = path.join(DATA_DIR, 'torrent-cache');
const IDLE_MS = 10 * 60_000;
const MAX_ENGINES = 3;

export interface TorrentFile {
  index: number;
  name: string;
  length: number;
  /** 能不能直接在浏览器里播 */
  playable: boolean;
  kind: 'video' | 'audio' | 'other';
}

interface Session {
  engine: any;
  magnet: string;
  infoHash: string;
  files: TorrentFile[];
  lastUsed: number;
  ready: boolean;
}

const sessions = new Map<string, Session>();

function ensureDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function fileKind(name: string): { playable: boolean; kind: TorrentFile['kind'] } {
  const n = name.toLowerCase();
  if (/\.(mp4|m4v|webm)$/.test(n)) return { playable: true, kind: 'video' };
  if (/\.(mkv|avi|mov|wmv|flv|ts|rmvb)$/.test(n)) return { playable: false, kind: 'video' };
  if (/\.(mp3|flac|m4a|aac|wav|ogg)$/.test(n)) return { playable: true, kind: 'audio' };
  return { playable: false, kind: 'other' };
}

function toFiles(files: any[]): TorrentFile[] {
  return files.map((f: any, i: number) => {
    const { playable, kind } = fileKind(f.name);
    return { index: i, name: f.name, length: f.length, playable, kind };
  });
}

async function evictIfNeeded() {
  const now = Date.now();
  for (const [hash, s] of sessions) {
    if (now - s.lastUsed > IDLE_MS) {
      try {
        s.engine.destroy();
      } catch {
        /* ignore */
      }
      sessions.delete(hash);
    }
  }
  if (sessions.size <= MAX_ENGINES) return;
  const oldest = [...sessions.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
  if (oldest) {
    try {
      oldest[1].engine.destroy();
    } catch {
      /* ignore */
    }
    sessions.delete(oldest[0]);
  }
}

/** 打开磁力（或种子地址），返回文件列表 */
export async function openTorrent(magnet: string): Promise<{ infoHash: string; files: TorrentFile[]; name: string }> {
  const src = String(magnet || '').trim();
  if (!/^magnet:\?/i.test(src) && !/^https?:\/\/.+\.torrent$/i.test(src)) {
    throw new Error('需要 magnet:? 或 .torrent 地址');
  }
  ensureDir();
  await evictIfNeeded();

  // 复用已有会话
  for (const [hash, s] of sessions) {
    if (s.magnet === src) {
      s.lastUsed = Date.now();
      return { infoHash: hash, files: s.files, name: '' };
    }
  }

  // torrent-stream 没有类型声明
  const mod: any = await import('torrent-stream' /* @vite-ignore */).catch(() => null);
  const torrentStream = (mod?.default || mod) as any;
  const engine = torrentStream(src, {
    path: CACHE_DIR,
    tmp: CACHE_DIR,
    connections: 60,
    dht: true,
    tracker: true,
    verify: false
  });

  const info = await new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('连接磁力超时（没有找到 peer，可能需要代理或种子已无人做种）')), 45_000);
    engine.once('ready', () => {
      clearTimeout(timer);
      resolve({ infoHash: engine.infoHash, files: engine.files });
    });
    engine.once('error', (e: any) => {
      clearTimeout(timer);
      reject(e);
    });
  });

  const files = toFiles(info.files as any[]);
  const infoHash = String(info.infoHash || '');
  sessions.set(infoHash, { engine, magnet: src, infoHash, files, lastUsed: Date.now(), ready: true });
  pushLog('info', 'torrent/open', `打开磁力 ${infoHash.slice(0, 12)}… 共 ${files.length} 个文件`);
  return { infoHash, files, name: (info.files as any[])[0]?.name || '' };
}

export function getSession(infoHash: string): Session | undefined {
  const s = sessions.get(infoHash);
  if (s) s.lastUsed = Date.now();
  return s;
}

export function closeTorrent(infoHash: string) {
  const s = sessions.get(infoHash);
  if (!s) return false;
  try {
    s.engine.destroy();
  } catch {
    /* ignore */
  }
  sessions.delete(infoHash);
  return true;
}

export interface StreamResult {
  stream: Readable;
  size: number;
  mime: string;
  /** 是否是转封装出来的流（mkv → fMP4） */
  transcoded: boolean;
}

/** 取某个文件的字节流（支持 range） */
export function streamTorrentFile(
  infoHash: string,
  index: number,
  range?: { start: number; end: number }
): StreamResult {
  const s = getSession(infoHash);
  if (!s) throw new Error('磁力会话不存在或已过期，请重新打开');
  const file = s.engine.files[index];
  if (!file) throw new Error('文件不存在');

  const start = range?.start ?? 0;
  const end = range?.end ?? file.length - 1;
  const size = end - start + 1;
  const name = String(file.name || '').toLowerCase();

  // mkv / avi 等：用 ffmpeg 转封装成 fMP4（只转容器，不重编码）
  if (/\.(mkv|avi|mov|wmv|flv|rmvb)$/.test(name)) {
    const input = file.createReadStream({ start, end });
    const ff = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-c', 'copy',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-f', 'mp4',
      'pipe:1'
    ]);
    input.pipe(ff.stdin);
    input.on('error', () => ff.kill('SIGKILL'));
    ff.on('error', (e) => pushLog('warn', 'torrent/ffmpeg', `ffmpeg 启动失败：${e.message}`));
    return { stream: ff.stdout as Readable, size, mime: 'video/mp4', transcoded: true };
  }

  const mime = /\.mp4$/.test(name)
    ? 'video/mp4'
    : /\.webm$/.test(name)
      ? 'video/webm'
      : /\.(mp3)$/.test(name)
        ? 'audio/mpeg'
        : /\.(m4a|aac)$/.test(name)
          ? 'audio/mp4'
          : /\.flac$/.test(name)
            ? 'audio/flac'
            : 'application/octet-stream';

  return { stream: file.createReadStream({ start, end }) as Readable, size, mime, transcoded: false };
}

/** 当前会话的下载进度（给前端显示缓冲状态） */
export function torrentStatus(infoHash: string) {
  const s = getSession(infoHash);
  if (!s) return null;
  const engine = s.engine;
  const progress = typeof engine.progress === 'number' ? engine.progress : 0;
  const peers = (engine.swarm?.wires || []).length;
  const downloaded = engine.torrent?.downloaded ?? engine.downloaded ?? 0;
  const speed = engine.swarm?.downloadSpeed?.() ?? 0;
  return { infoHash, progress, peers, downloaded, speed, files: s.files };
}

/** 关闭所有会话（进程退出时） */
export function closeAllTorrents() {
  for (const [, s] of sessions) {
    try {
      s.engine.destroy();
    } catch {
      /* ignore */
    }
  }
  sessions.clear();
}
