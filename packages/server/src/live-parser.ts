/**
 * 直播列表 / 节目单解析（无第三方依赖）
 * - M3U / M3U8：#EXTM3U x-tvg-url、#EXTINF 属性（tvg-id / tvg-name / tvg-logo / group-title）、#EXTGRP
 * - TXT（DIYP 格式）：`分组,#genre#` + `频道名,地址`，一行多个地址用 # 分隔
 * - XMLTV 节目单
 */
import { createHash } from 'node:crypto';

export interface LiveChannel {
  id: string;
  name: string;
  group: string;
  logo: string;
  tvgId: string;
  tvgName: string;
  /** 同名频道的多条线路 */
  urls: string[];
}

export interface ParsedPlaylist {
  channels: LiveChannel[];
  epgUrl: string;
}

export interface Programme {
  title: string;
  desc?: string;
  start: number;
  stop: number;
}

const DEFAULT_GROUP = '未分组';

function attrs(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of line.matchAll(/([\w-]+)="([^"]*)"/g)) out[m[1].toLowerCase()] = m[2].trim();
  return out;
}

function channelId(group: string, name: string) {
  return createHash('md5').update(`${group}|${name}`).digest('hex').slice(0, 12);
}

class Collector {
  private map = new Map<string, LiveChannel>();

  add(c: Omit<LiveChannel, 'id' | 'urls'> & { url: string }) {
    const url = c.url.trim();
    if (!url) return;
    const group = c.group || DEFAULT_GROUP;
    const name = c.name || url;
    const id = channelId(group, name);
    const row = this.map.get(id);
    if (row) {
      if (!row.urls.includes(url)) row.urls.push(url);
      if (!row.logo && c.logo) row.logo = c.logo;
      if (!row.tvgId && c.tvgId) row.tvgId = c.tvgId;
      return;
    }
    this.map.set(id, { id, name, group, logo: c.logo, tvgId: c.tvgId, tvgName: c.tvgName, urls: [url] });
  }

  list() {
    return [...this.map.values()];
  }
}

export function parseM3U(text: string): ParsedPlaylist {
  const col = new Collector();
  let epgUrl = '';
  let pending: { name: string; group: string; logo: string; tvgId: string; tvgName: string } | null = null;
  let extGroup = '';

  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#EXTM3U/i.test(line)) {
      const a = attrs(line);
      if (!epgUrl) epgUrl = (a['x-tvg-url'] || a['url-tvg'] || '').split(',')[0].trim();
      continue;
    }
    if (/^#EXTINF:/i.test(line)) {
      const a = attrs(line);
      // 去掉属性后，第一个逗号之后就是频道名（属性值里可能有逗号）
      const rest = line.replace(/([\w-]+)="[^"]*"/g, '');
      const name = rest.slice(rest.indexOf(',') + 1).trim() || a['tvg-name'] || '';
      pending = {
        name,
        group: a['group-title'] || extGroup,
        logo: a['tvg-logo'] || '',
        tvgId: a['tvg-id'] || '',
        tvgName: a['tvg-name'] || ''
      };
      continue;
    }
    if (/^#EXTGRP:/i.test(line)) {
      extGroup = line.slice(8).trim();
      if (pending && !pending.group) pending.group = extGroup;
      continue;
    }
    if (line.startsWith('#')) continue;
    // 地址行
    if (pending) {
      col.add({ ...pending, url: line });
      pending = null;
    } else if (/^[a-z][\w+.-]*:\/\//i.test(line)) {
      col.add({ name: '', group: extGroup, logo: '', tvgId: '', tvgName: '', url: line });
    }
  }
  return { channels: col.list(), epgUrl };
}

export function parseTXT(text: string): ParsedPlaylist {
  const col = new Collector();
  let group = DEFAULT_GROUP;
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    const idx = line.indexOf(',');
    if (idx < 0) continue;
    const name = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (/^#genre#$/i.test(value)) {
      group = name || DEFAULT_GROUP;
      continue;
    }
    for (const url of value.split(/#(?=[a-z][\w+.-]*:\/\/)/i)) {
      col.add({ name, group, logo: '', tvgId: '', tvgName: '', url: url.replace(/\$.*$/, '') });
    }
  }
  return { channels: col.list(), epgUrl: '' };
}

