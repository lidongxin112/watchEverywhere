import type { Rule } from '@watch-everywhere/core';
import { chapterHistoryStore, favoritesStore, historyStore, rulesStore } from './db';
import { pushLog } from './logs';

/**
 * 修复收藏 / 历史的规则绑定
 *
 * 规则 id 之前是随机生成，重建规则后会换 id，导致老收藏点开报“规则不存在”。
 * 这里按「资源地址的域名」重新找回对应规则，把 ruleId 重新绑上。
 */

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function matchRule(url: string, rules: Rule[]): Rule | undefined {
  const host = hostOf(url);
  if (!host) return undefined;
  const hosts = rules.map((r) => ({ rule: r, h: hostOf(r.host) })).filter((x) => x.h);
  // 先精确匹配，再互相包含（www / 子域差异）
  const exact = hosts.find((x) => x.h === host);
  if (exact) return exact.rule;
  const loose = hosts.find((x) => host.endsWith(x.h) || x.h.endsWith(host));
  return loose?.rule;
}

export interface RepairResult {
  favorites: number;
  history: number;
  chapterHistory: number;
  dropped: number;
}

export function repairResources(): RepairResult {
  const rules = rulesStore.value;
  const alive = new Set(rules.map((r) => r.id));
  const result: RepairResult = { favorites: 0, history: 0, chapterHistory: 0, dropped: 0 };

  const fix = (store: typeof favoritesStore, key: 'favorites' | 'history', withUrl: boolean) => {
    let changed = false;
    const next = store.value.filter((item) => {
      if (alive.has(item.ruleId)) return true;
      if (withUrl) {
        const hit = matchRule(item.url, rules);
        if (hit) {
          item.ruleId = hit.id;
          result[key]++;
          changed = true;
          return true;
        }
      }
      result.dropped++;
      changed = true;
      return false;
    });
    if (changed) store.set(next);
  };

  fix(favoritesStore, 'favorites', true);
  fix(historyStore, 'history', true);

  // 阅读/播放进度没有 url，按「同一条收藏/历史里出现过的 filePath 域名」尽量找回
  let changed = false;
  const nextChapter = chapterHistoryStore.value.filter((row) => {
    if (alive.has(row.ruleId)) return true;
    const hit = matchRule(String(row.filePath || ''), rules);
    if (hit) {
      row.ruleId = hit.id;
      result.chapterHistory++;
      changed = true;
      return true;
    }
    result.dropped++;
    changed = true;
    return false;
  });
  if (changed) chapterHistoryStore.set(nextChapter);

  if (result.favorites || result.history || result.chapterHistory || result.dropped) {
    pushLog('info', 'repair', '收藏/历史重新绑定', result);
  }
  return result;
}
