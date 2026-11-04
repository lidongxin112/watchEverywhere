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
  /** 收藏夹分组 id 列表 */
  groups?: string[];
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

export interface PendingUpdate {
  version: string;
  file: string;
  size: number;
  sha256: string;
  verified: boolean;
  downloadedAt: number;
}

export const getAppInfo = () => request<AppInfo>('app/info');
export const downloadAppUpdate = () => request<PendingUpdate>('app/update-download', {}, false);
export const getPendingUpdate = () => request<PendingUpdate | null>('app/update-pending', {}, false);
export const applyAppUpdate = () => request<{ script: string; restarting: boolean }>('app/update-apply', {}, false);
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

// ======================= 备份 / 诊断 =======================

export interface RuleBackup {
  file: string;
  size: number;
  time: number;
  count: number;
}

export const getRuleBackups = () => request<RuleBackup[]>('resource-rule/backups', {}, false);
export const restoreRuleBackup = (file: string) => request<number>('resource-rule/restore-backup', { file }, false);

export interface AppLogs {
  generatedAt: number;
  version: string;
  platform: string;
  standalone: boolean;
  node: string;
  dataDir: string;
  ruleCount: number;
  logs: { time: number; level: string; scope: string; message: string }[];
}

export const getAppLogs = () => request<AppLogs>('app/logs', {}, false);

/** 前端错误上报（写进服务端诊断日志） */
export const postClientLog = (data: { level?: string; scope?: string; message: string; extra?: Record<string, any> }) =>
  request('app/client-log', data, false);

// ======================= 字幕 =======================

export interface SubtitleMeta {
  lan: string;
  lan_doc: string;
  url: string;
}

export interface SubtitleCue {
  from: number;
  to: number;
  text: string;
}

export const getBiliSubtitles = (data: { cid?: string; bvid?: string; epId?: string; cookie?: string }) =>
  request<{ code: number; subtitles: SubtitleMeta[]; msg?: string }>('subtitle/bili-list', data, false);

export const fetchBiliSubtitle = (url: string) => request<SubtitleCue[]>('subtitle/bili-fetch', { url }, false);

// ======================= 规则市场 =======================

export interface MarketItem {
  id: string;
  name: string;
  host: string;
  contentType: number;
  description?: string;
  tags?: string[];
  installed: boolean;
}

export const getMarket = () => request<MarketItem[]>('market/list', {}, false);
export const installMarketRule = (id: string) => request('market/install', { id }, false);

// ======================= 收藏分组 =======================

export interface FavoriteGroup {
  id: string;
  name: string;
  createTime: number;
}

export const getFavoriteGroups = () => request<FavoriteGroup[]>('resource-favorites/groups', {}, false);
export const saveFavoriteGroup = (data: { id?: string; name: string }) =>
  request<FavoriteGroup[]>('resource-favorites/group-save', data, false);
export const removeFavoriteGroup = (id: string) => request<FavoriteGroup[]>('resource-favorites/group-remove', { id }, false);
export const assignFavoriteGroups = (data: { items: { ruleId: string; url: string }[]; groups: string[]; mode?: 'add' | 'set' }) =>
  request<number>('resource-favorites/assign-groups', data, false);
export const bulkUnstar = (items: { ruleId: string; url: string }[]) =>
  request<number>('resource-favorites/bulk-unstar', { items }, false);

// ======================= 追更 =======================

export interface WatchItem {
  id: string;
  ruleId: string;
  url: string;
  name: string;
  cover?: string;
  contentType?: number;
  lastCount: number;
  lastEpisode?: number;
  lastChapter?: string;
  seenCount?: number;
  seenEpisode?: number;
  newCount: number;
  newEpisodes?: string[];
  /** 指定追的线路 / 字幕组；空 = 自动 */
  road?: string;
  trackingRoad?: string;
  trackingGroup?: string;
  roads?: WatchRoad[];
  notify?: boolean;
  lastCheck?: number;
  lastUpdate?: number;
  lastError?: string;
  createTime: number;
}

export interface WatchRoad {
  name: string;
  count: number;
  latest: number;
  latestName: string;
  group: string;
}

export interface WatchCheckRow {
  id: string;
  name: string;
  newCount: number;
  total: number;
  /** 这次检查新发现的集 */
  fresh?: string[];
  error?: string;
}

export const getWatchList = () => request<WatchItem[]>('watch/list', {}, false);
export const addWatch = (data: { ruleId: string; url: string; name: string; cover?: string; contentType?: number }) =>
  request<WatchItem>('watch/add', data, false);
