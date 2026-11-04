import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import {
  ContentType,
  RuleManager,
  cmsUrlToRule,
  createRule,
  fetch,
  parseRequest,
  text2rules,
  AnalyzerManager,
  type Rule
} from '@watch-everywhere/core';
import { DATA_DIR, MemoryCache } from './store';
import { mediaProxyUrl, mediaReferer, needsMediaProxy } from './media';
import { extractImages, needsBrowser } from './extract-images';
import { browserFetch } from './browser';
import { fetchDanmaku } from './danmaku';
import { clearLogs, getLogs, pushLog, readPersistedLogs } from './logs';
import { clearPageCache, readPageCache, writePageCache } from './page-cache';
import { repairResources } from './repair';
import { checkAll, checkSubscription, createSubscription, subscriptionStore } from './subscription';
import { APP_VERSION, checkUpdate, detectPlatform, fetchNotices, isStandalone } from './update';
import { applyUpdateAndRestart, downloadUpdate, readPending } from './updater';
import { liveRoutes } from './live';
import {
  chapterHistoryStore,
  configStore,
  favoritesStore,
  historyStore,
  rulesStore,
  sameResource,
  type ResourceItem
} from './db';

type Handler = (args: any) => Promise<any> | any;

const HOUR = 60 * 60 * 1000;
/** 视频播放地址有效期短：资源站的 m3u8 带 sign，过期后上游会 403 */
const VIDEO_TTL = 10 * 60 * 1000;
const cache = new MemoryCache();
const md5 = (s: string) => createHash('md5').update(String(s)).digest('hex');

function getRule(ruleId: string): Rule {
  const rule = rulesStore.value.find((e) => e.id === ruleId);
  if (!rule) throw new Error('规则不存在');
  return rule;
}

async function cached<T>(key: string, ttl: number, fn: () => Promise<T>, noCache = false): Promise<T> {
  if (!noCache) {
    const hit = cache.get<T>(key);
    if (hit !== undefined) return hit;
  }
  const value = await fn();
  const empty = Array.isArray(value) ? value.length === 0 : !value;
  if (!empty) cache.set(key, value, ttl);
  return value;
}

function saveRule(input: Partial<Rule>): Rule {
  const list = rulesStore.value;
  const idx = input.id ? list.findIndex((e) => e.id === input.id) : -1;
  const { extra: _extra, ...rest } = input as any;
  if (!rest.id) delete rest.id;
  let rule: Rule;
  if (idx > -1) {
    rule = { ...list[idx], ...rest, modifiedTime: Date.now() };
    list[idx] = rule;
  } else {
    rule = createRule(rest);
    list.push(rule);
  }
  rulesStore.save();
  // 规则改了，相关缓存作废
  cache.clear();
  return rule;
}

function upsertResource(store: { value: ResourceItem[]; save: () => void }, data: Partial<ResourceItem>, limit = 0) {
  const now = Date.now();
  const list = store.value;
  const idx = list.findIndex((e) => sameResource(e, data));
  const rule = rulesStore.value.find((e) => e.id === data.ruleId);
  const row: ResourceItem = {
    ruleId: String(data.ruleId || ''),
    url: String(data.url || ''),
    name: String(data.name || ''),
    cover: data.cover || '',
    author: data.author || '',
    chapter: data.chapter || '',
    description: data.description || '',
    contentType: data.contentType ?? rule?.contentType,
    createTime: idx > -1 ? list[idx].createTime : now,
    updateTime: now
  };
  if (idx > -1) list.splice(idx, 1);
  list.unshift(row);
  if (limit && list.length > limit) list.length = limit;
  store.save();
  return row;
}

/**
 * 接口表：路径 => 处理函数（均为 POST，参数为 JSON body）
 * 路径命名与 any-reader 保持一致，方便对照。
 */
