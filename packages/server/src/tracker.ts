import dgram from 'node:dgram';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { pushLog } from './logs';

/**
 * 种子健康度：用 tracker scrape 拿真实的做种/下载人数
 *
 * 支持 HTTP(S) 与 UDP tracker。很多网络会拦 tracker（尤其 UDP），
 * 所以调用方要能接受「查不到」——前端会显示成「tracker 不可达」而不是 0 做种。
 */

export interface TrackerResult {
  url: string;
  ok: boolean;
  seeders?: number;
  leechers?: number;
  completed?: number;
  error?: string;
  ms: number;
}

export interface HealthResult {
  infohash: string;
  ok: boolean;
  seeders: number;
  leechers: number;
  completed: number;
  trackers: TrackerResult[];
  checkedAt: number;
  message?: string;
}

// ---------------- bencode ----------------

export function bencodeDecode(buf: Buffer): any {
  const read = (i: number): { value: any; next: number } => {
    const c = String.fromCharCode(buf[i]);
    if (c === 'd') {
      const obj: Record<string, any> = {};
      let p = i + 1;
      while (buf[p] !== 0x65) {
        const k = read(p);
        const v = read(k.next);
        obj[String(k.value)] = v.value;
        p = v.next;
      }
      return { value: obj, next: p + 1 };
    }
    if (c === 'l') {
      const arr: any[] = [];
      let p = i + 1;
      while (buf[p] !== 0x65) {
        const v = read(p);
        arr.push(v.value);
        p = v.next;
      }
      return { value: arr, next: p + 1 };
    }
    if (c === 'i') {
      const end = buf.indexOf(0x65, i);
      return { value: Number(buf.subarray(i + 1, end).toString()), next: end + 1 };
    }
    const colon = buf.indexOf(0x3a, i);
    const len = Number(buf.subarray(i, colon).toString());
    return { value: buf.subarray(colon + 1, colon + 1 + len), next: colon + 1 + len };
  };
  return read(0).value;
}

// ---------------- HTTP(S) scrape ----------------

function scrapeHttp(base: string, infoHash: Buffer, timeout = 6000): Promise<{ seeders: number; leechers: number; completed: number }> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(base);
    } catch {
      reject(new Error('tracker 地址不合法'));
      return;
    }
    // announce → scrape
    url.pathname = url.pathname.replace(/\/announce$/, '/scrape');
    url.search = `?info_hash=${encodeURIComponent(infoHash.toString('binary'))}`.replace(/%00/g, '%00');
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        timeout,
        headers: { 'User-Agent': 'watchEverywhere/1.0', Accept: '*/*' }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const body = Buffer.concat(chunks);
            const decoded = bencodeDecode(body);
            const files = decoded?.files;
            const key = Object.keys(files || {})[0];
            if (!key) throw new Error('scrape 返回空');
            const row = files[key];
            resolve({
              seeders: Number(row?.complete || 0),
              leechers: Number(row?.incomplete || 0),
              completed: Number(row?.downloaded || 0)
            });
          } catch (e: any) {
            reject(new Error(`解析失败：${e?.message || e}`));
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('超时'));
    });
    req.on('error', (e) => reject(new Error(e.message)));
  });
}

// ---------------- UDP scrape ----------------

function scrapeUdp(host: string, port: number, infoHash: Buffer, timeout = 5000): Promise<{ seeders: number; leechers: number; completed: number }> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    let done = false;
    const finish = (err: Error | null, data?: any) => {
      if (done) return;
      done = true;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolve(data);
    };
    socket.on('error', (e) => finish(new Error(e.message)));
    const timer = setTimeout(() => finish(new Error('超时')), timeout);

    // connect 请求
    const connectReq = Buffer.alloc(16);
    connectReq.writeUInt32BE(0x417, 0); // protocol id
    connectReq.writeUInt32BE(0x27101980, 4);
    connectReq.writeUInt32BE(0, 8); // action = connect
    connectReq.writeUInt32BE(Math.floor(Math.random() * 0xffffffff), 12);

    socket.on('message', (msg) => {
      if (done) return;
      try {
        const action = msg.readUInt32BE(0);
        if (action === 0) {
          const connectionId = msg.subarray(8, 16);
          const scrapeReq = Buffer.alloc(36);
          connectionId.copy(scrapeReq, 0);
          scrapeReq.writeUInt32BE(2, 8); // action = scrape
          scrapeReq.writeUInt32BE(Math.floor(Math.random() * 0xffffffff), 12);
          infoHash.copy(scrapeReq, 16);
          socket.send(scrapeReq, port, host);
          return;
        }
        if (action === 2) {
          clearTimeout(timer);
          const seeders = msg.readUInt32BE(8);
          const completed = msg.readUInt32BE(12);
          const leechers = msg.readUInt32BE(16);
          finish(null, { seeders, leechers, completed });
        }
      } catch (e: any) {
        finish(new Error(`UDP 响应解析失败：${e?.message || e}`));
      }
    });

    socket.send(connectReq, port, host);
  });
}

