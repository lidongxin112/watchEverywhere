import { ContentType, type Rule } from './rule';
import { AnalyzerManager } from './AnalyzerManager';
import { JSEngine } from './JSEngine';
import { fetch, parseRequest, type UrlVars } from './request';

export interface SearchItem {
  url: string;
  name: string;
  cover: string;
  author: string;
  chapter: string;
  description: string;
  tags?: string[];
}

export interface ChapterItem {
  url: string;
  name: string;
  cover: string;
  time: string;
  /** 线路名（多线路视频源） */
  road?: string;
}

export interface DiscoverPair {
  name: string;
  value: string;
}

export interface DiscoverGroup {
  name: string;
  pairs: DiscoverPair[];
}

const PAGE_PATTERN = /(\$page)|((^|[^a-zA-Z'"_/-])page([^a-zA-Z0-9'"]|$))/;

export class RuleManager {
  readonly rule: Rule;
  readonly analyzer: AnalyzerManager;
  private nextUrl = new Map<string, string>();

  constructor(rule: Rule) {
    this.rule = rule;
    const engine = new JSEngine(rule);
    engine.setEnvironment({
      host: rule.host,
      $host: rule.host,
      cookie: rule.cookies,
      rule,
      page: 1,
      $page: 1,
      $pageSize: 20,
      searchPage: 1
    });
    this.analyzer = new AnalyzerManager(engine);
  }

  private get engine() {
    return this.analyzer.engine;
  }

  private async request(urlRule: string, vars: UrlVars) {
    const url = await this.analyzer.parseJsUrl(urlRule);
    return fetch(parseRequest(url, this.rule, vars));
  }

  private async getList(body: any, rule: string) {
    if (!rule) return [];
    const reversed = rule.startsWith('-');
    const list = await this.analyzer.getElements(reversed ? rule.substring(1) : rule, body);
    if (reversed) list.reverse();
    return list;
  }

  // ======================= 搜索 =======================

  async search(keyword: string, page = 1, pageSize = 20): Promise<SearchItem[]> {
    let url = this.rule.searchUrl;
    if (!url) return [];
    if (page > 1 && !PAGE_PATTERN.test(url)) return [];

    this.engine.setEnvironment({ page, $page: page, searchPage: page, $keyword: keyword, keyword, searchKey: keyword });

    let body = '';
    if (url !== 'null') {
      const res = await this.request(url, { keyword, page, pageSize });
      body = res.body;
      this.engine.setEnvironment({ baseUrl: res.params.url, result: body });
    }

    const list = await this.getList(body, this.rule.searchList);
    const a = this.analyzer;
    const r = this.rule;
    const result: SearchItem[] = [];
    for (const item of list) {
      const tags = r.searchTags ? (await a.getString(r.searchTags, item)).split(/\s+/).filter(Boolean) : [];
      result.push({
        name: (await a.getString(r.searchName, item)).trim(),
        cover: await a.getUrl(r.searchCover, r.host, item),
        author: await a.getString(r.searchAuthor, item),
        chapter: await a.getString(r.searchChapter, item),
        description: await a.getString(r.searchDescription, item),
        url: await a.getUrl(r.searchResult, r.host, item),
        tags
      });
    }
    return result.filter((e) => e.name || e.url);
  }

  // ======================= 章节 / 剧集 =======================

  async getChapter(result: string, page = 1): Promise<ChapterItem[]> {
    const r = this.rule;
    const a = this.analyzer;
    this.engine.setEnvironment({ result, page });

    if (r.chapterUrl === '正文') return [{ url: result, name: '正文', cover: '', time: '' }];

    const chapterUrl = r.chapterUrl || result;
    let body = '';
    if (chapterUrl !== 'null') {
      const res = await this.request(chapterUrl, { result, page });
      body = res.body;
      this.engine.setEnvironment({ baseUrl: res.params.url });
    }
    this.engine.setEnvironment({ lastResult: result, result: body });

    const toItems = async (list: any[], road?: string) => {
      const items: ChapterItem[] = [];
      for (const row of list) {
        items.push({
          name: (await a.getString(r.chapterName, row)).trim(),
          cover: await a.getUrl(r.chapterCover, r.host, row),
          time: await a.getString(r.chapterTime, row),
          url: await a.getUrl(r.chapterResult, r.host, row),
          ...(road ? { road } : {})
        });
      }
      return items;
    };

    if (r.enableMultiRoads && r.chapterRoads) {
      const roads = await a.getElements(r.chapterRoads, body);
      const all: ChapterItem[] = [];
      for (let i = 0; i < roads.length; i++) {
        const road = roads[i];
        const roadName = (r.chapterRoadName ? await a.getString(r.chapterRoadName, road) : '') || `线路${i + 1}`;
        all.push(...(await toItems(await this.getList(road, r.chapterList), roadName)));
      }
      return all;
    }
    return toItems(await this.getList(body, r.chapterList));
  }

  // ======================= 正文 / 播放地址 =======================

  async getContent(lastResult: string): Promise<string[]> {
    const r = this.rule;
    this.engine.setEnvironment({ result: lastResult });
    const url = r.contentUrl || lastResult;
    const hasNext = !!r.contentNextUrl;
    const result: string[] = [];
    let next = '';

    for (let page = 1; page <= 50; page++) {
      let urlRule = '';
      if (page === 1) urlRule = url;
      else if (hasNext) urlRule = next;
      else if (PAGE_PATTERN.test(url)) urlRule = url;
      if (!urlRule) break;

      let body = '';
      let contentUrl = '';
      try {
        if (urlRule !== 'null') {
          const res = await this.request(urlRule, { result: lastResult, page });
          body = res.body;
          contentUrl = res.params.url;
        }
      } catch (e) {
        if (page === 1) throw e;
        break;
      }
      this.engine.setEnvironment({ page, $page: page, lastResult, result: body, baseUrl: contentUrl });

      next = hasNext ? await this.analyzer.getString(r.contentNextUrl, body) : '';
      let list = await this.analyzer.getStringList(r.contentItems, body);
      if (r.contentType === ContentType.NOVEL) {
        list = list
          .join('\n')
          .split('\n')
          .map((e) => e.trim())
          .filter(Boolean);
      }
      if (!list.length) break;
      result.push(...list);
      // 没有下一页规则、地址里也没有页码变量 => 只取一页
      if (!hasNext && !PAGE_PATTERN.test(url)) break;
      if (hasNext && !next) break;
    }
    return result;
  }

  contentDecoder(content: string): Promise<string> {
    return this.analyzer.getString(this.rule.contentDecoder, content);
  }

  // ======================= 发现 =======================

  async discoverMap(): Promise<DiscoverGroup[]> {
    const map: DiscoverGroup[] = [];
    const table = new Map<string, number>();
    let discoverUrl: any = (this.rule.discoverUrl || '').trimStart();

    if (/^@js:/i.test(discoverUrl)) {
      this.engine.setEnvironment({ page: 1, baseUrl: this.rule.host });
      discoverUrl = await this.engine.evaluate(discoverUrl.substring(4));
    }
    const discovers: string[] = Array.isArray(discoverUrl)
      ? discoverUrl.map((e) => String(e))
      : typeof discoverUrl === 'string'
        ? discoverUrl.split(/\n\s*|&&/)
        : [];

    for (const line of discovers) {
      if (!line.trim()) continue;
      const d = line.split('::');
      const value = d[d.length - 1].trim();
      let tab = '全部';
      let className = '全部';
      if (d.length === 2) tab = d[0].trim();
      else if (d.length >= 3) {
        tab = d[0].trim();
        className = d[1].trim();
      }
      if (!table.has(tab)) {
        table.set(tab, map.length);
        map.push({ name: tab, pairs: [{ name: className, value }] });
      } else {
        map[table.get(tab)!].pairs.push({ name: className, value });
      }
    }

    if (!map.length && this.rule.host.startsWith('http')) {
      map.push({ name: '全部', pairs: [{ name: '全部', value: this.rule.host }] });
    }
    return map;
  }

  async discover(url: string, page = 1): Promise<SearchItem[]> {
    const r = this.rule;
    const a = this.analyzer;
    const hasNext = !!r.discoverNextUrl;
    let rule = '';
    if (page === 1) rule = url;
    else if (hasNext) rule = this.nextUrl.get(url) || '';
    else if (PAGE_PATTERN.test(url)) rule = url;
    if (!rule) return [];

    this.engine.setEnvironment({ result: url, page, $page: page });
    let body = '';
    if (rule !== 'null') body = (await this.request(rule, { page })).body;
    this.engine.setEnvironment({ lastResult: url, result: body, baseUrl: r.host });

    if (hasNext) this.nextUrl.set(url, await a.getString(r.discoverNextUrl, body));

    const list = await this.getList(body, r.discoverList);
    const result: SearchItem[] = [];
    for (const item of list) {
      const tag = await a.getString(r.discoverTags, item);
      result.push({
        name: (await a.getString(r.discoverName, item)).trim(),
        cover: await a.getUrl(r.discoverCover, r.host, item),
        author: await a.getString(r.discoverAuthor, item),
        chapter: await a.getString(r.discoverChapter, item),
        description: await a.getString(r.discoverDescription, item),
        url: await a.getUrl(r.discoverResult, r.host, item),
        tags: tag ? tag.split(/\s+/).filter(Boolean) : []
      });
    }
    return result.filter((e) => e.name || e.url);
  }
}
