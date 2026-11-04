import type { Rule } from '@watch-everywhere/core';
import { JsonStore } from './store';

export interface ResourceItem {
  ruleId: string;
  /** 资源地址（规则解析出的 url，作为章节/剧集列表入口） */
  url: string;
  name: string;
  cover?: string;
  author?: string;
  chapter?: string;
  description?: string;
  contentType?: number;
  /** 收藏夹分组 id */
  groups?: string[];
  createTime: number;
  updateTime: number;
}

export interface FavoriteGroup {
  id: string;
  name: string;
  createTime: number;
}

export interface ChapterHistoryItem {
  ruleId: string;
  filePath: string;
  chapterPath: string;
  chapterName?: string;
  /** 阅读进度（十万分比）/ 视频播放秒数 */
  percentage: number;
  currentTime?: number;
  updateTime: number;
}

export interface AppConfig {
  [key: string]: any;
}

export const rulesStore = new JsonStore<Rule[]>('rules', []);
export const favoritesStore = new JsonStore<ResourceItem[]>('favorites', []);
export const historyStore = new JsonStore<ResourceItem[]>('history', []);
export const chapterHistoryStore = new JsonStore<ChapterHistoryItem[]>('chapter-history', []);
export const configStore = new JsonStore<AppConfig>('config', {});

export function flushAll() {
  [rulesStore, favoritesStore, historyStore, chapterHistoryStore, configStore].forEach((s) => s.flush());
}

export function sameResource(a: { ruleId?: string; url?: string }, b: { ruleId?: string; url?: string }) {
  return a.ruleId === b.ruleId && a.url === b.url;
}
