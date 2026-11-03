import { randomUUID } from 'node:crypto';
import zlib from 'node:zlib';
import type { Readable } from 'node:stream';
import axios from 'axios';
import type Router from '@koa/router';
import { JsonStore, MemoryCache } from './store';
import { BUILTIN_SOURCE_ID, getIptvStatus, iptvPlaylistUrl } from './iptv';
import {
  findProgrammes,
  parsePlaylist,
  parseXmltv,
  rewriteM3u8,
  streamKind,
  type EpgIndex,
  type LiveChannel
} from './live-parser';

export interface LiveSource {
  id: string;
  name: string;
  /** M3U / TXT 订阅地址 */
  url: string;
  /** XMLTV 节目单地址；留空则使用 M3U 头里的 x-tvg-url */
  epgUrl: string;
  /** 通过本服务转发播放（解决跨域 / 防盗链） */
  proxy: boolean;
  sort: number;
  createTime: number;
  updateTime: number;
  channelCount?: number;
  lastError?: string;
  lastUpdate?: number;
  /** 内置 iPTV 源（地址由程序维护，不能删除） */
  builtin?: boolean;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MIN = 60 * 1000;

export const liveSourcesStore = new JsonStore<LiveSource[]>('live-sources', []);
const cache = new MemoryCache();

// ---------------- 代理签名：只有服务端发出的地址才能被代理，避免变成开放代理 ----------------
import { sign } from './secret';
export const signUrl = (u: string) => sign(u);
export const proxyUrl = (u: string) => `/api/live/proxy?u=${encodeURIComponent(u)}&s=${signUrl(u)}`;

/** iPTV 就绪后确保存在「内置 iPTV」直播源，并同步最新的端口 / 访问密码 */
export function ensureBuiltinSource() {
  const list = liveSourcesStore.value;
  const url = iptvPlaylistUrl();
  const row = list.find((e) => e.id === BUILTIN_SOURCE_ID);
  if (row) {
    if (row.url !== url) {
      row.url = url;
      cache.clear();
    }
    row.builtin = true;
  } else {
    const now = Date.now();
    list.unshift({
      id: BUILTIN_SOURCE_ID,
      name: '内置 iPTV',
      url,
      epgUrl: '',
      proxy: true,
      sort: 100,
      createTime: now,
      updateTime: now,
      builtin: true
    });
  }
  liveSourcesStore.save();
}

function getSource(id: string) {
  const s = liveSourcesStore.value.find((e) => e.id === id);
  if (!s) throw new Error('直播源不存在');
  return s;
}

async function fetchText(url: string, timeout = 20000) {
  const res = await axios.get(url, {
    timeout,
    responseType: 'arraybuffer',
    maxRedirects: 5,
    headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' }
  });
  let buf = Buffer.from(res.data);
  // .gz 节目单
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  return buf.toString('utf8');
}

interface SourceData {
  channels: LiveChannel[];
  epgUrl: string;
}

async function loadSource(source: LiveSource, force = false): Promise<SourceData> {
  const key = `src@${source.id}@${source.url}`;
  if (!force) {
    const hit = cache.get<SourceData>(key);
    if (hit) return hit;
  }
  try {
    const text = await fetchText(source.url);
    const parsed = parsePlaylist(text);
    // 相对地址的节目单（如 /playback.xml）按订阅地址补全
    let epgUrl = source.epgUrl || parsed.epgUrl;
    if (epgUrl) {
      try {
        epgUrl = new URL(epgUrl, source.url).href;
      } catch {
        /* ignore */
      }
    }
    const data = { channels: parsed.channels, epgUrl };
    // iPTV 刚启动时列表可能还是空的，空列表只缓存 1 分钟
    cache.set(key, data, parsed.channels.length ? 30 * MIN : MIN);
    Object.assign(source, { channelCount: parsed.channels.length, lastError: '', lastUpdate: Date.now() });
    liveSourcesStore.save();
    return data;
  } catch (err: any) {
    const raw = err?.message || String(err);
    let host = source.url;
    try {
      host = new URL(source.url).host;
    } catch {
      /* ignore */
    }
    const code = err?.code || err?.cause?.code || '';
    let msg = raw;
    const iptv = source.builtin ? getIptvStatus() : null;
    if (iptv && iptv.state !== 'running')
      msg =
        iptv.state === 'starting'
          ? '内置 iPTV 正在启动，首次启动需要抓取频道，请稍等 1~2 分钟后刷新'
          : iptv.error || '内置 iPTV 没有运行';
    else if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(raw))
      msg = `无法连接 ${host}：该地址上没有服务在运行。请确认 iPTV 等直播源服务已启动，或检查地址和端口是否正确`;
    else if (code === 'ENOTFOUND' || /ENOTFOUND/.test(raw)) msg = `找不到主机 ${host}，请检查地址是否正确`;
    else if (code === 'ECONNABORTED' || /timeout/i.test(raw)) msg = `连接 ${host} 超时，请检查网络或服务是否正常`;
    else if (err?.response?.status) msg = `${host} 返回 HTTP ${err.response.status}，请检查订阅地址（设了访问密码需带上密码路径）`;
    source.lastError = msg;
    liveSourcesStore.save();
    throw new Error(msg);
  }
}

