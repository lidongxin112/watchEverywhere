import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 抓取结果磁盘缓存
 *
 * 包子漫画这类站点必须起一次 Chrome 才能拿到正文（首次 5~20 秒）。
 * 把「页面地址 → 图片列表」缓存到磁盘，重复打开同一章就接近瞬时。
 */

const DATA_DIR = process.env.WE_DATA_DIR || path.join(os.homedir(), '.watch-everywhere');
const CACHE_DIR = path.join(DATA_DIR, 'cache', 'pages');
const MAX_FILES = 800;

export interface PageCacheRow {
  url: string;
  images: string[];
  time: number;
}

function fileOf(url: string) {
  const h = crypto.createHash('sha1').update(url).digest('hex');
  return path.join(CACHE_DIR, `${h}.json`);
}

export function readPageCache(url: string, ttl = 7 * 24 * 3600_000): string[] | null {
  try {
    const row: PageCacheRow = JSON.parse(fs.readFileSync(fileOf(url), 'utf8'));
    if (!row.images?.length) return null;
    if (Date.now() - row.time > ttl) return null;
    return row.images;
  } catch {
    return null;
  }
}

export function writePageCache(url: string, images: string[]) {
  if (!images.length) return;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(fileOf(url), JSON.stringify({ url, images, time: Date.now() }));
    prune();
  } catch {
    /* 缓存失败不影响主流程 */
  }
}

/** 文件太多时删掉最旧的一批 */
function prune() {
  try {
    const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json'));
    if (files.length <= MAX_FILES) return;
    const stats = files
      .map((f) => ({ f, t: fs.statSync(path.join(CACHE_DIR, f)).mtimeMs }))
      .sort((a, b) => a.t - b.t)
      .slice(0, files.length - MAX_FILES);
    for (const s of stats) fs.rmSync(path.join(CACHE_DIR, s.f), { force: true });
  } catch {
    /* ignore */
  }
}

export function clearPageCache(): number {
  try {
    const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json'));
    for (const f of files) fs.rmSync(path.join(CACHE_DIR, f), { force: true });
    return files.length;
  } catch {
    return 0;
  }
}
