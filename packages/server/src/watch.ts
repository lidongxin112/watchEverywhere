import { randomUUID } from 'node:crypto';
import { RuleManager, type Rule } from '@watch-everywhere/core';
import { JsonStore } from './store';
import { getRule } from './db';
import { pushLog } from './logs';

/**
 * 追更订阅
 *
 * 记录「作品 + 上次看到的集数」，定时重新拉一次目录，
 * 有新增集数就标出来（首页追更列表 + 顶部提示条）。
 */

export interface WatchItem {
  id: string;
  ruleId: string;
  /** 详情页地址（章节列表入口） */
  url: string;
  name: string;
  cover?: string;
  contentType?: number;
  /** 上次检查到的集数 */
  lastCount: number;
  lastChapter?: string;
  /** 新增集数（未读） */
  newCount: number;
  lastCheck?: number;
  lastError?: string;
  createTime: number;
}

export const watchStore = new JsonStore<WatchItem[]>('watch', []);

export interface WatchCheckRow {
  id: string;
  name: string;
  newCount: number;
  total: number;
  error?: string;
}

async function checkOne(item: WatchItem, rule?: Rule): Promise<WatchCheckRow> {
  const r = rule || getRule(item.ruleId);
  try {
    const list = await new RuleManager(r).getChapter(item.url);
    const total = list.length;
    const last = list[list.length - 1]?.name || '';
    if (!item.lastCount) {
      item.lastCount = total;
      item.lastChapter = last;
      item.newCount = 0;
    } else if (total > item.lastCount) {
      item.newCount = total - item.lastCount;
    } else {
      item.newCount = 0;
    }
    item.lastCount = Math.max(item.lastCount, total);
    item.lastChapter = last || item.lastChapter;
    item.lastCheck = Date.now();
    item.lastError = '';
    return { id: item.id, name: item.name, newCount: item.newCount, total };
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 200);
    item.lastCheck = Date.now();
    item.lastError = msg;
    pushLog('warn', 'watch/check', `${item.name} 检查失败：${msg}`);
    return { id: item.id, name: item.name, newCount: 0, total: item.lastCount, error: msg };
  }
}

export async function checkWatch(id?: string): Promise<WatchCheckRow[]> {
  const rules = new Map<string, Rule>();
  const targets = id ? watchStore.value.filter((w) => w.id === id) : watchStore.value;
  const out: WatchCheckRow[] = [];
  for (const item of targets) {
    const rule = rules.get(item.ruleId) || getRule(item.ruleId);
    rules.set(item.ruleId, rule);
    out.push(await checkOne(item, rule));
  }
  if (targets.length) watchStore.save();
  return out;
}

/** 启动后延迟检查一次，之后每小时一次 */
export function startWatchScheduler(): void {
  const tick = () => {
    if (!watchStore.value.length) return;
    checkWatch().catch((e) => console.warn('[watch] 检查失败', e?.message || e));
  };
  setTimeout(tick, 120_000);
  setInterval(tick, 60 * 60_000).unref?.();
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
    createTime: Date.now()
  };
  watchStore.value.push(row);
  watchStore.save();
  return row;
}
