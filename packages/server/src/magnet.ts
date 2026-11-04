import { createHash } from 'node:crypto';
import { createRule, fetch, parseRequest } from '@watch-everywhere/core';
import { MemoryCache } from './store';
import { pushLog } from './logs';

/**
 * 磁力搜索（Mikan / Nyaa / ACG.RIP / 动漫花园）
 *
 * 只做「搜索 + 生成磁力链接」，不碰离线下载和网盘。
 * Mikan 的 RSS 只给 .torrent，所以这里加了一个极简 bencode 解析，
 * 从 info 字典算 sha1 得到 infohash，再拼磁力链接。
 */

export interface MagnetItem {
  title: string;
  magnet: string;
  infohash: string;
  size: string;
  sizeBytes?: number;
  seeders?: number;
  leechers?: number;
  published?: string;
  source: string;
  category?: string;
  detailUrl?: string;
  torrentUrl?: string;
}

const cache = new MemoryCache();
const TTL = 15 * 60_000;

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function rule(host: string) {
  return createRule({ host, userAgent: UA });
}

async function getText(url: string, host: string, referer?: string): Promise<string> {
  const res = await fetch(
    parseRequest(JSON.stringify({ url, headers: referer ? { Referer: referer } : {} }), rule(host))
  );
  return String(res.body || '');
}

async function getBuffer(url: string, host: string, referer?: string): Promise<Buffer> {
  const res = await fetch(
    parseRequest(
      JSON.stringify({ url, responseType: 'arraybuffer', headers: referer ? { Referer: referer } : {} }),
      rule(host)
    )
  );
  const anyRes = res as any;
  if (Buffer.isBuffer(anyRes.body)) return anyRes.body;
  if (anyRes.body instanceof ArrayBuffer) return Buffer.from(anyRes.body);
  return Buffer.from(String(res.body || ''), 'binary');
}

// ---------------- bencode ----------------

/** 极简 bencode 解析：只为了拿到 info 字典的原始字节 */
export function infohashFromTorrent(buf: Buffer): string | null {
  let i = 0;
  const walk = (): { start: number; end: number } | null => {
    const ch = String.fromCharCode(buf[i]);
    if (ch === 'd' || ch === 'l') {
      const start = i;
      i++;
      while (i < buf.length && String.fromCharCode(buf[i]) !== 'e') walk();
      i++;
      return { start, end: i };
    }
    if (ch === 'i') {
      const start = i;
      i = buf.indexOf(0x65, i) + 1;
      return { start, end: i };
    }
    if (ch >= '0' && ch <= '9') {
      const start = i;
      let len = 0;
      while (i < buf.length && buf[i] >= 0x30 && buf[i] <= 0x39) len = len * 10 + (buf[i++] - 0x30);
      i++; // ':'
      i += len;
      return { start, end: i };
    }
    i++;
    return null;
  };

  if (String.fromCharCode(buf[0]) !== 'd') return null;
  i = 1;
  let infoRange: { start: number; end: number } | null = null;
  while (i < buf.length && String.fromCharCode(buf[i]) !== 'e') {
    const keyRange = walk();
    if (!keyRange) break;
    const key = buf.subarray(keyRange.start + (buf[keyRange.start] === 0x64 ? 0 : 0), keyRange.end).toString('utf8');
    const valueRange = walk();
    if (!valueRange) break;
    // key 是 "4:info" 这种形式
    if (key.endsWith('info') && key.length <= 8) infoRange = valueRange;
  }
  if (!infoRange) return null;
  const infoBytes = buf.subarray(infoRange.start, infoRange.end);
  return createHash('sha1').update(infoBytes).digest('hex');
}

export function magnetOf(infohash: string, title: string): string {
  const trackers = [
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://open.tracker.cl:1337/announce',
    'udp://tracker.openbittorrent.com:6969/announce',
    'udp://9.rarbg.com:2810/announce'
  ];
  const q = trackers.map((t) => `&tr=${encodeURIComponent(t)}`).join('');
  return `magnet:?xt=urn:btih:${infohash}&dn=${encodeURIComponent(title)}${q}`;
}

// ---------------- Mikan ----------------

const MIKAN_HOSTS = ['https://mikanime.tv', 'https://mikanani.kas.pub', 'https://mikanani.me'];

