import type { Rule } from '@/constants';
import { request } from './request';

export interface ResourceItem {
  ruleId: string;
  url: string;
  name: string;
  cover?: string;
  author?: string;
  chapter?: string;
  description?: string;
  contentType?: number;
  tags?: string[];
  createTime?: number;
  updateTime?: number;
}

export interface ChapterItem {
  url: string;
  chapterPath: string;
  name: string;
  cover?: string;
  time?: string;
  road?: string;
}

export interface DiscoverGroup {
  name: string;
  pairs: { name: string; value: string }[];
}

export interface ContentResult {
  contentType: number;
  contentDecoder: boolean;
  content: string | string[];
  /** 哔哩哔哩番剧/投稿的弹幕 id（cid） */
  danmakuCid?: string;
}

// ---------------- 规则 ----------------
export const getRules = () => request<Rule[]>('resource-rule/list');
export const getRuleById = (id: string) => request<Rule>('resource-rule/find-by-id', { id });
export const saveRule = (rule: Partial<Rule>) => request<Rule>('resource-rule/save', rule);
export const updateRule = (rule: Partial<Rule> & { id: string }) => request<Rule>('resource-rule/save', rule);
export const delRules = (id: string | string[]) => request<number>('resource-rule/remove-by-id', { id });
export const batchUpdateRules = (ids: string[], rule: Partial<Rule>) => request('resource-rule/batch-update', { ids, rule });
export const importRules = (url: string) => request<number>('resource-rule/import', { url });
export const importCMS = (url: string, name: string) => request<number>('resource-rule/import-cms', { url, name });
export const pingRule = (id: string) => request<{ ping: number }>('resource-rule/ping', { id }, false);

// ---------------- 解析 ----------------
export const searchByRuleId = (ruleId: string, keyword: string, signal?: AbortSignal) =>
  request<ResourceItem[]>('rule-manager/search-by-rule-id', { ruleId, keyword }, false, signal);
export const searchByRule = (rule: Rule, keyword: string) => request<ResourceItem[]>('rule-manager/search-by-rule', { rule, keyword });
export const discoverMap = (ruleId: string) => request<DiscoverGroup[]>('rule-manager/discover-map', { ruleId });
export const discover = (ruleId: string, data: { name: string; value: string }, page = 1) =>
  request<ResourceItem[]>('rule-manager/discover', { ruleId, data, page });
export const getChapter = (ruleId: string, filePath: string, noCache = false) =>
  request<ChapterItem[]>('rule-manager/chapter', { ruleId, filePath, noCache });
export const getChapterByRule = (rule: Rule, filePath: string) => request<ChapterItem[]>('rule-manager/chapter-by-rule', { rule, filePath });
export const getContent = (params: { ruleId: string; filePath?: string; chapterPath: string; noCache?: boolean }) =>
  request<ContentResult>('rule-manager/content', params);
export const getContentByRule = (rule: Rule, chapterPath: string) =>
  request<ContentResult>('rule-manager/content-by-rule', { rule, chapterPath });
export const contentDecoder = (ruleId: string, content: string) => request<string>('rule-manager/content-decoder', { ruleId, content }, false);
export const analyzerText = (data: { inputText: string; ruleText: string; isArray: boolean }) => request('rule-manager/analyzer-text', data);
export const analyzerUrl = (data: { rule: Rule; url: string; keyword: string }) =>
  request<{ params: any; body: string }>('rule-manager/analyzer-url', data);

// ---------------- 收藏 / 历史 ----------------
export const getFavorites = () => request<ResourceItem[]>('resource-favorites/list');
export const star = (item: ResourceItem) => request('resource-favorites/star', item);
export const unstar = (item: Pick<ResourceItem, 'ruleId' | 'url'>) => request('resource-favorites/unstar', item);

export const getHistory = () => request<ResourceItem[]>('resource-history/list');
export const addHistory = (item: ResourceItem) => request('resource-history/add', item, false);
export const removeHistory = (item: Pick<ResourceItem, 'ruleId' | 'url'>) => request('resource-history/remove', item);
export const clearHistory = () => request('resource-history/clear');

export interface ChapterHistory {
  ruleId: string;
  filePath: string;
  chapterPath: string;
  chapterName?: string;
  percentage: number;
  currentTime?: number;
  updateTime: number;
}
export const getChapterHistory = (ruleId: string, filePath: string) =>
  request<ChapterHistory[]>('chapter-history/list', { ruleId, filePath }, false);
