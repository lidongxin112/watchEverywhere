import { createHash } from 'node:crypto';
import { createRule, fetch, parseRequest } from '@watch-everywhere/core';
import { MemoryCache } from './store';
import { pushLog } from './logs';
import { axiosProxy, getProxy } from './proxy-config';

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
/** 源健康度：失败后 5 分钟内不再尝试 */
const unhealthy = new Map<string, number>();

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function rule(host: string) {
  return createRule({ host, userAgent: UA });
}

/**
 * 取文本：优先走代理（被墙的源需要），代理失败再退回直连。
 * 这样「代理挂了」不会把本来能直连的站点一起拖死。
 */
/** 代理最近一次失败的时间，60 秒内不再尝试（避免每个请求都先等代理超时） */
let proxyBrokenUntil = 0;

async function getText(url: string, host: string, referer?: string, proxyUrl?: string): Promise<string> {
  const build = (useProxy: boolean, timeout?: number) =>
    parseRequest(
      JSON.stringify({
        url,
        ...(timeout ? { timeout } : {}),
        headers: referer ? { Referer: referer } : {},
        ...(useProxy && proxyUrl ? { proxy: axiosProxy(proxyUrl) } : {})
      }),
      rule(host)
    );

  // 代理只给 4 秒机会：通了用它（被墙的站点需要），不通立刻直连
  if (proxyUrl && Date.now() > proxyBrokenUntil) {
    try {
      const res = await fetch(build(true, 4000));
      const text = String(res.body || '');
      if (text) return text;
    } catch {
      proxyBrokenUntil = Date.now() + 60_000;
    }
  }
  const res = await fetch(build(false));
  return String(res.body || '');
}