function decodeXml(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function humanSize(bytes?: number) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 100 || u <= 1 ? 0 : 1)}${units[u]}`;
}

async function searchMikan(keyword: string): Promise<MagnetItem[]> {
  // 多个镜像并行，取最先返回且带条目的那个
  const attempts = MIKAN_HOSTS.map((base) =>
    getText(`${base}/RSS/Search?searchstr=${encodeURIComponent(keyword)}`, base, `${base}/`).catch(() => '')
  );
  let xml = '';
  let host = MIKAN_HOSTS[0];
  for (const p of attempts) {
    const text = await p;
    if (text && text.includes('<item>')) {
      xml = text;
      host = MIKAN_HOSTS[attempts.indexOf(p)] || host;
      break;
    }
  }
  if (!xml) return [];

  const items: MagnetItem[] = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const title = decodeXml(/<title>([\s\S]*?)<\/title>/.exec(block)?.[1] || '');
    const enclosure = /<enclosure[^>]*url="([^"]+)"/.exec(block)?.[1] || '';
    const length = Number(/<contentLength>(\d+)</.exec(block)?.[1] || 0);
    const pub = /<pubDate>([^<]+)</.exec(block)?.[1] || '';
    const link = /<link>([^<]+)</.exec(block)?.[1] || '';
    if (!title) continue;
    items.push({
      title,
      magnet: '',
      infohash: '',
      size: humanSize(length),
      sizeBytes: length,
      published: pub.slice(0, 16).replace('T', ' '),
      source: 'Mikan',
      detailUrl: link,
      torrentUrl: enclosure
    });
  }
  return items;
}

// ---------------- Nyaa ----------------

async function searchNyaa(keyword: string): Promise<MagnetItem[]> {
  const bases = ['https://nyaa.si', 'https://nyaa.iss.ink'];
  let html = '';
  let host = '';
  for (const base of bases) {
    try {
      html = await getText(
        `${base}/?f=0&c=0_0&q=${encodeURIComponent(keyword)}&s=seeders&o=desc`,
        base,
        `${base}/`
      );
      host = base;
      if (html.includes('magnet:')) break;
    } catch {
      /* 换镜像 */
    }
  }
  if (!html) return [];

  const items: MagnetItem[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const row = m[1];
    const magnet = /href="(magnet:[^"]+)"/.exec(row)?.[1];
    if (!magnet) continue;
    const infoHash = /urn:btih:([0-9a-fA-F]{40})/.exec(magnet)?.[1]?.toLowerCase() || '';
    const title =
      decodeXml(/<a[^>]*class="[^"]*"[^>]*title="([^"]+)"/.exec(row)?.[1] || '') ||
      decodeXml(/<a href="\/view\/\d+"[^>]*>([\s\S]*?)<\/a>/.exec(row)?.[1] || '');
    if (!title) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => decodeXml(c[1].replace(/<[^>]+>/g, ' ')).trim());
    const size = cells.find((c) => /^(TiB|GiB|MiB|KiB|B)/i.test(c.replace(/\s+/g, ''))) || '';
    const seeders = Number(cells[cells.length - 3]) || 0;
    const leechers = Number(cells[cells.length - 2]) || 0;
    items.push({
      title,
      magnet,
      infohash: infoHash,
      size,
      seeders,
      leechers,
      published: cells[4] || '',
      source: 'Nyaa',
      detailUrl: host ? `${host}${/href="(\/view\/\d+)"/.exec(row)?.[1] || ''}` : ''
    });
  }
  return items;
}

// ---------------- ACG.RIP ----------------

async function searchAcgRip(keyword: string): Promise<MagnetItem[]> {
  try {
    const json = await getText(`https://acg.rip/.json?term=${encodeURIComponent(keyword)}`, 'https://acg.rip', 'https://acg.rip/');
    const rows = JSON.parse(json);
    const list: any[] = Array.isArray(rows) ? rows : rows?.items || [];
    return list.slice(0, 60).map((r) => {
      const infohash = String(r.info_hash || r.infohash || '').toLowerCase();
      return {
        title: String(r.title || ''),
        magnet: infohash ? magnetOf(infohash, String(r.title || '')) : '',
        infohash,
        size: humanSize(Number(r.size || 0)),
        sizeBytes: Number(r.size || 0),
        published: String(r.time || '').slice(0, 16).replace('T', ' '),
        source: 'ACG.RIP',
        detailUrl: r.link ? `https://acg.rip${r.link}` : ''
      } as MagnetItem;
    });
  } catch {
    return [];
  }
}

