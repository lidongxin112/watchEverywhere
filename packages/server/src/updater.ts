import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { APP_VERSION, detectPlatform, type UpdateInfo } from './update';

/**
 * 自动更新：下载 → 校验 → 替换
 *
 * 替换当前正在运行的可执行文件在 Windows/macOS 上都不允许，
 * 所以流程是：下载并校验 → 写一个「等待进程退出后替换并重启」的小脚本 → 主进程退出。
 * 用户点“立即重启”才会触发，不做静默替换。
 */

const DATA_DIR = process.env.WE_DATA_DIR || path.join(os.homedir(), '.watch-everywhere');
const UPDATE_DIR = path.join(DATA_DIR, 'updates');

export interface DownloadedUpdate {
  version: string;
  file: string;
  size: number;
  sha256: string;
  verified: boolean;
  downloadedAt: number;
}

function pendingFile() {
  return path.join(UPDATE_DIR, 'pending.json');
}

export function readPending(): DownloadedUpdate | null {
  try {
    return JSON.parse(fs.readFileSync(pendingFile(), 'utf8'));
  } catch {
    return null;
  }
}

const sha256 = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** 下载新版本到 ~/.watch-everywhere/updates/<version>/ 并校验 sha256 */
export async function downloadUpdate(info: UpdateInfo): Promise<DownloadedUpdate> {
  if (!info?.url) throw new Error('更新清单里没有下载地址');
  const platform = detectPlatform();
  const dir = path.join(UPDATE_DIR, info.latest || 'latest');
  fs.mkdirSync(dir, { recursive: true });
  const name = path.basename(new URL(info.url).pathname) || `watchEverywhere-${platform}`;
  const file = path.join(dir, name);

  const res = await fetch(info.url);
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  try {
    fs.chmodSync(file, 0o755);
  } catch {
    /* windows 忽略 */
  }

  const digest = sha256(file);
  const verified = !info.sha256 ? false : digest === info.sha256;
  const row: DownloadedUpdate = {
    version: info.latest,
    file,
    size: buf.length,
    sha256: digest,
    verified,
    downloadedAt: Date.now()
  };
  fs.mkdirSync(UPDATE_DIR, { recursive: true });
  fs.writeFileSync(pendingFile(), JSON.stringify(row, null, 2));
  return row;
}

/** 生成“替换并重启”的脚本，返回脚本路径 */
export function writeApplyScript(pending: DownloadedUpdate): string {
  const self = process.execPath;
  const isWin = process.platform === 'win32';
  const backup = `${self}.bak-${APP_VERSION}`;
  const script = isWin
    ? path.join(UPDATE_DIR, 'apply.cmd')
    : path.join(UPDATE_DIR, 'apply.sh');

  const body = isWin
    ? [
        '@echo off',
        'timeout /t 2 /nobreak >nul',
        `copy /y "${self}" "${backup}" >nul`,
        `copy /y "${pending.file}" "${self}" >nul`,
        `start "" "${self}"`,
        'del "%~f0"'
      ].join('\r\n')
    : [
        '#!/bin/sh',
        'sleep 2',
        `cp "${self}" "${backup}" 2>/dev/null || true`,
        `cp "${pending.file}" "${self}"`,
        `chmod +x "${self}"`,
        `xattr -dr com.apple.quarantine "${self}" 2>/dev/null || true`,
        `open "${self}" 2>/dev/null || "${self}" &`,
        `rm -f "$0"`
      ].join('\n');

  fs.writeFileSync(script, body);
  if (!isWin) fs.chmodSync(script, 0o755);
  return script;
}

/** 启动替换脚本并退出当前进程（用户点“立即重启”时调用） */
export function applyUpdateAndRestart(): { script: string; restarting: true } {
  const pending = readPending();
  if (!pending) throw new Error('还没有下载好的更新');
  if (!pending.verified) throw new Error('更新包校验失败，已拒绝安装（sha256 不匹配）');
  const script = writeApplyScript(pending);
  const child = spawn(script, [], { detached: true, stdio: 'ignore' });
  child.unref();
  setTimeout(() => process.exit(0), 300);
  return { script, restarting: true };
}