const epgLoading = new Map<string, Promise<EpgIndex | null>>();

async function loadEpg(url: string): Promise<EpgIndex | null> {
  if (!url) return null;
  const key = `epg@${url}`;
  const hit = cache.get<EpgIndex>(key);
  if (hit) return hit;
  // 节目单文件可能很大，同时只加载一次
  if (!epgLoading.has(url)) {
    epgLoading.set(
      url,
      fetchText(url, 60000)
        .then((xml) => {
          const index = parseXmltv(xml);
          cache.set(key, index, 60 * MIN);
          return index;
        })
        .catch((e) => {
          console.warn(`[live] 节目单加载失败 ${url}: ${e?.message}`);
          cache.set(key, { map: new Map(), channelCount: 0 }, 5 * MIN);
          return null;
        })
        .finally(() => epgLoading.delete(url))
    );
  }
  return epgLoading.get(url)!;
}

function nowNext(list: { title: string; start: number; stop: number }[], now = Date.now()) {
  const i = list.findIndex((p) => p.start <= now && p.stop > now);
  return { now: i > -1 ? list[i] : null, next: i > -1 ? list[i + 1] || null : list.find((p) => p.start > now) || null };
}

export const liveRoutes = {
  'live/source/list': () => [...liveSourcesStore.value].sort((a, b) => (b.sort || 0) - (a.sort || 0) || a.createTime - b.createTime),

  'live/source/save': (data: Partial<LiveSource>) => {
    const url = String(data.url || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('请输入 http(s) 开头的订阅地址');
    const list = liveSourcesStore.value;
    const now = Date.now();
    const idx = data.id ? list.findIndex((e) => e.id === data.id) : -1;
    const old = idx > -1 ? list[idx] : undefined;
    const row: LiveSource = {
      ...(old || { id: randomUUID(), createTime: now, sort: 0 }),
      name: String(data.name || '').trim() || new URL(url).host,
      // 内置源的地址由程序维护
      url: old?.builtin ? old.url : url,
      epgUrl: String(data.epgUrl || '').trim(),
      proxy: data.proxy ?? true,
      sort: Number(data.sort ?? (idx > -1 ? list[idx].sort : 0)) || 0,
      updateTime: now
    } as LiveSource;
    if (idx > -1) list[idx] = row;
    else list.push(row);
    liveSourcesStore.save();
    cache.clear();
    return row;
  },

  'live/source/remove': ({ id }: { id: string }) => {
    if (liveSourcesStore.value.find((e) => e.id === id)?.builtin)
      throw new Error('内置 iPTV 源不能删除；不需要的话可以用 WE_IPTV=0 启动来关闭内置 iPTV');
    liveSourcesStore.set(liveSourcesStore.value.filter((e) => e.id !== id));
    return true;
  },

  /** 内置 iPTV 运行状态 */
  'live/iptv/status': () => getIptvStatus(),

  /** 频道列表（按分组） */
  'live/channels': async ({ sourceId, force }: { sourceId: string; force?: boolean }) => {
    const source = getSource(sourceId);
    const { channels, epgUrl } = await loadSource(source, !!force);
    const epg = await Promise.race([loadEpg(epgUrl), new Promise<null>((r) => setTimeout(() => r(null), 8000))]);
    const now = Date.now();
    const groups: { name: string; channels: any[] }[] = [];
    const gIndex = new Map<string, number>();
    for (const c of channels) {
      if (!gIndex.has(c.group)) {
        gIndex.set(c.group, groups.length);
        groups.push({ name: c.group, channels: [] });
      }
      const nn = epg ? nowNext(findProgrammes(epg, c), now) : { now: null, next: null };
      groups[gIndex.get(c.group)!].channels.push({
        id: c.id,
        name: c.name,
        group: c.group,
        logo: c.logo ? (source.proxy && /^http:/i.test(c.logo) ? proxyUrl(c.logo) : c.logo) : '',
        lines: c.urls.length,
        now: nn.now?.title || '',
        next: nn.next?.title || ''
      });
    }
    return { groups, epg: !!epgUrl, epgLoaded: !!epg, total: channels.length };
  },

  /** 某个频道当天及前后的节目单 */
  'live/epg': async ({ sourceId, channelId }: { sourceId: string; channelId: string }) => {
    const source = getSource(sourceId);
    const { channels, epgUrl } = await loadSource(source);
    const ch = channels.find((c) => c.id === channelId);
    if (!ch) throw new Error('频道不存在');
    const epg = await loadEpg(epgUrl);
    if (!epg) return { list: [], now: null, next: null };
    const all = findProgrammes(epg, ch);
    const now = Date.now();
    const list = all.filter((p) => p.stop > now - 12 * 3600 * 1000 && p.start < now + 24 * 3600 * 1000);
    return { list, ...nowNext(all, now) };
  },

  /** 获取播放地址 */
  'live/play': async ({ sourceId, channelId, line = 0 }: { sourceId: string; channelId: string; line?: number }) => {
    const source = getSource(sourceId);
    const { channels } = await loadSource(source);
    const ch = channels.find((c) => c.id === channelId);
    if (!ch) throw new Error('频道不存在，可能直播列表已更新，请刷新');
    const i = Math.max(0, Math.min(ch.urls.length - 1, Number(line) || 0));
    const url = ch.urls[i];
    const kind = streamKind(url);
    return {
      url,
      proxyUrl: kind === 'unsupported' ? '' : proxyUrl(url),
      kind,
      proxy: source.proxy,
      line: i,
      lines: ch.urls.length,
      name: ch.name,
      group: ch.group
    };
  }
};

// ---------------- 播放代理（GET，非 JSON 接口） ----------------

function readAll(stream: Readable, limit = 8 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        stream.destroy();
        reject(new Error('清单过大'));
      } else chunks.push(c);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

export function registerLiveProxy(router: Router) {
  router.get('/live/proxy', async (ctx) => {
    const u = String(ctx.query.u || '');
    const s = String(ctx.query.s || '');
    if (!/^https?:\/\//i.test(u) || s !== signUrl(u)) {
      ctx.status = 403;
      ctx.body = 'forbidden';
      return;
    }
    const headers: Record<string, string> = { 'User-Agent': UA };
    if (ctx.get('range')) headers.Range = ctx.get('range');
    let res;
    try {
      res = await axios.get(u, {
        responseType: 'stream',
        timeout: 20000,
        maxRedirects: 5,
        validateStatus: () => true,
        headers
      });
    } catch (err: any) {
      ctx.status = 502;
      ctx.body = `upstream error: ${err?.message}`;
      return;
    }
    const upstream = res.data as Readable;
    // 上游中途断开时不要变成未捕获异常（交给播放器重试）
    upstream.on('error', () => {});
    // 播放器断开（切台 / 关闭页面）时同时断开上游，直播流不会一直挂着
    ctx.res.on('close', () => upstream.destroy());
    ctx.res.on('error', () => upstream.destroy());

    const finalUrl: string = (res.request as any)?.res?.responseUrl || u;
    const ct = String(res.headers['content-type'] || '');
    let path = '';
    try {
      path = new URL(finalUrl).pathname.toLowerCase();
    } catch {
      /* ignore */
    }
    const maybePlaylist = /mpegurl|text\/plain|application\/x-mpegurl/i.test(ct) || path.endsWith('.m3u8') || path.endsWith('.m3u');

    ctx.status = res.status;
    if (maybePlaylist && res.status < 400) {
      const text = await readAll(upstream).catch(() => '');
      if (text.trimStart().startsWith('#EXTM3U')) {
        ctx.set('Content-Type', 'application/vnd.apple.mpegurl');
        ctx.set('Cache-Control', 'no-cache');
        ctx.body = rewriteM3u8(text, finalUrl, proxyUrl);
      } else {
        ctx.set('Content-Type', ct || 'text/plain');
        ctx.body = text;
      }
      return;
    }
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = res.headers[h];
      if (v) ctx.set(h, String(v));
    }
    ctx.set('Cache-Control', 'no-cache');
    ctx.body = upstream;
  });
}
