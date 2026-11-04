import fs from 'node:fs';
import path from 'node:path';
import type { Rule } from '@watch-everywhere/core';
import { rulesStore } from './db';

/**
 * 规则市场
 *
 * 内置索引 rules/market.json（随程序发布），每条带完整规则，
 * 点“添加”即导入；已安装的按 name+host 标记。
 * 也支持追加远程索引（WE_MARKET_URL），格式相同。
 */

export interface MarketItem {
  id: string;
  name: string;
  host: string;
  contentType: number;
  description?: string;
  tags?: string[];
  rule: Rule;
}

const CANDIDATES = [
  path.resolve(process.cwd(), 'rules/market.json'),
  path.resolve(process.cwd(), '../../rules/market.json'),
  path.resolve(typeof __dirname !== 'undefined' ? __dirname : process.cwd(), '../../rules/market.json')
];

function readLocal(): MarketItem[] {
  const file = CANDIDATES.find((p) => fs.existsSync(p));
  if (!file) return [];
  try {
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function readRemote(url: string): Promise<MarketItem[]> {
  if (!/^https?:\/\//i.test(url)) return [];
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function listMarket(): Promise<(MarketItem & { installed: boolean })[]> {
  const local = readLocal();
  const remote = process.env.WE_MARKET_URL ? await readRemote(process.env.WE_MARKET_URL) : [];
  const all = [...local, ...remote];
  const installed = new Set(rulesStore.value.map((r) => `${r.name}@${r.host}`));
  return all.map((item) => ({ ...item, installed: installed.has(`${item.name}@${item.host}`) }));
}

export async function installFromMarket(id: string): Promise<Rule> {
  const all = await listMarket();
  const hit = all.find((x) => x.id === id || x.name === id);
  if (!hit) throw new Error('市场里没有这条规则');
  const rules = rulesStore.value;
  const idx = rules.findIndex((r) => r.name === hit.name && r.host === hit.host);
  const rule = { ...hit.rule };
  if (idx > -1) {
    // 已存在就更新，保留本地 cookie / 排序
    rules[idx] = { ...rule, id: rules[idx].id, cookies: rules[idx].cookies, sort: rules[idx].sort };
  } else {
    rules.push({ ...rule, createTime: Date.now() });
  }
  rulesStore.save();
  return rule;
}