export const routes: Record<string, Handler> = {
  /** 弹幕：{ cid } 或 { url }（B 站 /x/v1/dm/list.so 的 oid） */
  'danmaku/list': async ({ cid, url }) => {
    const id = cid || String(url || '').replace(/\D/g, '');
    const list = await fetchDanmaku(id);
    return { cid: String(id || ''), count: list.length, list };
  },

  // ======================= 版本 / 更新 =======================
  'app/info': () => ({
    version: APP_VERSION,
    platform: detectPlatform(),
    standalone: isStandalone(),
    node: process.version
  }),

  'app/update-check': ({ force } = {}) => checkUpdate(!!force),

  'app/notices': () => fetchNotices(),

  /** 诊断日志：版本、平台、规则数 + 内存/磁盘日志 */
  'app/logs': () => ({
    generatedAt: Date.now(),
    version: APP_VERSION,
    platform: detectPlatform(),
    standalone: isStandalone(),
    node: process.version,
    dataDir: DATA_DIR,
    ruleCount: rulesStore.value.length,
    logs: getLogs(),
    persisted: readPersistedLogs(200)
  }),

  /** 前端上报错误（播放器 hls / video 报错等） */
  'app/client-log': ({ level = 'warn', scope = 'web', message = '', extra }) => {
    pushLog(level === 'error' ? 'error' : 'warn', `web:${scope}`, String(message), extra);
    return true;
  },

  'app/logs-clear': () => {
    clearLogs();
    return true;
  },

  /** 下载新版本到本地并校验 sha256（不自动安装） */
  'app/update-download': async () => {
    const info = await checkUpdate(true);
    if (info.error) throw new Error(info.error);
    if (!info.hasUpdate) throw new Error('已经是最新版本');
    const row = await downloadUpdate(info);
    return row;
  },

  /** 已下载待安装的更新 */
  'app/update-pending': () => readPending(),

  /** 应用更新并重启（会退出当前进程） */
  'app/update-apply': () => applyUpdateAndRestart(),

  // ======================= 规则 =======================
  'resource-rule/list': () =>
    [...rulesStore.value].sort((a, b) => (b.sort || 0) - (a.sort || 0)).map((r) => ({ ...r, extra: r.extra || {} })),

  'resource-rule/find-by-id': ({ id }) => getRule(id),

  'resource-rule/create': (rule) => saveRule(rule),

  'resource-rule/save': (rule) => saveRule(rule),

  'resource-rule/remove-by-id': ({ id }) => {
    const ids: string[] = Array.isArray(id) ? id : [id];
    rulesStore.set(rulesStore.value.filter((e) => !ids.includes(e.id)));
    cache.clear();
    return ids.length;
  },

  'resource-rule/batch-update': ({ ids, rule }) => {
    for (const r of rulesStore.value) if (ids.includes(r.id)) Object.assign(r, rule, { modifiedTime: Date.now() });
    rulesStore.save();
    cache.clear();
    return true;
  },

  // ======================= 规则订阅 =======================
  'subscription/list': () => subscriptionStore.value,

  'subscription/save': ({ id, ...rest }) => {
    const list = subscriptionStore.value;
    if (id) {
      const idx = list.findIndex((s) => s.id === id);
      if (idx > -1) {
        list[idx] = { ...list[idx], ...rest };
        subscriptionStore.save();
        return list[idx];
      }
    }
    const row = createSubscription(rest);
    list.push(row);
    subscriptionStore.save();
    return row;
  },

  'subscription/remove': ({ id }) => {
    subscriptionStore.set(subscriptionStore.value.filter((s) => s.id !== id));
    return true;
  },

  'subscription/check': async ({ id }) => {
    const sub = subscriptionStore.value.find((s) => s.id === id);
    if (!sub) throw new Error('订阅不存在');
    const res = await checkSubscription(sub);
    cache.clear();
    return res;
  },

  'subscription/check-all': async () => {
    const res = await checkAll(true);
    cache.clear();
    return res;
  },

  /** 导入：eso:// / JSON / 网络地址（按 id 合并，重复导入不会产生副本） */
  'resource-rule/import': async ({ url }) => {
    const rules = await text2rules(String(url || ''));
    // 导入前留一份快照，误删可回滚
    try {
      const dir = path.join(DATA_DIR, 'backups');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, `rules-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
        JSON.stringify(rulesStore.value, null, 2)
      );
    } catch {
      /* 备份失败不影响导入 */
    }
    for (const rule of rules) saveRule(rule);
    return rules.length;
  },

  /** 从苹果 CMS 资源站接口生成视频规则 */
  'resource-rule/import-cms': async ({ url, name }) => {
    if (!/^https?:\/\//.test(url || '')) throw new Error('请输入正确的资源站接口地址');
    const rule = await cmsUrlToRule(url, name);
    saveRule(rule);
    return 1;
  },

  /** 规则备份列表（导入前自动生成） */
  'resource-rule/backups': async () => {
    const dir = path.join(DATA_DIR, 'backups');
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const abs = path.join(dir, f);
        const st = fs.statSync(abs);
        let count = 0;
        try {
          count = JSON.parse(fs.readFileSync(abs, 'utf8')).length;
        } catch {
          count = 0;
        }
        return { file: f, size: st.size, time: st.mtimeMs, count };
      })
      .sort((a, b) => b.time - a.time);
  },

  /** 从备份恢复规则（恢复前会把当前规则再备份一份） */
  'resource-rule/restore-backup': async ({ file }) => {
    const dir = path.join(DATA_DIR, 'backups');
    const abs = path.join(dir, path.basename(String(file || '')));
    if (!fs.existsSync(abs)) throw new Error('备份不存在');
    const rules = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (!Array.isArray(rules)) throw new Error('备份内容格式不对');
    fs.writeFileSync(
      path.join(dir, `rules-before-restore-${Date.now()}.json`),
      JSON.stringify(rulesStore.value, null, 2)
    );
    rulesStore.set(rules);
    cache.clear();
    pushLog('warn', 'resource-rule/restore-backup', `从 ${file} 恢复 ${rules.length} 条规则`);
    return rules.length;
  },

  'resource-rule/ping': async ({ id }) => {
    const rule = getRule(id);
    const start = Date.now();
    let ping = -1;
    try {
      await axios.get(rule.host, { timeout: 5000, validateStatus: () => true, maxRedirects: 3 });
      ping = Date.now() - start;
    } catch {
      ping = -1;
    }
    rule.extra = { ...(rule.extra || {}), ping };
    rulesStore.save();
    return { ping };
  },

  // ======================= 解析 =======================
  'rule-manager/search-by-rule-id': async ({ ruleId, keyword, page = 1 }) => {
    const rule = getRule(ruleId);
    return cached(`search@${ruleId}@${page}@${md5(keyword)}`, 5 * 60 * 1000, () => new RuleManager(rule).search(keyword, page));
  },

  'rule-manager/search-by-rule': ({ rule, keyword }) => new RuleManager(rule).search(keyword),

  'rule-manager/discover-map': ({ ruleId }) => {
    const rule = getRule(ruleId);
    return cached(`discoverMap@${ruleId}`, HOUR, () => new RuleManager(rule).discoverMap());
  },

  'rule-manager/discover-map-by-rule': ({ rule }) => new RuleManager(rule).discoverMap(),

  'rule-manager/discover': ({ ruleId, data, page = 1 }) => {
    const rule = getRule(ruleId);
    return cached(`discover@${ruleId}@${page}@${md5(data?.value)}`, HOUR, () => new RuleManager(rule).discover(data.value, page));
  },

  'rule-manager/discover-by-rule': ({ rule, data, page = 1 }) => new RuleManager(rule).discover(data.value, page),

  'rule-manager/chapter': async ({ ruleId, filePath, noCache }) => {
    const rule = getRule(ruleId);
    const list = await cached(
      `chapter@${ruleId}@${md5(filePath)}`,
      HOUR,
      () => new RuleManager(rule).getChapter(filePath),
      !!noCache
    );
    return list.map((e) => ({ ...e, chapterPath: e.url }));
  },

  'rule-manager/chapter-by-rule': async ({ rule, filePath }) =>
    (await new RuleManager(rule).getChapter(filePath)).map((e) => ({ ...e, chapterPath: e.url })),

  /** 跨源搜索：一次问所有开了搜索的规则，找“替身”用 */
  'rule-manager/search-all': async ({ keyword, contentType, limit = 5 }) => {
    const kw = String(keyword || '').trim();
    if (!kw) throw new Error('缺少 keyword');
    const rules = rulesStore.value.filter(
      (r) => r.enableSearch && (contentType === undefined || r.contentType === contentType)
    );
    const out: any[] = [];
    await Promise.all(
      rules.map(async (r) => {
        const started = Date.now();
        try {
          const list = await new RuleManager(r).search(kw, 1);
          out.push({
            ruleId: r.id,
            rule: r.name,
            contentType: r.contentType,
            ms: Date.now() - started,
            count: list.length,
            items: list.slice(0, Number(limit)).map((e) => ({ name: e.name, url: e.url, cover: e.cover, chapter: e.chapter }))
          });
        } catch (e: any) {
          out.push({ ruleId: r.id, rule: r.name, contentType: r.contentType, ms: Date.now() - started, count: 0, error: String(e?.message || e) });
        }
      })
    );
    out.sort((a, b) => b.count - a.count);
    return out;
  },

  'rule-manager/content': async ({ ruleId, chapterPath, noCache }) => {
    const rule = getRule(ruleId);
    const key = `content@${ruleId}@${md5(chapterPath)}`;
    // 缓存里存“原始地址”，转发签名在返回时再生成，避免缓存里带着过期签名
    const raw: any = await cached(
      key,
      rule.contentType === ContentType.VIDEO ? VIDEO_TTL : 24 * HOUR,
      async () => {
        let content = await new RuleManager(rule).getContent(chapterPath);
        // 有些站点的阅读页必须跑 JS 才能过校验：用本机 Chrome 抓一次再抽图
        const only = content.length === 1 ? content[0] : '';
        const looksLikePage = only && /^https?:\/\//.test(only) && !/\.(jpe?g|png|webp|gif|avif)/i.test(only);
        if (looksLikePage && needsBrowser(only)) {
          // 先看磁盘缓存：同一章第二次打开不用再起 Chrome
          const hit = readPageCache(only);
          if (hit) {
            content = hit;
          } else {
            try {
              const started = Date.now();
              const page = await browserFetch(only, { waitMs: 2500, waitFor: 'amp-img' });
              const images = extractImages(page.html, page.url);
              if (images.length) {
                content = images;
                writePageCache(only, images);
                console.log(`[browser] ${only.slice(-40)} 抓到 ${images.length} 张，${Date.now() - started}ms（已缓存）`);
              }
            } catch (e: any) {
              pushLog('warn', 'content/browser', `Chrome 抓取失败：${e?.message || e}`, { url: only });
              console.warn('[browser] 抓取失败', only, e?.message || e);
            }
          }
        }
        if (!content.length) throw new Error('获取内容失败');
        // 哔哩哔哩的章节地址里带 cid（ep|cid 或 cid|bvid），顺手把弹幕 id 带出去
        const cidMatch = /(?:^|\|)(\d{5,})(?:\||$)/.exec(String(chapterPath || ''));
        const danmakuCid = /bilibili\.com$/i.test(new URL(rule.host).hostname) && cidMatch ? cidMatch[1] : '';
        return {
          contentType: rule.contentType,
          contentDecoder: !!rule.contentDecoder,
          danmakuCid,
          content
        };
      },
      !!noCache
    );

    const playable = (url: string) =>
      needsMediaProxy(url, rule.host) ? mediaProxyUrl(url, mediaReferer(url, rule.host)) : url;
    const isMedia = rule.contentType === ContentType.VIDEO || rule.contentType === ContentType.AUDIO;
    const first = Array.isArray(raw.content) ? raw.content[0] : raw.content;
    return {
      ...raw,
      content: isMedia ? playable(String(first || '')) : raw.content
    };
  },

  'rule-manager/content-by-rule': async ({ rule, chapterPath }) => {
    const content = await new RuleManager(rule).getContent(chapterPath);
    const first = content[0] || '';
    return {
      contentType: rule.contentType,
      content:
        rule.contentType === ContentType.VIDEO
          ? needsMediaProxy(first, rule.host)
            ? mediaProxyUrl(first, mediaReferer(first, rule.host))
            : first
          : content
    };
  },

  'rule-manager/content-decoder': ({ ruleId, content }) => new RuleManager(getRule(ruleId)).contentDecoder(content),

  /** 调试：用规则从文本中取值 */
  'rule-manager/analyzer-text': ({ inputText, ruleText, isArray }) => {
    const a = new AnalyzerManager();
    return isArray ? a.getElements(ruleText, inputText) : a.getString(ruleText, inputText);
  },

  /** 调试：按规则请求地址，返回响应体 */
  'rule-manager/analyzer-url': async ({ rule, url, keyword }) => {
    const r = createRule(rule || {});
    const rm = new RuleManager(r);
    const parsed = await rm.analyzer.parseJsUrl(url);
    return fetch(parseRequest(parsed, r, { keyword }));
  },

  /**
   * 诊断：哔哩哔哩漫画 Cookie 是否可用（依次打 ComicDetail → GetImageIndex → ImageToken）
   * { "cookie": "SESSDATA=...", "comicId": 25717 }
   */
  'debug/bili-manga': async ({ cookie: rawCookie, comicId = 25717 }) => {
    const cookie = String(rawCookie || '').trim();
    if (!cookie) throw new Error('需要 SESSDATA=... 形式的 Cookie');
    const ruleForFetch = createRule({ host: 'https://manga.bilibili.com' });

    const call = async (path: string, payload: any): Promise<any> => {
      const req = JSON.stringify({
        url: `https://manga.bilibili.com/twirp/comic.v1.Comic/${path}?device=pc&platform=web`,
        method: 'post',
        headers: {
          'content-type': 'application/json',
          Referer: 'https://manga.bilibili.com/',
          Origin: 'https://manga.bilibili.com',
          Cookie: cookie
        },
        body: JSON.stringify(payload)
      });
      try {
        const res = await fetch(parseRequest(req, ruleForFetch));
        return JSON.parse(res.body);
      } catch (err: any) {
        return { code: -2, msg: `请求失败：${String(err?.message || err).slice(0, 120)}` };
      }
    };

    const detail = await call('ComicDetail', { comic_id: Number(comicId) });
    const episodes = (detail?.data?.episodes || []) as any[];
    const out: any = {
      comicId,
      detailCode: detail?.code,
      detailMsg: detail?.msg,
      title: detail?.data?.title,
      episodeCount: episodes.length,
      episodeSample: episodes.slice(0, 3).map((e) => ({ id: e.id, ord: e.ord, title: e.title }))
    };
    if (detail?.code !== 0 || !episodes.length) {
      out.hint =
        detail?.code === 99 || detail?.code === -2
          ? 'Cookie 无效或已过期（B 站漫画要求登录态；也可能被风控，换网络或稍后再试）'
          : '接口返回异常';
      return out;
    }
    const ep = episodes[0];
    const idx = await call('GetImageIndex', { ep_id: Number(ep.id) });
    const images = (idx?.data?.images || []) as any[];
    out.imageIndexCode = idx?.code;
    out.imageCount = images.length;
    if (images.length) {
      const paths = images.map((x) => String(x.path || ''));
      const tok = await call('ImageToken', { urls: JSON.stringify(paths) });
      const list = (tok?.data || []) as any[];
      out.tokenCode = tok?.code;
      out.imageSample = list.slice(0, 3).map((x) => x.url);
    }
    return out;
  },

  /**
   * 诊断：服务端能不能抓到某一页、能不能从中抽出图片
   * 漫画源排查用，例如：
   * { "url": "https://cn.bzmgcn.com/comic/chapter/xxx/0_0.html" }
   */
  'debug/extract': async ({ url, host, ruleId }) => {
    const target = String(url || '').trim();
    if (!/^https?:\/\//i.test(target)) throw new Error('需要完整地址');
    if (ruleId) {
      // 走规则本身的解析流程（含 gatekeeper 预热、cookie、正文抽取），看到的就是阅读器拿到的
      const rule = getRule(ruleId);
      const started = Date.now();
      try {
        const content = await new RuleManager(rule).getContent(target);
        // 再单独抓一次原始页面，给出结构诊断（排查抽取器为什么抓不到图）
        let html = '';
        try {
          html = (await fetch(parseRequest(target, rule, {}))).body || '';
        } catch {
          html = '';
        }
        const count = (re: RegExp) => (html.match(re) || []).length;
        return {
          rule: rule.name,
          url: target,
          ms: Date.now() - started,
          count: content.length,
          isPage: content.length === 1 && /^https?:\/\//.test(content[0]) && !/\.(jpe?g|png|webp|gif|avif)/i.test(content[0]),
          sample: content.slice(0, 5),
          page: {
            bytes: html.length,
            title: (html.match(/<title>([^<]*)<\/title>/i) || [null, ''])[1],
            ampImg: count(/<amp-img/gi),
            img: count(/<img/gi),
            ampList: count(/<amp-list/gi),
            ampListSrc: [...html.matchAll(/<amp-list[^>]*?\bsrc="([^"]+)"/gi)].map((m) => m[1]).slice(0, 5),
            scriptSrc: [...html.matchAll(/<script[^>]*?\bsrc="([^"]+)"/gi)].map((m) => m[1]).slice(0, 8),
            hasAmp: /<html[^>]*\bamp\b/i.test(html),
            snippet: html.slice(0, 1200)
          }
        };
      } catch (e: any) {
        return { rule: rule.name, url: target, ms: Date.now() - started, error: String(e?.message || e) };
      }
    }
    const rule = createRule({ host: host || new URL(target).origin });
    const started = Date.now();
    const res = await fetch(parseRequest(target, rule, {})).catch((e: any) => {
      throw new Error(`抓取失败：${e?.message || e}`);
    });
    const html = res.body || '';
    const imgs: string[] = [];
    const seen = new Set<string>();
    const push = (raw: string) => {
      let u = String(raw || '').trim().replace(/&amp;/g, '&');
      if (!u) return;
      if (u.startsWith('//')) u = 'https:' + u;
      else if (u.startsWith('/')) u = new URL(target).origin + u;
      if (!/^https?:\/\//.test(u)) return;
      if (!/\.(jpe?g|png|webp|gif|avif|bmp)/i.test(u)) return;
      if (seen.has(u)) return;
      seen.add(u);
      imgs.push(u);
    };
    for (const m of html.matchAll(/<amp-img[^>]*?\bsrc="([^"]+)"/gi)) push(m[1]);
    for (const m of html.matchAll(/<img[^>]*?\b(?:src|data-src|data-original)="([^"]+)"/gi)) push(m[1]);
    const ampLists = [...html.matchAll(/<amp-list[^>]*?\bsrc="([^"]+)"/gi)].map((m) => m[1]);
    return {
      url: target,
      ms: Date.now() - started,
      bytes: html.length,
      title: (html.match(/<title>([^<]*)<\/title>/i) || [null, ''])[1],
      ampListCount: ampLists.length,
      images: imgs.length,
      sample: imgs.slice(0, 5)
    };
  },

  // ======================= 收藏 =======================
  'resource-favorites/list': () => favoritesStore.value,
  'resource-favorites/star': (data) => upsertResource(favoritesStore, data),
  'resource-favorites/unstar': (data) => {
    favoritesStore.set(favoritesStore.value.filter((e) => !sameResource(e, data)));
    return true;
  },

  // ======================= 历史 =======================
  'resource-history/list': () => historyStore.value,
  'resource-history/add': (data) => upsertResource(historyStore, data, 300),
  'resource-history/remove': (data) => {
    historyStore.set(historyStore.value.filter((e) => !sameResource(e, data)));
    return true;
  },
  'resource-history/clear': () => {
    historyStore.set([]);
    return true;
  },

  // ======================= 章节进度 =======================
  'chapter-history/list': ({ ruleId, filePath }) =>
    chapterHistoryStore.value
      .filter((e) => e.ruleId === ruleId && e.filePath === filePath)
      .sort((a, b) => b.updateTime - a.updateTime),

  'chapter-history/save': (data) => {
    const list = chapterHistoryStore.value;
    const idx = list.findIndex((e) => e.ruleId === data.ruleId && e.filePath === data.filePath && e.chapterPath === data.chapterPath);
    const row = { ...(idx > -1 ? list[idx] : {}), ...data, updateTime: Date.now() };
    if (idx > -1) list[idx] = row;
    else list.push(row);
    if (list.length > 5000) list.splice(0, list.length - 5000);
    chapterHistoryStore.save();
    return true;
  },

  // ======================= 配置 =======================
  'config/read': () => configStore.value,
  'config/update': (data) => {
    configStore.set({ ...configStore.value, ...data });
    return configStore.value;
  },

  // ======================= 直播 =======================
  ...liveRoutes,

  // ======================= 缓存 =======================
  /** 修复收藏/历史指向已失效规则的问题（按域名重新绑定） */
  'app/repair-resources': () => repairResources(),

  'cache/clear': () => {
    const pages = clearPageCache();
    if (pages) pushLog('info', 'cache', `清理页面缓存 ${pages} 个`);
    cache.clear();
    return true;
  }
};