export const removeWatch = (id: string) => request('watch/remove', { id }, false);
export const checkWatch = (id?: string) => request<WatchCheckRow[]>('watch/check', { id }, false);
export const clearWatchNew = (id: string) => request('watch/clear-new', { id }, false);
export const updateWatch = (data: { id: string; road?: string | null; notify?: boolean }) => request<WatchItem>('watch/update', data);

// ---------------- 消息推送 ----------------
export type NotifyChannelType = 'bark' | 'wecom' | 'feishu' | 'dingtalk' | 'webhook';
export interface NotifyChannel {
  id?: string;
  type: NotifyChannelType;
  name: string;
  url: string;
  enabled: boolean;
}
export interface NotifyConfig {
  channels: NotifyChannel[];
  watchInterval: number;
}
export const getNotifyConfig = () => request<NotifyConfig>('notify/config/read', {}, false);
export const saveNotifyConfig = (data: Partial<NotifyConfig>) => request<NotifyConfig>('notify/config/save', data);
export const testNotify = (channel: NotifyChannel) => request('notify/test', { channel });

// ---------------- AI 问片 ----------------
export interface AiConfigView {
  baseUrl: string;
  model: string;
  hasKey: boolean;
  keyPreview: string;
}
export interface AiMediaHit {
  ruleId: string;
  rule: string;
  contentType: number;
  name: string;
  url: string;
  cover?: string;
  author?: string;
  chapter?: string;
  description?: string;
}
export type AiChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; keyword: string; contentType?: string; results: AiMediaHit[] }
  | { type: 'error'; message: string }
  | { type: 'done' };

export const getAiConfig = () => request<AiConfigView>('ai/config/read', {}, false);
export const saveAiConfig = (data: { baseUrl: string; model: string; apiKey?: string; clearKey?: boolean }) =>
  request<AiConfigView>('ai/config/save', data);
export const testAi = () => request<{ reply: string; model: string }>('ai/test');
export const getAiReview = (data: { name: string; description?: string; author?: string; force?: boolean }) =>
  request<{ text: string; cached: boolean }>('ai/review', data);

/** 流式对话：逐个回调服务端事件 */
export async function streamAiChat(messages: { role: string; content: string }[], onEvent: (e: AiChatEvent) => void, signal?: AbortSignal) {
  const base = (import.meta.env.VITE_API_BASE as string) || '/api';
  const res = await fetch(`${base}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()));
      } catch {
        /* ignore */
      }
    }
  }
}

// ======================= 豆瓣短评 =======================

export interface DoubanComment {
  author: string;
  rating: number;
  text: string;
  votes: number;
  time: string;
}

export interface DoubanResult {
  ok: boolean;
  subjectId?: string;
  title?: string;
  year?: string;
  comments: DoubanComment[];
  message?: string;
}

export const getDoubanComments = (data: { name: string; year?: string }) =>
  request<DoubanResult>('meta/douban-comments', data, false);

// ======================= 磁力搜索 =======================

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
  detailUrl?: string;
  torrentUrl?: string;
}

export interface MagnetSourceStatus {
  name: string;
  count: number;
  ok: boolean;
  ms: number;
  error?: string;
}

export interface MagnetSearchResult {
  items: MagnetItem[];
  sources: MagnetSourceStatus[];
  primaryOk: boolean;
  pending?: boolean;
  pendingOther?: boolean;
}

export const searchMagnet = (data: { keyword: string; sources?: string[] }) =>
  request<MagnetSearchResult>('magnet/search', data, false);

export const resolveMagnet = (data: { torrentUrl: string; title: string }) =>
  request<{ infohash: string; magnet: string }>('magnet/resolve', data, false);

// ======================= 多源同片 =======================

export interface SameSource {
  ruleId: string;
  rule: string;
  contentType: number;
  name: string;
  url: string;
  cover?: string;
  chapter?: string;
  episode?: number | null;
}

export const getSameSources = (data: { name: string; contentType?: number; excludeRuleId?: string }) =>
  request<SameSource[]>('aggregate/same', data, false);

// ======================= 磁力源探测 / 代理 =======================

export interface MagnetSourceProbe {
  key: string;
  name: string;
  host: string;
  needsProxy: boolean;
  direct?: boolean;
  viaProxy?: boolean;
  ms?: number;
  error?: string;
}

export const probeMagnetSources = () =>
  request<{ proxy: string | null; sources: MagnetSourceProbe[] }>('magnet/sources', {}, false);

export const readMagnetProxy = () => request<{ url: string } | null>('magnet/proxy-read', {}, false);
export const saveMagnetProxy = (url: string) => request<{ url: string }>('magnet/proxy-save', { url }, false);
