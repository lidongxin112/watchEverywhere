import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 本机签名密钥
 *
 * 播放地址的转发链接带签名（防止被当成开放代理）。
 * 早期用随机数，进程一重启旧链接全失效——而规则解析结果有缓存，
 * 缓存里的老链接就会 403（表现为“视频无法播放”）。
 * 这里持久化到数据目录，重启后签名依然有效。
 */

const DATA_DIR = process.env.WE_DATA_DIR || path.join(os.homedir(), '.watch-everywhere');
const FILE = path.join(DATA_DIR, 'secret.key');

let cached: Buffer | null = null;

export function getSecret(): Buffer {
  if (cached) return cached;
  try {
    const hex = fs.readFileSync(FILE, 'utf8').trim();
    if (hex.length >= 32) {
      cached = Buffer.from(hex, 'hex');
      return cached;
    }
  } catch {
    /* 首次运行 */
  }
  const secret = crypto.randomBytes(32);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, secret.toString('hex'), { mode: 0o600 });
  } catch {
    /* 写不了就本次进程内有效 */
  }
  cached = secret;
  return secret;
}

export function sign(value: string): string {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('hex').slice(0, 24);
}
