/**
 * m3u8 智能去广告（参考 MoonTVPlus 的切片广告过滤思路）
 *
 * 资源站常见的插播广告：在正片清单里用 #EXT-X-DISCONTINUITY 隔出一小段，
 * 这一段的分片来自另一个目录 / 域名（或路径里带 adjump、ad 之类的关键字），总时长很短。
 *
 * 判定方法：
 * 1. 按 DISCONTINUITY 把分片切成若干块，每块算出「路径特征」= 域名 + 目录 + 文件名形状（数字归一）
 * 2. 总时长最多的路径特征视为正片
 * 3. 与正片特征不同、时长不超过 maxAdDuration、且占比很小的块判为广告
 * 4. 任意分片命中广告关键字 / 用户自定义规则时直接剔除
 */

export interface AdFilterOptions {
  /** 用户自定义：命中即删除的分片地址正则 */
  extraPatterns?: RegExp[];
  /** 单段广告最长时长（秒），默认 120 */
  maxAdDuration?: number;
}

export interface AdFilterResult {
  text: string;
  /** 删除的分片数 */
  removed: number;
  /** 删除的总时长（秒） */
  removedDuration: number;
}

interface Segment {
  /** 该分片自己的标签行（EXTINF、KEY、BYTERANGE 等）和地址行 */
  lines: string[];
  uri: string;
  duration: number;
}

const AD_KEYWORD = /(^|[/_.\-?=&])(adjump|adv|advert|ads?|guanggao|insert[-_]?ad)([/_.\-\d?=&]|$)/i;

function resolve(uri: string, base: string) {
  try {
    return new URL(uri, base);
  } catch {
    return null;
  }
}

/** 路径特征：域名 + 目录 + 文件名形状（数字统一成 0，扩展名保留） */
export function segmentSignature(uri: string, base: string): string {
  const u = resolve(uri, base);
  if (!u) return uri.replace(/\d+/g, '0');
  // 转发地址：特征按真实地址算
  const real = u.searchParams.get('u');
  const target = real && /^https?:\/\//i.test(real) ? resolve(real, base) || u : u;
  const parts = target.pathname.split('/');
  const file = parts.pop() || '';
  const dir = parts.join('/');
  return `${target.host}${dir}/${file.replace(/\d+/g, '0')}`;
}

function realUri(uri: string, base: string) {
  const u = resolve(uri, base);
  const real = u?.searchParams.get('u');
  return real && /^https?:\/\//i.test(real) ? real : u?.href || uri;
}

export function filterAds(text: string, base = 'http://localhost/', opts: AdFilterOptions = {}): AdFilterResult {
  const none: AdFilterResult = { text, removed: 0, removedDuration: 0 };
  if (!text || !/#EXTINF/i.test(text) || /#EXT-X-STREAM-INF/i.test(text)) return none;

  const maxAd = opts.maxAdDuration ?? 120;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const header: string[] = [];
  const tail: string[] = [];
  const blocks: Segment[][] = [[]];
  let pending: string[] = [];
  let seenSegment = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#EXT-X-DISCONTINUITY\b/i.test(line) && !/SEQUENCE/i.test(line)) {
      if (blocks[blocks.length - 1].length) blocks.push([]);
      continue;
    }
    if (/^#EXT-X-ENDLIST/i.test(line)) {
      tail.push(line);
      continue;
    }
    if (line.startsWith('#')) {
      // 第一个分片之前的全局标签放到头部
      if (!seenSegment && !/^#EXTINF/i.test(line) && !/^#EXT-X-(KEY|BYTERANGE|PROGRAM-DATE-TIME|MAP)/i.test(line)) header.push(line);
      else pending.push(line);
      continue;
    }
    // 地址行
    seenSegment = true;
    const inf = pending.find((l) => /^#EXTINF/i.test(l));
    const duration = inf ? parseFloat(inf.slice(8)) || 0 : 0;
    blocks[blocks.length - 1].push({ lines: [...pending, line], uri: line, duration });
    pending = [];
  }
  const segBlocks = blocks.filter((b) => b.length);
  if (!segBlocks.length) return none;

  const keywordHit = (s: Segment) => {
    const u = realUri(s.uri, base);
    return AD_KEYWORD.test(u) || (opts.extraPatterns || []).some((re) => re.test(u));
  };

  // 每块的主特征与时长
  const info = segBlocks.map((b) => {
    const count = new Map<string, number>();
    for (const s of b) {
      const sig = segmentSignature(s.uri, base);
      count.set(sig, (count.get(sig) || 0) + 1);
    }
    const sig = [...count.entries()].sort((x, y) => y[1] - x[1])[0][0];
    return { sig, duration: b.reduce((n, s) => n + s.duration, 0) };
  });
  const total = info.reduce((n, i) => n + i.duration, 0);
  const bySig = new Map<string, number>();
  for (const i of info) bySig.set(i.sig, (bySig.get(i.sig) || 0) + i.duration);
  const mainSig = [...bySig.entries()].sort((x, y) => y[1] - x[1])[0][0];

  let removed = 0;
  let removedDuration = 0;
  const kept: Segment[][] = [];
  segBlocks.forEach((b, i) => {
    const isAdBlock =
      segBlocks.length > 1 && info[i].sig !== mainSig && info[i].duration <= maxAd && info[i].duration <= total * 0.2;
    const keep = isAdBlock ? [] : b.filter((s) => !keywordHit(s));
    const drop = b.length - keep.length;
    if (drop) {
      removed += drop;
      removedDuration += b.filter((s) => !keep.includes(s)).reduce((n, s) => n + s.duration, 0);
    }
    if (keep.length) kept.push(keep);
  });

  if (!removed) return none;
  const out: string[] = [...header];
  kept.forEach((b, i) => {
    if (i > 0) out.push('#EXT-X-DISCONTINUITY');
    for (const s of b) out.push(...s.lines);
  });
  out.push(...tail);
  return { text: out.join('\n') + '\n', removed, removedDuration: Math.round(removedDuration * 10) / 10 };
}

/** 设置里每行一条的自定义规则 → 正则（写错的行忽略） */
export function parseAdPatterns(src: string): RegExp[] {
  return String(src || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .flatMap((l) => {
      try {
        return [new RegExp(l, 'i')];
      } catch {
        return [];
      }
    });
}
