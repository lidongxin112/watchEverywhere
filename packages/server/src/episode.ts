/**
 * 追番辅助：从章节名里识别集数、从线路名 / 章节名里识别字幕组
 */

const CN_DIGIT: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** 中文数字（十二、一百零五、二十）→ 数字 */
export function chineseToNumber(s: string): number {
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0;
  let num = 0;
  for (const ch of s) {
    if (ch in CN_DIGIT) num = CN_DIGIT[ch];
    else if (ch in CN_UNIT) {
      total += (num || 1) * CN_UNIT[ch];
      num = 0;
    } else return NaN;
  }
  return total + num;
}

/** 预告、花絮之类的不算正片集数 */
const EXTRA_RE = /预告|花絮|特辑|特别篇|彩蛋|片花|幕后|PV\b|CM\b|OVA|OAD|SP\d*\b|番外|总集篇|先导/i;

/**
 * 识别集数；识别不出返回 null
 * 支持：第12集 / 第十二话 / EP12 / E12 / S01E12 / [12] / 12v2 / 12 / 更新至12集 / 第20240105期（综艺按期数）
 */
export function episodeNumber(name: string): number | null {
  const s = String(name || '').replace(/\s+/g, ' ').trim();
  if (!s || EXTRA_RE.test(s)) return null;
  let m: RegExpExecArray | null;
  if ((m = /S\d{1,2}\s*E(\d{1,4})/i.exec(s))) return Number(m[1]);
  if ((m = /第\s*([0-9]+|[零〇一二两三四五六七八九十百千]+)\s*[集话話回章节期]/.exec(s))) {
    const n = chineseToNumber(m[1]);
    return Number.isFinite(n) ? n : null;
  }
  if ((m = /(?:^|[^a-z])EP?\.?\s*(\d{1,4})(?!\d)/i.exec(s))) return Number(m[1]);
  // 字幕组发布格式：番名 - 23 [WebRip 1080p]
  if ((m = /\s-\s(\d{1,4})(?:v\d)?(?=\s|\[|【|\(|$)/i.exec(s))) return Number(m[1]);
  if ((m = /\[(\d{1,4})(?:v\d)?(?:\s*END)?\]/i.exec(s))) return Number(m[1]);
  if ((m = /更新至\s*(\d{1,4})/.exec(s))) return Number(m[1]);
  // 纯数字 / 结尾的数字（排除年份、分辨率）
  if ((m = /^(\d{1,4})(?:v\d)?$/i.exec(s)) || (m = /(?:^|[\s\-_.])(\d{1,4})(?:v\d)?\s*(?:END|完结?)?$/i.exec(s))) {
    const n = Number(m[1]);
    if (!(n >= 1900 && n <= 2100) && ![480, 720, 1080, 2160].includes(n)) return n;
  }
  return null;
}

const KNOWN_GROUPS = [
  'LoliHouse',
  'VCB-Studio',
  'Lilith-Raws',
  'ANi',
  'SweetSub',
  'Nekomoe kissaten',
  '喵萌奶茶屋',
  '桜都字幕组',
  '幻樱字幕组',
  '极影字幕社',
  '诸神字幕组',
  '动漫国字幕组',
  '千夏字幕组',
  '北宇治字幕组',
  '悠哈璃羽字幕社',
  '澄空学园',
  '华盟字幕社',
  '风车字幕组',
  '天使动漫',
  '雪飘工作室',
  '豌豆字幕组',
  '爱恋字幕社',
  '织梦字幕组',
  '猪猪字幕组',
  '离谱Sub',
  '六四位元字幕组',
  '拨雪寻春',
  '黒ネズミたち'
];

/**
 * 识别字幕组（线路名 / 章节名里的 [组名]、【组名】或已知组名）
 */
export function subtitleGroup(text: string): string {
  const s = String(text || '');
  for (const g of KNOWN_GROUPS) if (s.toLowerCase().includes(g.toLowerCase())) return g;
  const m = /^[[【]([^\]】]{2,30})[\]】]/.exec(s.trim());
  if (m && !/^\d+$/.test(m[1]) && !/^(TV|BD|WEB|1080P|720P|简|繁|中字|GB|BIG5)/i.test(m[1])) return m[1].trim();
  const g = /([^\s[\]【】()（）]{2,20}?(?:字幕组|字幕社|压制组|汉化组|Raws|Sub(?:s)?))(?![a-z])/i.exec(s);
  return g ? g[1] : '';
}

export interface RoadSummary {
  /** 线路名（空字符串表示默认线路） */
  name: string;
  count: number;
  /** 识别出的最新集数；识别不出为 0 */
  latest: number;
  /** 最新一集的名字 */
  latestName: string;
  group: string;
}

/** 按线路汇总：集数、最新集、字幕组 */
export function summarizeRoads(list: { name: string; road?: string }[]): RoadSummary[] {
  const map = new Map<string, { name: string; road?: string }[]>();
  for (const c of list) {
    const k = c.road || '';
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(c);
  }
  return [...map.entries()].map(([name, chapters]) => {
    let latest = 0;
    let latestName = chapters[chapters.length - 1]?.name || '';
    for (const c of chapters) {
      const n = episodeNumber(c.name);
      if (n !== null && n >= latest) {
        latest = n;
        latestName = c.name;
      }
    }
    const group = subtitleGroup(name) || subtitleGroup(chapters[0]?.name || '');
    return { name, count: chapters.length, latest, latestName, group };
  });
}

/** 自动挑选要追的线路：集数最新的，其次条目最多的 */
export function pickRoad(roads: RoadSummary[], preferred?: string): RoadSummary | undefined {
  if (preferred !== undefined && preferred !== null) {
    const hit = roads.find((r) => r.name === preferred || (r.group && r.group === preferred));
    if (hit) return hit;
  }
  return [...roads].sort((a, b) => b.latest - a.latest || b.count - a.count)[0];
}