async function getBuffer(url: string, host: string, referer?: string, proxyUrl?: string): Promise<Buffer> {
  const res = await fetch(
    parseRequest(
      JSON.stringify({
        url,
        responseType: 'arraybuffer',
        headers: referer ? { Referer: referer } : {},
        ...(proxyUrl ? { proxy: axiosProxy(proxyUrl) } : {})
      }),
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

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** bitih 可能是 40 位 hex，也可能是 32 位 base32（动漫花园就是 base32） */
export function normalizeInfohash(raw: string): string {
  const v = String(raw || '').trim();
  if (/^[0-9a-fA-F]{40}$/.test(v)) return v.toLowerCase();
  if (/^[A-Z2-7]{32}$/i.test(v)) {
    let bits = '';
    for (const ch of v.toUpperCase()) bits += B32.indexOf(ch).toString(2).padStart(5, '0');
    let hex = '';
    for (let i = 0; i + 4 <= bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex.slice(0, 40);
  }
  return '';
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

async function searchNyaaLike(
  keyword: string,
  bases: string[],
  sourceName: string,
  proxyUrl?: string,
  nyaaCat = '0_0'
): Promise<MagnetItem[]> {
  let html = '';
  let host = '';
  for (const base of bases) {
    try {
      html = await getText(
        `${base}/?f=0&c=${nyaaCat}&q=${encodeURIComponent(keyword)}&s=seeders&o=desc`,
        base,
        `${base}/`,
        proxyUrl
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
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) =>
      decodeXml(c[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    );
    // nyaa 的列：0 分类 / 1 标题 / 2 链接 / 3 大小 / 4 时间 / 5 做种 / 6 下载中 / 7 完成数
    const size = cells.find((c) => /^[\d.]+\s*(TiB|GiB|MiB|KiB|B)$/i.test(c)) || '';
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
      source: sourceName,
      detailUrl: host ? `${host}${/href="(\/view\/\d+)"/.exec(row)?.[1] || ''}` : ''
    });
  }
  return items;
}

// ---------------- ACG.RIP ----------------

async function searchAcgRip(keyword: string, proxyUrl?: string): Promise<MagnetItem[]> {
  try {
    const json = await getText(
      `https://acg.rip/.json?term=${encodeURIComponent(keyword)}`,
      'https://acg.rip',
      'https://acg.rip/',
      proxyUrl
    );
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

// ---------------- Torrents-CSV（快速、无分类限制） ----------------

async function searchCsv(keyword: string, proxyUrl?: string): Promise<MagnetItem[]> {
  // 这个库是 TPB 等站点的公开索引快照，响应快（<1s），适合做通用兜底
  const bases = ['https://torrents-csv.com', 'https://torrents-csv.ml'];
  let json = '';
  for (const base of bases) {
    try {
      json = await getText(
        `${base}/service/search?q=${encodeURIComponent(keyword)}&size=60`,
        base,
        `${base}/`,
        proxyUrl
      );
      if (json.includes('infohash')) break;
    } catch {
      /* 换镜像 */
    }
  }
  if (!json) return [];
  try {
    const rows = JSON.parse(json).torrents || [];
    return rows.map((r: any) => ({
      title: String(r.name || ''),
      magnet: magnetOf(String(r.infohash || '').toLowerCase(), String(r.name || '')),
      infohash: String(r.infohash || '').toLowerCase(),
      size: humanSize(Number(r.size_bytes || 0)),
      sizeBytes: Number(r.size_bytes || 0),
      seeders: Number(r.seeders || 0),
      leechers: Number(r.leechers || 0),
      published: r.created_unix ? new Date(Number(r.created_unix) * 1000).toISOString().slice(0, 16).replace('T', ' ') : '',
      source: 'Torrents-CSV'
    }));
  } catch {
    return [];
  }
}

// ---------------- The Pirate Bay（apibay） ----------------

/** TPB 分类：1xx 音频 / 2xx 视频 / 6xx 其它 */
const TPB_CATS: Record<string, string[]> = {
  movie: ['201', '207'],
  tv: ['205', '208'],
  variety: ['205'],
  music: ['101', '104'],
  book: ['601', '102', '103'],
  comic: ['602'],
  anime: ['205']
};

const TPB_LABEL: Record<string, string> = {
  '101': '音乐', '102': '有声书', '103': '有声书', '104': '无损音乐',
  '201': '电影', '202': '电影DVD', '205': '剧集', '207': '高清电影', '208': '高清剧集',
  '601': '电子书', '602': '漫画'
};

async function searchApibay(keyword: string, category: string, proxyUrl?: string): Promise<MagnetItem[]> {
  const cats = TPB_CATS[category] || ['201', '205'];
  const out: MagnetItem[] = [];
  await Promise.all(
    cats.map(async (cat) => {
      try {
        const json = await getText(
          `https://apibay.org/q.php?q=${encodeURIComponent(keyword)}&cat=${cat}`,
          'https://apibay.org',
          'https://thepiratebay.org/',
          proxyUrl
        );
        const rows = JSON.parse(json);
        if (!Array.isArray(rows)) return;
        for (const r of rows) {
          if (!r?.info_hash || r.name === 'No results returned') continue;
          out.push({
            title: String(r.name),
            magnet: magnetOf(String(r.info_hash).toLowerCase(), String(r.name)),
            infohash: String(r.info_hash).toLowerCase(),
            size: humanSize(Number(r.size || 0)),
            sizeBytes: Number(r.size || 0),
            seeders: Number(r.seeders || 0),
            leechers: Number(r.leechers || 0),
            published: r.added ? new Date(Number(r.added) * 1000).toISOString().slice(0, 16).replace('T', ' ') : '',
            source: 'TPB',
            category: TPB_LABEL[String(r.category)] || String(r.category || ''),
            detailUrl: `https://thepiratebay.org/description.php?id=${r.id}`
          });
        }
      } catch {
        /* 单个分类失败不影响 */
      }
    })
  );
  return out;
}

// ---------------- 动漫花园 ----------------

async function searchDmhy(keyword: string, proxyUrl?: string, sortId?: string): Promise<MagnetItem[]> {
  const bases = ['https://share.dmhy.org', 'https://dmhy.org'];
  let html = '';
  let host = '';
  for (const base of bases) {
    try {
      const sort = sortId ? `&sort_id=${sortId}` : '';
      html = await getText(`${base}/topics/list?keyword=${encodeURIComponent(keyword)}${sort}`, base, `${base}/`, proxyUrl);
      host = base;
      if (html.includes('magnet:')) break;
    } catch {
      /* 换镜像 */
    }
  }
  if (!html) return [];

  const items: MagnetItem[] = [];
  // 行结构：<tr ...> <td>日期</td> <td>分类</td> <td>标题+链接</td> <td>种子下载</td> <td>磁力</td> <td>大小</td> ...
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const row = m[1];
    const magnet = /href="(magnet:[^"]+)"/.exec(row)?.[1];
    const torrent = /href="([^"]+\.torrent)"/.exec(row)?.[1];
    if (!magnet && !torrent) continue;
    const title =
      decodeXml(
        (/<a[^>]*href="\/topics\/view\/[^"]+"[^>]*>([\s\S]*?)<\/a>/.exec(row)?.[1] || '').replace(/<[^>]+>/g, '')
      ) || decodeXml(/title="([^"]+)"/.exec(row)?.[1] || '');
    if (!title) continue;
    const infohash = normalizeInfohash(/urn:btih:([0-9a-zA-Z]+)/.exec(magnet || '')?.[1] || '');
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) =>
      decodeXml(c[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    );
    const size = cells.find((c) => /^(\d+(\.\d+)?)\s*(GB|MB|KB|TB)$/i.test(c)) || '';
    items.push({
      title,
      magnet: magnet || '',
      infohash,
      size,
      published: (cells[0] || '').split(' ')[0] + ' ' + ((cells[0] || '').split(' ')[1] || ''),
      source: '动漫花园',
      detailUrl: host && /href="(\/topics\/view\/[^"]+)"/.test(row) ? `${host}${/href="(\/topics\/view\/[^"]+)"/.exec(row)![1]}` : '',
      torrentUrl: torrent && torrent.startsWith('http') ? torrent : torrent ? `${host}${torrent}` : ''
    });
  }
  return items;
}

// ---------------- 源可用性探测 ----------------

export interface SourceProbe {
  name: string;
  key: string;
  host: string;
  needsProxy: boolean;
  direct?: boolean;
  viaProxy?: boolean;
  ms?: number;
  error?: string;
}

const PROBE_TARGETS: { key: string; name: string; url: string; host: string }[] = [
  { key: 'mikan', name: 'Mikan', url: 'https://mikanime.tv/RSS/Search?searchstr=test', host: 'https://mikanime.tv' },
  { key: 'nyaa', name: 'Nyaa', url: 'https://nyaa.si/', host: 'https://nyaa.si' },
  { key: 'sukebei', name: 'Sukebei', url: 'https://sukebei.nyaa.si/', host: 'https://sukebei.nyaa.si' },
  { key: 'dmhy', name: '动漫花园', url: 'https://share.dmhy.org/', host: 'https://share.dmhy.org' },
  { key: 'acgrip', name: 'ACG.RIP', url: 'https://acg.rip/', host: 'https://acg.rip' }
];

/** 探测每个源：直连能不能通、走代理能不能通 */
export async function probeSources(): Promise<{ proxy: string | null; sources: SourceProbe[] }> {
  const proxy = (await getProxy())?.url || null;
  const run = async (target: (typeof PROBE_TARGETS)[number], useProxy: boolean) => {
    const t0 = Date.now();
    try {
      const text = await getText(target.url, target.host, `${target.host}/`, useProxy ? proxy || undefined : undefined);
      return { ok: text.length > 0, ms: Date.now() - t0 };
    } catch (e: any) {
      return { ok: false, ms: Date.now() - t0, error: String(e?.message || e).slice(0, 80) };
    }
  };

  const sources = await Promise.all(
    PROBE_TARGETS.map(async (t) => {
      const direct = await run(t, false);
      const viaProxy = proxy && !direct.ok ? await run(t, true) : { ok: direct.ok, ms: direct.ms };
      return {
        key: t.key,
        name: t.name,
        host: t.host,
        needsProxy: !direct.ok && !!viaProxy.ok,
        direct: direct.ok,
        viaProxy: viaProxy.ok,
        ms: direct.ok ? direct.ms : viaProxy.ms,
        error: direct.ok || viaProxy.ok ? undefined : direct.error || 'direct&proxy 均失败'
      } as SourceProbe;
    })
  );
  return { proxy, sources };
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

export interface SourceStatus {
  name: string;
  count: number;
  ok: boolean;
  ms: number;
  error?: string;
}

export interface MagnetSearchResult {
  items: MagnetItem[];
  sources: SourceStatus[];
  /** 主源（Mikan）是否拿到数据 */
  primaryOk: boolean;
  /** 主源超时、后台还在补搜，客户端可以过几秒再查一次 */
  pending?: boolean;
  /** 其他源还在后台跑，客户端可以过几秒再查一次拿到合并结果 */
  pendingOther?: boolean;
}

export type MagnetCategory = 'all' | 'anime' | 'movie' | 'tv' | 'variety' | 'music' | 'book' | 'comic';

/** 每类内容默认查哪些源 */
const CATEGORY_PLAN: Record<MagnetCategory, { mikan?: boolean; nyaa?: string; dmhy?: string; apibay?: boolean }> = {
  all: { mikan: true, nyaa: '0_0', dmhy: '', apibay: false },
  anime: { mikan: true, nyaa: '1_0', dmhy: '1' },
  movie: { nyaa: '4_0', apibay: true },
  tv: { nyaa: '4_0', apibay: true },
  variety: { dmhy: '4', apibay: true },
  music: { nyaa: '2_0', apibay: true },
  book: { nyaa: '3_0', apibay: true },
  comic: { dmhy: '2', apibay: true }
};

export async function searchMagnet(
  keyword: string,
  sources?: string[],
  category: MagnetCategory = 'all'
): Promise<MagnetSearchResult> {
  const kw = String(keyword || '').trim();
  if (!kw) return { items: [], sources: [], primaryOk: false };
  const plan = CATEGORY_PLAN[category] || CATEGORY_PLAN.all;
  const key = `magnet@${kw}@${(sources || []).join(',')}@${category}`;
  const hit = cache.get<MagnetSearchResult>(key);
  if (hit) return hit;

  // 选了分类就按分类的源计划来；没选分类（undefined）时尊重用户勾选
  const want = (name: string) => {
    if (sources?.length) return sources.includes(name);
    if (name === 'mikan') return !!plan.mikan;
    if (name === 'dmhy') return plan.dmhy !== undefined;
    if (name === 'apibay') return !!plan.apibay;
    return true;
  };
  const withTimeout = (p: Promise<MagnetItem[]>, ms: number) =>
    Promise.race([
      p.catch(() => []),
      new Promise<MagnetItem[]>((resolve) => setTimeout(() => resolve([]), ms))
    ]);

  const dedupe = (all: MagnetItem[]): MagnetItem[] => {
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
  const status: SourceStatus[] = [];
  const timed = async (name: string, fn: () => Promise<MagnetItem[]>, ms: number): Promise<MagnetItem[]> => {
    // 5 分钟内失败过的源直接跳过，避免每次搜索都白等超时
    const until = unhealthy.get(name) || 0;
    if (until > Date.now()) {
      status.push({ name, count: 0, ok: false, ms: 0, error: '最近不可达，已跳过（5 分钟后重试）' });
      return [];
    }
    const t0 = Date.now();
    const rows = await withTimeout(fn(), ms);
    const done = rows.length > 0;
    if (done) unhealthy.delete(name);
    else unhealthy.set(name, Date.now() + 5 * 60_000);
    status.push({ name, count: rows.length, ok: done, ms: Date.now() - t0, error: done ? undefined : '无结果或超时' });
    return dedupe(rows);
  };

  // 主源：Mikan 对部分关键词很慢（实测「鬼灭之刃」要 19 秒），先给 10 秒，
  // 超时就把请求丢到后台继续跑，客户端几秒后再来取（结果会进缓存）
  let primary: MagnetItem[] = [];
  let pending = false;
  if (want('mikan') && plan.mikan) {
    const primaryMs = Number(process.env.WE_MAGNET_TIMEOUT) || 10000;
    primary = await timed('Mikan', () => searchMikan(kw), primaryMs);
    if (!primary.length) {
      pending = true;
      void searchMikan(kw)
        .then((rows) => {
          if (!rows.length) return;
          const merged = dedupe([...primary, ...rows]);
          cache.set(key, { items: merged, sources: status, primaryOk: true, pending: false }, TTL);
          pushLog('info', 'magnet', `后台补搜完成：${kw} → ${rows.length} 条`);
        })
        .catch(() => {});
    }
  }

  const proxy = (await getProxy())?.url;
  const NYAA_BASES = ['https://nyaa.si', 'https://nyaa.iss.ink', 'https://nyaa.moe'];
  const SUKEBEI_BASES = ['https://sukebei.nyaa.si', 'https://sukebei.nyaa.iss.ink'];

  const fastRest: Promise<MagnetItem[]>[] = [];
  const slowRest: Promise<MagnetItem[]>[] = [];
  if (want('csv') || !sources?.length) fastRest.push(timed('Torrents-CSV', () => searchCsv(kw, proxy), 8000));
  if (want('nyaa')) fastRest.push(timed('Nyaa', () => searchNyaaLike(kw, NYAA_BASES, 'Nyaa', proxy, plan.nyaa || '0_0'), 9000));
  if (want('sukebei')) fastRest.push(timed('Sukebei', () => searchNyaaLike(kw, SUKEBEI_BASES, 'Sukebei', proxy), 9000));
  if (want('dmhy')) fastRest.push(timed('动漫花园', () => searchDmhy(kw, proxy, plan.dmhy || undefined), 9000));
  if (want('acgrip')) fastRest.push(timed('ACG.RIP', () => searchAcgRip(kw, proxy), 8000));
  // TPB 很慢（实测 10~40s），放后台，别拖住首屏
  if (want('apibay')) slowRest.push(timed('TPB', () => searchApibay(kw, category, proxy), 40000));

  const pendingOther = slowRest.length > 0;
  if (fastRest.length) {
    const lists = await Promise.all(fastRest);
    const merged = dedupe([...primary, ...lists.flat()]);
    const result: MagnetSearchResult = {
      items: merged,
      sources: status,
      primaryOk: primary.length > 0,
      pending,
      pendingOther
    };
    if (merged.length) cache.set(key, result, TTL);
    if (slowRest.length) {
      void Promise.all(slowRest)
        .then((extra) => {
          const all = dedupe([...merged, ...extra.flat()]);
          cache.set(key, { items: all, sources: status, primaryOk: primary.length > 0, pendingOther: false }, TTL);
        })
        .catch(() => {});
    }
    return result;
  }

  // 只有慢源时才同步等（例如只勾了 TPB）
  if (slowRest.length) {
    const extra = await Promise.all(slowRest);
    const merged = dedupe([...primary, ...extra.flat()]);
    const result: MagnetSearchResult = { items: merged, sources: status, primaryOk: primary.length > 0, pending };
    if (merged.length) cache.set(key, result, TTL);
    return result;
  }

  const out = dedupe(primary);
  const result: MagnetSearchResult = { items: out, sources: status, primaryOk: out.length > 0, pending, pendingOther };
  // 空结果不缓存：站点偶尔超时/限流，别让一次失败把 15 分钟都锁死
  if (out.length) cache.set(key, result, TTL);
  return result;
}