// ---------------- 汇总 ----------------

export function parseTrackers(magnet: string): string[] {
  try {
    const q = magnet.split('?')[1] || '';
    const list = new URLSearchParams(q).getAll('tr');
    return [...new Set(list)].filter(Boolean);
  } catch {
    return [];
  }
}

const DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'http://tracker.openbittorrent.com:80/announce',
  'https://tracker.gbitt.info/announce'
];

const cache = new Map<string, { at: number; value: HealthResult }>();
const TTL = 10 * 60_000;

export async function checkHealth(infohash: string, magnet?: string): Promise<HealthResult> {
  const hash = String(infohash || '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(hash)) throw new Error('infohash 不合法');
  const hit = cache.get(hash);
  if (hit && Date.now() - hit.at < TTL) return hit.value;

  const raw = Buffer.from(hash, 'hex');
  const trackers = [...new Set([...parseTrackers(magnet || ''), ...DEFAULT_TRACKERS])].slice(0, 8);

  const results = await Promise.all(
    trackers.map(async (url): Promise<TrackerResult> => {
      const t0 = Date.now();
      try {
        let u: URL;
        try {
          u = new URL(url);
        } catch {
          return { url, ok: false, error: '地址不合法', ms: 0 };
        }
        if (u.protocol === 'udp:') {
          const port = Number(u.port || 80);
          const data = await scrapeUdp(u.hostname, port, raw, 4500);
          return { url, ok: true, ...data, ms: Date.now() - t0 };
        }
        const data = await scrapeHttp(url, raw, 5000);
        return { url, ok: true, ...data, ms: Date.now() - t0 };
      } catch (e: any) {
        return { url, ok: false, error: String(e?.message || e).slice(0, 60), ms: Date.now() - t0 };
      }
    })
  );

  const okRows = results.filter((r) => r.ok);
  const value: HealthResult = {
    infohash: hash,
    ok: okRows.length > 0,
    seeders: okRows.reduce((n, r) => n + (r.seeders || 0), 0),
    leechers: okRows.reduce((n, r) => n + (r.leechers || 0), 0),
    completed: okRows.reduce((n, r) => n + (r.completed || 0), 0),
    trackers: results,
    checkedAt: Date.now(),
    message: okRows.length ? undefined : '所有 tracker 都不可达（网络可能拦了 P2P，或 tracker 已下线）'
  };
  cache.set(hash, { at: Date.now(), value });
  pushLog('info', 'tracker/health', `${hash.slice(0, 10)} → ${value.ok ? `做种 ${value.seeders}` : '不可达'}`, {
    trackers: okRows.length
  });
  return value;
}

/** 按做种数分档，列表里直接用（不用请求 tracker） */
export function healthTier(seeders?: number, _leechers?: number): { level: 'good' | 'ok' | 'bad' | 'dead' | 'unknown'; label: string } {
  if (seeders === undefined || seeders === null) return { level: 'unknown', label: '未知' };
  if (seeders >= 50) return { level: 'good', label: '优' };
  if (seeders >= 10) return { level: 'ok', label: '良' };
  if (seeders >= 1) return { level: 'bad', label: '差' };
  return { level: 'dead', label: '无种子' };
}

export interface BatchItem {
  infohash: string;
  magnet?: string;
}

/**
 * 批量测活：并发跑，结果按 infohash 返回；单条失败不影响其它
 * concurrency 默认 4（tracker 对并发不友好，太高会被限流）
 */
export async function checkHealthBatch(
  items: BatchItem[],
  concurrency = 4
): Promise<Record<string, HealthResult>> {
  const list = (items || [])
    .map((x) => ({ infohash: String(x.infohash || '').toLowerCase(), magnet: x.magnet }))
    .filter((x) => /^[0-9a-f]{40}$/.test(x.infohash));
  const out: Record<string, HealthResult> = {};
  let cursor = 0;

  const worker = async () => {
    while (cursor < list.length) {
      const item = list[cursor++];
      try {
        out[item.infohash] = await checkHealth(item.infohash, item.magnet);
      } catch (e: any) {
        out[item.infohash] = {
          infohash: item.infohash,
          ok: false,
          seeders: 0,
          leechers: 0,
          completed: 0,
          trackers: [],
          checkedAt: Date.now(),
          message: String(e?.message || e).slice(0, 80)
        };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, list.length)) }, worker));
  return out;
}
