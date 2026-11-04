import { randomUUID } from 'node:crypto';
import { RuleManager, type Rule } from '@watch-everywhere/core';
import { JsonStore } from './store';
import { getRule } from './db';
import { pushLog } from './logs';
import { episodeNumber, pickRoad, summarizeRoads, type RoadSummary } from './episode';
import { getNotifyConfig, notifyAll } from './notify';

/**
 * 追更 / 追番订阅
 *
 * - 自动识别集数（第12集 / EP12 / S01E12 / 第十二话 / [12] …），按集数判断更新，识别不出时按条目数
 * - 多线路时自动识别字幕组，默认追最新的线路，也可以指定只追某条线路 / 某个字幕组
 * - 「已看到」和「最新」分开记录：新集角标会一直保留到用户点「标记已读」
 * - 有更新时推送提醒（Bark / 企业微信 / 飞书 / 钉钉 / Webhook），检查间隔可设置
 */

export interface WatchItem {
  id: string;
  ruleId: string;
  /** 详情页地址（章节列表入口） */
  url: string;
  name: string;
  cover?: string;
  contentType?: number;
  /** 最新：条目数 / 集数 / 最新一集名字 */
  lastCount: number;
  lastEpisode?: number;
  lastChapter?: string;
  /** 已看到（标记已读时更新） */
  seenCount?: number;
  seenEpisode?: number;
  /** 未读新集数 */
  newCount: number;
  /** 新增的集名（最近几集，用于提示） */
  newEpisodes?: string[];
  /** 指定追的线路名或字幕组；空表示自动选择最新的线路 */
  road?: string;
  /** 当前实际在追的线路 / 字幕组 */
  trackingRoad?: string;
  trackingGroup?: string;
  /** 各线路概况（给前端选择线路用） */
  roads?: RoadSummary[];
  /** 是否推送提醒，默认开 */
  notify?: boolean;
  lastCheck?: number;
  /** 最近一次发现更新的时间 */
  lastUpdate?: number;
  lastError?: string;
  createTime: number;
}

export const watchStore = new JsonStore<WatchItem[]>('watch', []);

export interface WatchCheckRow {
  id: string;
  name: string;
  newCount: number;
  total: number;
  /** 这次检查新发现的集 */
  fresh: string[];
  error?: string;
}

/** 老数据迁移：以前只有 lastCount/newCount */
function migrate(item: WatchItem) {
  if (item.seenCount === undefined) item.seenCount = Math.max(0, (item.lastCount || 0) - (item.newCount || 0));
}

interface Snapshot {
  count: number;
  episode: number;
  latestName: string;
  names: { name: string; ep: number | null }[];
  road?: RoadSummary;
  roads: RoadSummary[];
}

export function snapshot(list: { name: string; road?: string }[], preferred?: string): Snapshot {
  const roads = summarizeRoads(list);
  const road = pickRoad(roads, preferred || undefined);
  const chapters = road ? list.filter((c) => (c.road || '') === road.name) : list;
  return {
    count: chapters.length,
    episode: road?.latest || 0,
    latestName: road?.latestName || chapters[chapters.length - 1]?.name || '',
    names: chapters.map((c) => ({ name: c.name, ep: episodeNumber(c.name) })),
    road,
    roads
  };
}

/**
 * 根据最新目录更新追更状态（纯逻辑，便于测试）
 * @returns 这次新发现的集名
 */
export function applySnapshot(item: WatchItem, snap: Snapshot, now = Date.now()): string[] {
  migrate(item);
  const first = !item.lastCheck && !item.lastCount;
  const useEpisode = snap.episode > 0;
  const prevLatestEp = item.lastEpisode || 0;
  const prevCount = item.lastCount || 0;

  let fresh: string[] = [];
  if (!first) {
    if (useEpisode && prevLatestEp > 0) {
      if (snap.episode > prevLatestEp) fresh = snap.names.filter((n) => n.ep !== null && n.ep > prevLatestEp).map((n) => n.name);
    } else if (prevCount > 0 && snap.count > prevCount) {
      // 以前没识别过集数（老数据 / 识别不出）：按条目数
      fresh = snap.names.slice(prevCount).map((n) => n.name);
    }
  }

  item.lastCount = snap.count;
  item.lastEpisode = snap.episode || undefined;
  item.lastChapter = snap.latestName || item.lastChapter;
  item.trackingRoad = snap.road?.name;
  item.trackingGroup = snap.road?.group || undefined;
  item.roads = snap.roads.length > 1 ? snap.roads : undefined;
  if (first) {
    item.seenCount = snap.count;
    item.seenEpisode = snap.episode || undefined;
  }
  // 换了线路后集数可能变小：已看到的不能超过最新
  if (useEpisode && item.seenEpisode === undefined) item.seenEpisode = Math.min(prevLatestEp || snap.episode, snap.episode);
  item.newCount = useEpisode
    ? Math.max(0, snap.episode - (item.seenEpisode ?? snap.episode))
    : Math.max(0, snap.count - (item.seenCount ?? snap.count));
  if (fresh.length) {
    item.newEpisodes = [...(item.newEpisodes || []), ...fresh].slice(-10);
    item.lastUpdate = now;
  }
  if (!item.newCount) item.newEpisodes = [];
  item.lastCheck = now;
  item.lastError = '';
  return fresh;
}

