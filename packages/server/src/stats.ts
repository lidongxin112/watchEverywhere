import { JsonStore } from './store';

/**
 * 规则健康度统计
 *
 * 每条规则记：搜索/目录/正文 的成功、失败次数，最近一次错误和时间。
 * 目的：让"某条源突然不好用了"能被看见，而不是表现为"搜不到"。
 */

export interface RuleStat {
  searchOk: number;
  searchFail: number;
  chapterOk: number;
  chapterFail: number;
  contentOk: number;
  contentFail: number;
  lastError?: string;
  lastErrorAt?: number;
  lastOkAt?: number;
  /** 最近一次操作耗时中位数（毫秒，粗略用最近值） */
  lastMs?: number;
}

export type StatKind = 'search' | 'chapter' | 'content';

export const statsStore = new JsonStore<Record<string, RuleStat>>('rule-stats', {});

const EMPTY: RuleStat = {
  searchOk: 0,
  searchFail: 0,
  chapterOk: 0,
  chapterFail: 0,
  contentOk: 0,
  contentFail: 0
};

export function getStat(ruleId: string): RuleStat {
  return statsStore.value[ruleId] || { ...EMPTY };
}

export function recordStat(ruleId: string, kind: StatKind, ok: boolean, extra?: { ms?: number; error?: string }) {
  if (!ruleId) return;
  const all = statsStore.value;
  const row = { ...(all[ruleId] || EMPTY) };
  if (kind === 'search') {
    if (ok) row.searchOk++;
    else row.searchFail++;
  } else if (kind === 'chapter') {
    if (ok) row.chapterOk++;
    else row.chapterFail++;
  } else if (ok) {
    row.contentOk++;
  } else {
    row.contentFail++;
  }
  if (ok) {
    row.lastOkAt = Date.now();
    if (extra?.ms) row.lastMs = extra.ms;
  } else {
    row.lastError = String(extra?.error || '').slice(0, 200);
    row.lastErrorAt = Date.now();
  }
  all[ruleId] = row;
  statsStore.save();
}

/** 成功率（0~1），没数据返回 null */
export function successRate(row: RuleStat): number | null {
  const ok = row.searchOk + row.chapterOk + row.contentOk;
  const fail = row.searchFail + row.chapterFail + row.contentFail;
  if (!ok && !fail) return null;
  return ok / (ok + fail);
}

export function healthLevel(row: RuleStat): 'good' | 'ok' | 'bad' | 'unknown' {
  const rate = successRate(row);
  if (rate === null) return 'unknown';
  if (rate >= 0.9) return 'good';
  if (rate >= 0.6) return 'ok';
  return 'bad';
}

export function resetStat(ruleId: string) {
  const all = statsStore.value;
  delete all[ruleId];
  statsStore.save();
}