export const saveChapterHistory = (data: Partial<ChapterHistory>) => request('chapter-history/save', data, false);

export const clearCache = () => request('cache/clear');

// ---------------- 直播 ----------------
export interface LiveSource {
  id: string;
  name: string;
  url: string;
  epgUrl: string;
  proxy: boolean;
  sort: number;
  channelCount?: number;
  lastError?: string;
  lastUpdate?: number;
  builtin?: boolean;
}

export interface IptvStatus {
  enabled: boolean;
  installed: boolean;
  mode: 'managed' | 'external' | 'none';
  state: 'stopped' | 'starting' | 'running' | 'error';
  port: number;
  pass: string;
  adminPath: string;
  error: string;
  restarts: number;
  logs: string[];
}

export const getIptvStatus = () => request<IptvStatus>('live/iptv/status', {}, false);

/** iPTV 频道管理后台地址（用当前访问的主机名，局域网其它设备也能打开） */
export function iptvAdminUrl(s: IptvStatus) {
  return `${location.protocol}//${location.hostname}:${s.port}/${s.pass ? `${encodeURIComponent(s.pass)}/` : ''}${s.adminPath}`;
}

export interface LiveChannel {
  id: string;
  name: string;
  group: string;
  logo: string;
  lines: number;
  now: string;
  next: string;
}

export interface LiveGroup {
  name: string;
  channels: LiveChannel[];
}

export type StreamKind = 'hls' | 'flv' | 'ts' | 'mp4' | 'unsupported';

export interface LivePlayInfo {
  url: string;
  proxyUrl: string;
  kind: StreamKind;
  proxy: boolean;
  line: number;
  lines: number;
  name: string;
  group: string;
}

export interface LiveProgramme {
  title: string;
  desc?: string;
  start: number;
  stop: number;
}

export const getLiveSources = () => request<LiveSource[]>('live/source/list');
export const saveLiveSource = (data: Partial<LiveSource>) => request<LiveSource>('live/source/save', data);
export const removeLiveSource = (id: string) => request('live/source/remove', { id });
export const getLiveChannels = (sourceId: string, force = false) =>
  request<{ groups: LiveGroup[]; epg: boolean; epgLoaded: boolean; total: number }>('live/channels', { sourceId, force });
export const getLivePlay = (sourceId: string, channelId: string, line = 0) =>
  request<LivePlayInfo>('live/play', { sourceId, channelId, line });
export const getLiveEpg = (sourceId: string, channelId: string) =>
  request<{ list: LiveProgramme[]; now: LiveProgramme | null; next: LiveProgramme | null }>('live/epg', { sourceId, channelId }, false);

// ======================= 版本 / 更新 =======================

export interface AppInfo {
  version: string;
  platform: string;
  standalone: boolean;
  node: string;
}

export interface UpdateInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
  notes?: string;
  publishedAt?: string;
  url?: string;
  size?: number;
  platform: string;
  checkedAt: number;
  error?: string;
}

export interface AppNotice {
  id: string;
  title: string;
  content?: string;
  level?: 'info' | 'warning' | 'error';
  url?: string;
  time?: string;
}

export const getAppInfo = () => request<AppInfo>('app/info');
export const checkAppUpdate = (force = false) => request<UpdateInfo>('app/update-check', { force });
export const getAppNotices = () => request<AppNotice[]>('app/notices', {}, false);

// ======================= 弹幕 =======================

export interface DanmakuItem {
  t: number;
  m: number;
  c: number;
  text: string;
}

export const getDanmaku = (cid: string) => request<{ cid: string; count: number; list: DanmakuItem[] }>('danmaku/list', { cid }, false);

// ======================= 规则订阅 =======================

export interface RuleSubscription {
  id: string;
  name: string;
  url: string;
  autoUpdate: boolean;
  intervalHours: number;
  lastCheck?: number;
  lastCount?: number;
  lastError?: string;
  createTime: number;
}

export interface SubscriptionCheckResult {
  id: string;
  name: string;
  added: number;
  updated: number;
  total: number;
  error?: string;
}

export const getSubscriptions = () => request<RuleSubscription[]>('subscription/list');
export const saveSubscription = (data: Partial<RuleSubscription>) => request<RuleSubscription>('subscription/save', data);
export const deleteSubscription = (id: string) => request('subscription/remove', { id });
export const checkSubscription = (id: string) => request<SubscriptionCheckResult>('subscription/check', { id });
export const checkAllSubscriptions = () => request<SubscriptionCheckResult[]>('subscription/check-all');
