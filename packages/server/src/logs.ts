import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 诊断日志
 *
 * - 内存里保留最近 300 条（快）
 * - 同时追加到 ~/.watch-everywhere/logs/app.log（JSONL，重启不丢）
 * - 单文件超过 2MB 自动切一份 .1
 * 导出诊断时两份一起带上，方便排查“偶发播不了”。
 */

export interface LogRow {
  time: number;
  level: 'info' | 'warn' | 'error';
  scope: string;
  message: string;
  /** 附带数据（播放地址、hls 错误详情等），会做长度截断 */
  extra?: Record<string, any>;
}

const MAX = 300;
const MAX_FILE = 2 * 1024 * 1024;
const DATA_DIR = process.env.WE_DATA_DIR || path.join(os.homedir(), '.watch-everywhere');
const LOG_DIR = path.join(DATA_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');

const rows: LogRow[] = [];

function trimExtra(extra?: Record<string, any>) {
  if (!extra) return undefined;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(extra)) {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    out[k] = s && s.length > 500 ? s.slice(0, 500) + '…' : s;
  }
  return out;
}

function rotateIfNeeded() {
  try {
    const st = fs.statSync(LOG_FILE);
    if (st.size > MAX_FILE) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
  } catch {
    /* 文件还不存在 */
  }
}

export function pushLog(level: LogRow['level'], scope: string, message: string, extra?: Record<string, any>) {
  const row: LogRow = { time: Date.now(), level, scope, message: String(message).slice(0, 800), extra: trimExtra(extra) };
  rows.push(row);
  if (rows.length > MAX) rows.splice(0, rows.length - MAX);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    rotateIfNeeded();
    fs.appendFileSync(LOG_FILE, JSON.stringify(row) + '\n');
  } catch {
    /* 写不了就只留内存 */
  }
}

export function getLogs(): LogRow[] {
  return [...rows];
}

/** 从磁盘取最近 n 条（跨重启） */
export function readPersistedLogs(n = 200): LogRow[] {
  const out: LogRow[] = [];
  for (const file of [LOG_FILE + '.1', LOG_FILE]) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const lines = text.trim().split('\n').slice(-n);
      for (const line of lines) {
        try {
          out.push(JSON.parse(line));
        } catch {
          /* 跳过坏行 */
        }
      }
    } catch {
      /* 文件不存在 */
    }
  }
  return out.sort((a, b) => a.time - b.time).slice(-n);
}

export function clearLogs() {
  rows.length = 0;
  try {
    fs.rmSync(LOG_FILE, { force: true });
    fs.rmSync(LOG_FILE + '.1', { force: true });
  } catch {
    /* ignore */
  }
}
