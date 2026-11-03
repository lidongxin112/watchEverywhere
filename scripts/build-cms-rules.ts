#!/usr/bin/env node
/**
 * 把苹果CMS v10 资源站接口转成规则，追加进 rules/aggregate.json
 *
 *   npx tsx scripts/build-cms-rules.ts                # 用下面的默认列表
 *   npx tsx scripts/build-cms-rules.ts <接口地址> ...  # 指定接口
 *
 * 资源站给的是「分类 + 多线路 + 直链 m3u8」，比单站抓页面稳定得多。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cmsUrlToRule, type Rule } from '@watch-everywhere/core';

const file = path.resolve(import.meta.dirname, '../rules/aggregate.json');

/** name+host 派生固定 id，重复生成不会漂移 */
function stableRuleId(name: string, host: string) {
  const h = crypto.createHash('sha256').update(`${name}@${host}`).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), '5' + h.slice(13, 16), ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + h.slice(18, 20), h.slice(20, 32)].join('-');
}

/** 默认几个公开接口（失效就换掉） */
const DEFAULT_APIS = [
  'https://cj.lziapi.com/api.php/provide/vod/',
  'https://ffzy5.tv/api.php/provide/vod',
  'https://api.guangsuapi.com/api.php/provide/vod'
];

/**
 * 资源站的播放页是 HTML（里面用 JS 拼 m3u8），
 * 这里从页面里把 `const url = "...m3u8"` 抠出来，再转成绝对地址。
 */
const PLAY_JS = String.raw`@js:(() => {
  const page = String(result || '');
  let rel = '';
  const m = page.match(/(?:const|var|let)\s+(?:url|main|video_url|videoUrl)\s*=\s*["']([^"']+)["']/);
  if (m) rel = m[1];
  if (!rel) {
    const d = page.match(/https?:[^"'\s]+\.m3u8[^"'\s]*/i);
    if (d) return [d[0]];
    return lastResult ? [String(lastResult)] : [];
  }
  try {
    return [new URL(rel, String(lastResult || '')).href];
  } catch (e) {
    return [rel];
  }
})()`;

async function main() {
  const apis = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_APIS;
  const rules: Rule[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  const previous = rules.filter((r) => r.group?.startsWith('资源站'));
  const kept = rules.filter((r) => !r.group?.startsWith('资源站'));

  for (const api of apis) {
    try {
      const rule = await cmsUrlToRule(api);
      rule.name = `资源站 · ${new URL(api).hostname}`;
      rule.id = stableRuleId(rule.name, rule.host);
      rule.group = '资源站';
      rule.sort = -10;
      rule.contentUrl = '';
      rule.contentItems = PLAY_JS;
      console.log(`+ ${rule.name}  分类 ${rule.discoverUrl.split('\n').length - 1} 个`);
      kept.push(rule);
    } catch (e: any) {
      console.warn(`! ${api} 生成失败: ${e?.message || e}（保留旧规则）`);
      const old = previous.find((r) => r.host === new URL(api).origin);
      if (old) kept.push(old);
    }
  }

  fs.writeFileSync(file, JSON.stringify(kept, null, 2));
  console.log(`\n规则包共 ${kept.length} 条 -> ${file}`);
}

main();
