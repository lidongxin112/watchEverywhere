#!/usr/bin/env node
/**
 * 规则冒烟测试：发现 / 搜索 / 章节 / 播放地址 全链路跑一遍
 *
 *   npx tsx scripts/check-rules.ts            # 全部规则，关键词 鬼灭
 *   npx tsx scripts/check-rules.ts 鬼灭 2     # 自定义关键词，只跑第 2 条规则
 */
import fs from 'node:fs';
import path from 'node:path';
import { RuleManager, type Rule } from '@watch-everywhere/core';

const file = path.resolve(import.meta.dirname, '../rules/aggregate.json');
const rules: Rule[] = JSON.parse(fs.readFileSync(file, 'utf8'));

const keyword = process.argv[2] || '鬼灭';
const only = process.argv[3] ? Number(process.argv[3]) : 0;

const cut = (s: unknown, n = 90) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, n);

async function check(rule: Rule, index: number) {
  const rm = new RuleManager(rule);
  const line = (label: string, ok: boolean, detail: string) =>
    console.log(`  ${ok ? '✓' : '✗'} ${label}: ${cut(detail)}`);

  console.log(`\n[${index}] ${rule.name}  ${rule.host}`);

  if (rule.enableDiscover) {
    try {
      const map = await rm.discoverMap();
      const tab = map[0];
      console.log(`  · 发现分类: ${map.map((m) => `${m.name}(${m.pairs.length})`).join(' / ')}`);
      const list = await rm.discover(tab.pairs[0].value, 1);
      line('discover', list.length > 0, `${list.length} 条 | ${list[0]?.name} | ${list[0]?.url}`);
      if (list[0]) {
        console.log(`      cover: ${cut(list[0].cover, 100)}`);
      }
    } catch (e: any) {
      line('discover', false, e?.message || e);
    }
  }

  let first: any = null;
  if (rule.enableSearch) {
    try {
      const list = await new RuleManager(rule).search(keyword, 1);
      first = list[0];
      line('search', list.length > 0, `${list.length} 条 | ${first?.name} | ${first?.url}`);
      if (first) console.log(`      cover: ${cut(first.cover, 100)} | chapter: ${cut(first.chapter, 40)}`);
    } catch (e: any) {
      line('search', false, e?.message || e);
    }
  }

  if (!first && rule.enableDiscover) {
    try {
      const map = await rm.discoverMap();
      const list = await rm.discover(map[0].pairs[0].value, 1);
      first = list[0];
    } catch {
      /* ignore */
    }
  }
  if (!first) return;

  let chapter: any = null;
  try {
    const chapters = await new RuleManager(rule).getChapter(first.url);
    chapter = chapters[0];
    const roads = [...new Set(chapters.map((c) => c.road).filter(Boolean))];
    line('chapter', chapters.length > 0, `${chapters.length} 集${roads.length ? ` | 线路 ${roads.join('/')}` : ''} | ${chapter?.name} | ${chapter?.url}`);
  } catch (e: any) {
    line('chapter', false, e?.message || e);
    return;
  }
  if (!chapter) return;

  try {
    const content = await new RuleManager(rule).getContent(chapter.url);
    line('content', content.length > 0, `${content.length} 条 | ${content[0]}`);
  } catch (e: any) {
    line('content', false, e?.message || e);
  }
}

for (let i = 0; i < rules.length; i++) {
  if (only && only !== i + 1) continue;
  await check(rules[i], i + 1);
}