// ---------------- 汇总 ----------------

export async function fillMagnets(items: MagnetItem[], limit = 24) {
  const todo = items.filter((x) => !x.magnet && x.torrentUrl).slice(0, limit);
  let cursor = 0;
  const worker = async () => {
    while (cursor < todo.length) {
      const item = todo[cursor++];
      const key = `torrent@${item.torrentUrl}`;
      const hit = cache.get<string>(key);
      if (hit) {
        item.infohash = hit;
        item.magnet = magnetOf(hit, item.title);
        continue;
      }
      try {
        const buf = await getBuffer(String(item.torrentUrl), new URL(String(item.torrentUrl)).origin, 'https://mikanime.tv/');
        const infohash = infohashFromTorrent(buf);
        if (infohash) {
          cache.set(key, infohash, 24 * 3600_000);
          item.infohash = infohash;
          item.magnet = magnetOf(infohash, item.title);
        }
      } catch (e: any) {
        pushLog('warn', 'magnet/torrent', `取种子失败：${e?.message || e}`, { url: item.torrentUrl });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, todo.length) }, worker));
}

/** 单个种子文件解析成 infohash / 磁力（前端按需调用，带缓存） */
export async function resolveTorrent(torrentUrl: string, title: string): Promise<{ infohash: string; magnet: string }> {
  if (!/^https?:\/\//i.test(torrentUrl)) throw new Error('种子地址不合法');
  const key = `torrent@${torrentUrl}`;
  const hit = cache.get<string>(key);
  if (hit) return { infohash: hit, magnet: magnetOf(hit, title) };
  const buf = await getBuffer(torrentUrl, new URL(torrentUrl).origin, 'https://mikanime.tv/');
  const infohash = infohashFromTorrent(buf);
  if (!infohash) throw new Error('解析种子失败');
  cache.set(key, infohash, 24 * 3600_000);
  return { infohash, magnet: magnetOf(infohash, title) };
}

export async function searchMagnet(keyword: string, sources?: string[]): Promise<MagnetItem[]> {
  const kw = String(keyword || '').trim();
  if (!kw) return [];
  const key = `magnet@${kw}@${(sources || []).join(',')}`;
  const hit = cache.get<MagnetItem[]>(key);
  if (hit) return hit;

  const want = (name: string) => !sources?.length || sources.includes(name);
  const withTimeout = (p: Promise<MagnetItem[]>, ms: number) =>
    Promise.race([
      p.catch(() => []),
      new Promise<MagnetItem[]>((resolve) => setTimeout(() => resolve([]), ms))
    ]);

  const dedupe = (all: MagnetItem[]) => {
    const seen = new Set<string>();
    return all
      .filter((x) => {
        const k = x.infohash || x.title;
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => (b.seeders || 0) - (a.seeders || 0) || String(b.published).localeCompare(String(a.published)));
  };

  // 主源同步返回（Mikan 一般 1~2 秒），其他源后台补齐，避免被墙的站点拖住整个搜索
  const primary = want('mikan') ? dedupe(await withTimeout(searchMikan(kw), 12000)) : [];

  const rest: Promise<MagnetItem[]>[] = [];
  if (want('nyaa')) rest.push(withTimeout(searchNyaa(kw), 8000));
  if (want('acgrip')) rest.push(withTimeout(searchAcgRip(kw), 8000));
  if (rest.length) {
    void Promise.all(rest)
      .then(async (lists) => {
        const extra = lists.flat();
        if (!extra.length) return;
        const merged = dedupe([...primary, ...extra]);
        if (merged.length) cache.set(key, merged, TTL);
      })
      .catch(() => {});
  }

  const out = dedupe(primary);
  // 空结果不缓存：站点偶尔超时/限流，别让一次失败把 15 分钟都锁死
  if (out.length) cache.set(key, out, TTL);
  return out;
}