export function parsePlaylist(text: string): ParsedPlaylist {
  const t = text.trimStart().replace(/^\uFEFF/, '');
  if (/^#EXTM3U/i.test(t) || /#EXTINF:/i.test(t)) return parseM3U(t);
  return parseTXT(t);
}

/** 播放方式 */
export function streamKind(url: string): 'hls' | 'flv' | 'ts' | 'mp4' | 'unsupported' {
  if (!/^https?:\/\//i.test(url)) return 'unsupported';
  let path = url;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    /* ignore */
  }
  if (path.endsWith('.flv') || /\.flv\b/i.test(url)) return 'flv';
  if (path.endsWith('.ts')) return 'ts';
  if (/\.(mp4|m4v|webm)$/.test(path)) return 'mp4';
  // m3u8 以及没有后缀的地址（大多会跳转到 m3u8）
  return 'hls';
}

// ===================== XMLTV =====================

function decodeXml(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .trim();
}

/** 20261102080000 +0800 => 时间戳 */
export function parseXmltvTime(s: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(s.trim());
  if (!m) return NaN;
  const [, y, mo, d, h, mi, sec = '00', tz] = m;
  let t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec);
  // 没写时区按北京时间
  const zone = tz || '+0800';
  const sign = zone[0] === '-' ? -1 : 1;
  const offset = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3, 5)));
  t -= offset * 60000;
  return t;
}

/** 频道名归一化，用于节目单匹配 */
export function normName(s: string) {
  return (s || '')
    .toLowerCase()
    .replace(/[\s\-_·.]/g, '')
    .replace(/(高清|超清|标清|蓝光|频道|hd|fhd|uhd|4k|8k)$/g, '')
    .replace(/(高清|超清|标清|蓝光|频道|hd|fhd|uhd|4k|8k)$/g, '');
}

export interface EpgIndex {
  /** key: 归一化后的频道 id / 显示名 */
  map: Map<string, Programme[]>;
  channelCount: number;
}

export function parseXmltv(xml: string, now = Date.now()): EpgIndex {
  const from = now - 36 * 3600 * 1000;
  const to = now + 48 * 3600 * 1000;
  const byId = new Map<string, Programme[]>();
  const names = new Map<string, string[]>();

  for (const m of xml.matchAll(/<channel\s[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/channel>/g)) {
    const list: string[] = [];
    for (const d of m[2].matchAll(/<display-name[^>]*>([\s\S]*?)<\/display-name>/g)) list.push(decodeXml(d[1]));
    names.set(decodeXml(m[1]), list);
  }

  for (const m of xml.matchAll(/<programme\s([^>]*)>([\s\S]*?)<\/programme>/g)) {
    const a = attrs(m[1]);
    const start = parseXmltvTime(a.start || '');
    const stop = parseXmltvTime(a.stop || '') || start + 30 * 60000;
    if (!start || stop < from || start > to) continue;
    const title = /<title[^>]*>([\s\S]*?)<\/title>/.exec(m[2]);
    const desc = /<desc[^>]*>([\s\S]*?)<\/desc>/.exec(m[2]);
    const ch = decodeXml(a.channel || '');
    if (!byId.has(ch)) byId.set(ch, []);
    byId.get(ch)!.push({ title: title ? decodeXml(title[1]) : '', desc: desc ? decodeXml(desc[1]).slice(0, 300) : undefined, start, stop });
  }

  const map = new Map<string, Programme[]>();
  for (const [id, list] of byId) {
    list.sort((x, y) => x.start - y.start);
    const keys = new Set([id, normName(id), ...(names.get(id) || []).flatMap((n) => [n, normName(n)])]);
    for (const k of keys) if (k && !map.has(k)) map.set(k, list);
  }
  return { map, channelCount: byId.size };
}

export function findProgrammes(index: EpgIndex, ch: Pick<LiveChannel, 'tvgId' | 'tvgName' | 'name'>): Programme[] {
  for (const k of [ch.tvgId, ch.tvgName, ch.name]) {
    if (!k) continue;
    const hit = index.map.get(k) || index.map.get(normName(k));
    if (hit) return hit;
  }
  return [];
}

// ===================== HLS 清单改写 =====================

/** 把 m3u8 里的分片 / 子清单 / 密钥地址改写为代理地址 */
export function rewriteM3u8(text: string, base: string, toProxy: (absUrl: string) => string) {
  const abs = (u: string) => {
    try {
      return new URL(u, base).href;
    } catch {
      return u;
    }
  };
  return text
    .split(/\r?\n/)
    .map((raw) => {
      const line = raw.trim();
      if (!line) return raw;
      if (line.startsWith('#')) return raw.replace(/URI="([^"]+)"/g, (_, u) => `URI="${toProxy(abs(u))}"`);
      return toProxy(abs(line));
    })
    .join('\n');
}
