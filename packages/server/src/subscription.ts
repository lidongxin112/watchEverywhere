import { randomUUID } from 'node:crypto';
import { text2rules, type Rule } from '@watch-everywhere/core';
import { JsonStore } from './store';
import { rulesStore } from './db';

/**
 * 规则订阅
 *
 * 订阅地址指向一份规则 JSON（或 eso:// 压缩串、或返回它们的 URL），
 * 定时拉取后按「规则 id → (name, host)」匹配更新，保留用户本地的 cookies / 排序。
 */

export interface Subscription {
  id: string;
  name: string;
  url: string;
  /** 启动后自动检查 */
  autoUpdate: boolean;
  /** 检查间隔（小时） */
  intervalHours: number;
  lastCheck?: number;
  lastCount?: number;
  lastError?: string;
  createTime: number;
}

export const subscriptionStore = new JsonStore<Subscription[]>('subscriptions', []);

export interface CheckResult {
  id: string;
  name: string;
  added: number;
  updated: number;
  total: number;
  error?: string;
}

function ruleKey(r: Rule) {
  return `${r.name}@${r.host}`;
}

/** 把远端规则合并进本地：同 id 或同 name+host 视为同一条 */
function mergeRules(incoming: Rule[]): { added: number; updated: number } {
  const list = rulesStore.value;
  let added = 0;
  let updated = 0;

  for (const remote of incoming) {
    const idx = list.findIndex(
      (local) => local.id === remote.id || (local.name === remote.name && local.host === remote.host)
    );
    if (idx > -1) {
      const local = list[idx];
      list[idx] = {
        ...remote,
        // 本地改动要保留
        id: local.id,
        cookies: local.cookies ?? remote.cookies,
        sort: local.sort ?? remote.sort,
        createTime: local.createTime,
        modifiedTime: Date.now()
      };
      updated++;
    } else {
      list.push({ ...remote, id: remote.id || randomUUID(), createTime: remote.createTime || Date.now() });
      added++;
    }
  }
  if (added || updated) rulesStore.save();
  return { added, updated };
}

export async function checkSubscription(sub: Subscription): Promise<CheckResult> {
  const base: CheckResult = { id: sub.id, name: sub.name, added: 0, updated: 0, total: 0 };
  try {
    const rules = await text2rules(sub.url);
    if (!rules.length) throw new Error('订阅内容里没有可用规则');
    const { added, updated } = mergeRules(rules);
    Object.assign(sub, { lastCheck: Date.now(), lastCount: rules.length, lastError: '' });
    subscriptionStore.save();
    return { ...base, added, updated, total: rules.length };
  } catch (e: any) {
    const msg = String(e?.message || e);
    Object.assign(sub, { lastCheck: Date.now(), lastError: msg });
    subscriptionStore.save();
    return { ...base, error: msg };
  }
}

export async function checkAll(force = false): Promise<CheckResult[]> {
  const now = Date.now();
  const list = subscriptionStore.value.filter(
    (s) => force || (s.autoUpdate && (!s.lastCheck || now - s.lastCheck > (s.intervalHours || 6) * 3600_000))
  );
  const out: CheckResult[] = [];
  for (const sub of list) out.push(await checkSubscription(sub));
  return out;
}

/** 服务启动后延迟跑一次，之后每小时看一遍 */
export function startSubscriptionScheduler(): void {
  const tick = () => {
    checkAll().catch((e) => console.warn('[subscription] 检查失败', e?.message || e));
  };
  setTimeout(tick, 60_000);
  setInterval(tick, 60 * 60_000).unref?.();
}

export function createSubscription(input: Partial<Subscription>): Subscription {
  const row: Subscription = {
    id: input.id || randomUUID(),
    name: String(input.name || input.url || '未命名订阅'),
    url: String(input.url || ''),
    autoUpdate: input.autoUpdate !== false,
    intervalHours: Number(input.intervalHours) || 6,
    lastCheck: input.lastCheck,
    lastCount: input.lastCount,
    lastError: input.lastError,
    createTime: input.createTime || Date.now()
  };
  if (!row.url) throw new Error('需要订阅地址');
  return row;
}