/** 标记已读：已看到 = 最新 */
export function markSeen(item: WatchItem) {
  item.seenCount = item.lastCount;
  item.seenEpisode = item.lastEpisode;
  item.newCount = 0;
  item.newEpisodes = [];
}

async function checkOne(item: WatchItem, rule?: Rule): Promise<WatchCheckRow> {
  try {
    const r = rule || getRule(item.ruleId);
    const list = await new RuleManager(r).getChapter(item.url);
    if (!list.length) throw new Error('目录为空，可能规则失效或站点改版');
    const fresh = applySnapshot(item, snapshot(list, item.road));
    return { id: item.id, name: item.name, newCount: item.newCount, total: item.lastCount, fresh };
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 200);
    item.lastCheck = Date.now();
    item.lastError = msg;
    pushLog('warn', 'watch/check', `${item.name} 检查失败：${msg}`);
    return { id: item.id, name: item.name, newCount: item.newCount || 0, total: item.lastCount, fresh: [], error: msg };
  }
}

function episodeLabel(item: WatchItem) {
  if (item.lastEpisode) return `更新到第 ${item.lastEpisode} 集`;
  return `共 ${item.lastCount} 集`;
}

async function pushUpdates(rows: WatchCheckRow[]) {
  const updated = rows
    .filter((r) => r.fresh.length)
    .map((r) => watchStore.value.find((w) => w.id === r.id))
    .filter((w): w is WatchItem => !!w && w.notify !== false);
  if (!updated.length || !getNotifyConfig().channels.some((c) => c.enabled)) return;
  const title = updated.length === 1 ? `${updated[0].name} 更新了` : `${updated.length} 部追更有更新`;
  const body = updated
    .map((w) => `${w.name}：${episodeLabel(w)}${w.trackingGroup ? `（${w.trackingGroup}）` : ''}，新增 ${(w.newEpisodes || []).slice(-3).join('、')}`)
    .join('\n');
  await notifyAll({
    title,
    body,
    data: updated.map((w) => ({ name: w.name, episode: w.lastEpisode, count: w.lastCount, newEpisodes: w.newEpisodes, group: w.trackingGroup }))
  });
}

let checking: Promise<WatchCheckRow[]> | null = null;

export async function checkWatch(id?: string): Promise<WatchCheckRow[]> {
  // 定时检查和手动检查撞车时复用同一次
  if (!id && checking) return checking;
  const run = (async () => {
    const rules = new Map<string, Rule>();
    const targets = id ? watchStore.value.filter((w) => w.id === id) : watchStore.value;
    const out: WatchCheckRow[] = [];
    for (const item of targets) {
      let rule = rules.get(item.ruleId);
      try {
        rule = rule || getRule(item.ruleId);
        rules.set(item.ruleId, rule);
      } catch {
        /* 规则没了，checkOne 里会记录错误 */
      }
      out.push(await checkOne(item, rule));
    }
    if (targets.length) watchStore.save();
    await pushUpdates(out).catch((e) => pushLog('warn', 'notify', String(e?.message || e)));
    return out;
  })();
  if (!id) {
    checking = run;
    run.finally(() => (checking = null));
  }
  return run;
}

let timer: NodeJS.Timeout | null = null;

function schedule(delay: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    if (watchStore.value.length) await checkWatch().catch((e) => console.warn('[watch] 检查失败', e?.message || e));
    schedule(getNotifyConfig().watchInterval * 60_000);
  }, delay);
  timer.unref?.();
}

/** 启动后 2 分钟检查一次，之后按设置的间隔（默认 60 分钟） */
export function startWatchScheduler(): void {
  schedule(120_000);
}

/** 修改间隔后按新间隔重新计时 */
export function rescheduleWatch() {
  if (timer) schedule(getNotifyConfig().watchInterval * 60_000);
}

export function createWatch(input: Partial<WatchItem>): WatchItem {
  if (!input.ruleId || !input.url) throw new Error('缺少规则或地址');
  const exists = watchStore.value.find((w) => w.ruleId === input.ruleId && w.url === input.url);
  if (exists) return exists;
  const row: WatchItem = {
    id: randomUUID(),
    ruleId: String(input.ruleId),
    url: String(input.url),
    name: String(input.name || '未命名'),
    cover: input.cover,
    contentType: input.contentType,
    lastCount: 0,
    newCount: 0,
    notify: true,
    createTime: Date.now()
  };
  watchStore.value.push(row);
  watchStore.save();
  return row;
}

/** 修改追更设置：指定线路 / 字幕组、是否提醒 */
export function updateWatch(input: { id: string; road?: string | null; notify?: boolean }): WatchItem {
  const item = watchStore.value.find((w) => w.id === input.id);
  if (!item) throw new Error('追更不存在');
  if (input.road !== undefined) {
    const next = input.road || undefined;
    if (next !== item.road) {
      item.road = next;
      // 换线路后以新线路的当前进度为起点，避免误报一堆“新集”
      item.lastCheck = undefined;
      item.lastCount = 0;
      item.lastEpisode = undefined;
      item.seenCount = undefined;
      item.seenEpisode = undefined;
      item.newCount = 0;
      item.newEpisodes = [];
    }
  }
  if (input.notify !== undefined) item.notify = !!input.notify;
  watchStore.save();
  return item;
}
