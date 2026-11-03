import { randomUUID } from 'node:crypto';
import axios from 'axios';
import pako from 'pako';

/** 内容类型 */
export enum ContentType {
  MANGA = 0,
  NOVEL = 1,
  VIDEO = 2,
  AUDIO = 3,
  RSS = 4,
  NOVELMORE = 5
}

/** 规则定义（兼容 any-reader / ESO 规则格式） */
export interface Rule {
  // ===== 通用 =====
  id: string;
  name: string;
  host: string;
  sort: number;
  contentType: ContentType;
  loadJs: string;
  author: string;
  userAgent: string;
  cookies?: string;
  group?: string;
  icon?: string;
  createTime?: number;
  modifiedTime?: number;

  // ===== 搜索 =====
  enableSearch: boolean;
  searchUrl: string;
  searchList: string;
  searchCover: string;
  searchName: string;
  searchAuthor: string;
  searchChapter: string;
  searchDescription: string;
  searchResult: string;
  searchTags?: string;

  // ===== 章节 / 剧集 =====
  chapterUrl: string;
  chapterList: string;
  chapterName: string;
  chapterCover: string;
  chapterTime: string;
  chapterResult: string;
  chapterNextUrl: string;
  enableMultiRoads: boolean;
  chapterRoads: string;
  chapterRoadName?: string;

  // ===== 发现 =====
  enableDiscover: boolean;
  discoverUrl: string;
  discoverList: string;
  discoverName: string;
  discoverCover: string;
  discoverAuthor: string;
  discoverDescription: string;
  discoverResult: string;
  discoverTags: string;
  discoverChapter: string;
  discoverNextUrl: string;

  // ===== 正文 / 播放地址 =====
  contentUrl: string;
  contentNextUrl: string;
  contentItems: string;
  contentDecoder: string;

  /** 运行时附加信息（延迟等），不属于规则本身 */
  extra?: Record<string, any>;
}

export function createRule(rule: Partial<Rule> = {}): Rule {
  const now = Date.now();
  return Object.assign(
    {
      id: randomUUID(),
      createTime: now,
      modifiedTime: now,
      author: '',
      loadJs: '',
      cookies: '',
      name: '',
      host: '',
      icon: '',
      group: '',
      contentType: ContentType.VIDEO,
      sort: 0,
      userAgent: '',
      enableDiscover: false,
      discoverUrl: '',
      discoverNextUrl: '',
      discoverList: '',
      discoverTags: '',
      discoverName: '',
      discoverCover: '',
      discoverChapter: '',
      discoverDescription: '',
      discoverResult: '',
      discoverAuthor: '',
      enableSearch: false,
      searchUrl: '',
      searchAuthor: '',
      searchList: '',
      searchTags: '',
      searchName: '',
      searchCover: '',
      searchChapter: '',
      searchDescription: '',
      searchResult: '',
      enableMultiRoads: false,
      chapterRoads: '',
      chapterRoadName: '',
      chapterUrl: '',
      chapterNextUrl: '',
      chapterList: '',
      chapterName: '',
      chapterCover: '',
      chapterTime: '',
      chapterResult: '',
      contentUrl: '',
      contentNextUrl: '',
      contentItems: '',
      contentDecoder: ''
    } satisfies Rule,
    rule
  );
}

// ===================== eso:// 压缩规则 =====================

export function decodeRule(text: string): Rule {
  const lastIndex = text.lastIndexOf('@');
  const bytes = Buffer.from(text.substring(lastIndex + 1), 'base64');
  return JSON.parse(pako.inflate(bytes, { to: 'string' }));
}

export function encodeRule(input: Rule | string): string {
  const rule = typeof input === 'string' ? JSON.parse(input) : input;
  const ruleText = typeof input === 'string' ? input : JSON.stringify(input);
  const encoded = Buffer.from(pako.deflate(ruleText)).toString('base64');
  return `eso://${rule.author || ''}:${rule.name || ''}@${encoded}`;
}

export function isEsoStr(str: unknown): str is string {
  return typeof str === 'string' && str.startsWith('eso://');
}

export function isRuleObj(rule: any): rule is Rule {
  return !!rule && typeof rule === 'object' && !!rule.id && !!rule.host && typeof rule.contentType !== 'undefined';
}

/**
 * 文本转规则：支持 eso:// 字符串、规则 JSON(对象/数组)、返回上述内容的网络地址
 */
export async function text2rules(text: string, depth = 0): Promise<Rule[]> {
  if (typeof text !== 'string' || depth > 2) return [];
  const str = text.trim();
  if (isEsoStr(str)) return [decodeRule(str)];

  if (/^https?:\/\/.{3,}/.test(str)) {
    const res = await axios.get(str, { timeout: 15000, responseType: 'text', transformResponse: (d) => d }).catch(() => null);
    if (!res) return [];
    return text2rules(String(res.data), depth + 1);
  }

  let json: any;
  try {
    json = JSON.parse(str);
  } catch {
    return [];
  }
  const rows = Array.isArray(json) ? json : [json];
  const result: Rule[] = [];
  for (const row of rows) {
    if (isRuleObj(row)) result.push(row);
    else if (isEsoStr(row)) result.push(decodeRule(row));
  }
  return result;
}

// ===================== 资源站 (苹果CMS v10) =====================

const CMS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 解析苹果 CMS 播放串，按线路拆分出剧集 */
const CMS_ROADS_JS = `@js:(() => {
  const vod = JSON.parse(result).list[0] || {};
  const froms = String(vod.vod_play_from || '').split('$$$');
  const roads = [];
  String(vod.vod_play_url || '').split('$$$').forEach((group, i) => {
    const list = [];
    const seen = new Set();
    group.split('#').forEach((seg, j) => {
      if (!seg.trim()) return;
      const parts = seg.split('$');
      const name = (parts.length > 1 && parts[0].trim()) ? parts[0].trim() : String(j + 1);
      const url = (parts.length > 1 ? parts[1] : parts[0]).trim();
      if (!url || seen.has(url)) return;
      seen.add(url);
      list.push({ name, url });
    });
    if (list.length) roads.push({ roadName: froms[i] || ('线路' + (i + 1)), list });
  });
  return roads;
})()`;

export function cmsToRule(json: any, url: string, name = ''): Rule {
  const u = new URL(url);
  const api = u.pathname.includes('/api.php/provide/vod') ? u.pathname : '/api.php/provide/vod';
  const classes: any[] = Array.isArray(json?.class) ? json.class : [];
  const discoverUrl = [
    `最近更新::${api}?ac=detail&pg=$page`,
    ...classes.map((row) => `${row.type_name}::${api}?ac=detail&pg=$page&t=${row.type_id}`)
  ].join('\n');

  return createRule({
    name: name || u.hostname,
    host: u.origin,
    contentType: ContentType.VIDEO,
    group: '资源站',
    enableDiscover: true,
    discoverUrl,
    discoverList: '$.list',
    discoverTags: '$.type_name&&$.vod_time## .*',
    discoverName: '$.vod_name',
    discoverCover: '$.vod_pic',
    discoverChapter: '$.vod_remarks||$.vod_state',
    discoverDescription: '$.vod_content##</?[^>]+>',
    discoverResult: '$.vod_id',
    enableSearch: true,
    searchUrl: `${api}?ac=detail&pg=$page&wd=$keyword`,
    searchList: '$.list',
    searchTags: '$.type_name&&$.vod_time## .*',
    searchName: '$.vod_name',
    searchCover: '$.vod_pic',
    searchChapter: '$.vod_remarks||$.vod_state',
    searchDescription: '$.vod_content##</?[^>]+>',
    searchResult: '$.vod_id',
    enableMultiRoads: true,
    chapterRoads: CMS_ROADS_JS,
    chapterRoadName: '$.roadName',
    chapterUrl: `${api}?ac=detail&ids=$result`,
    chapterList: '$.list',
    chapterName: '$.name',
    chapterResult: '$.url',
    contentUrl: 'null',
    contentItems: '@js:lastResult'
  });
}

/** 根据资源站接口地址生成规则（自动识别 JSON / XML） */
export async function cmsUrlToRule(url: string, name = ''): Promise<Rule> {
  const res = await axios.get(url, {
    timeout: 15000,
    headers: { 'User-Agent': CMS_UA },
    responseType: 'text',
    transformResponse: (d) => d
  });
  const text = String(res.data).trim();
  if (text.startsWith('{')) return cmsToRule(JSON.parse(text), url, name);

  const { XMLParser } = await import('fast-xml-parser');
  const parser = new XMLParser({
    trimValues: true,
    textNodeName: 'type_name',
    ignoreAttributes: false,
    attributeNamePrefix: 'type_',
    parseAttributeValue: true
  });
  const rss = parser.parse(text).rss || {};
  const ty = rss.class?.ty;
  return cmsToRule({ class: Array.isArray(ty) ? ty : ty ? [ty] : [] }, url, name);
}
