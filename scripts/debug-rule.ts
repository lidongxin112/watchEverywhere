#!/usr/bin/env node
/**
 * 单条规则调试：打印 URL 规则实际请求的地址和响应片段
 *
 *   npx tsx scripts/debug-rule.ts 腾讯视频 search 鬼灭
 *   npx tsx scripts/debug-rule.ts 腾讯视频 chapter https://xxx
 *   npx tsx scripts/debug-rule.ts 腾讯视频 content  <chapterPath>
 */
import fs from 'node:fs';
import path from 'node:path';
import { RuleManager, fetch, parseRequest, type Rule } from '@watch-everywhere/core';

const rules: Rule[] = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, '../rules/aggregate.json'), 'utf8')
);

const [name, step, arg] = process.argv.slice(2);
const rule = rules.find((r) => r.name === name);
if (!rule) {
  console.error('没有这条规则，可用：', rules.map((r) => r.name).join(', '));
  process.exit(1);
}

const rm = new RuleManager(rule);

async function dump(label: string, urlRule: string, vars: Record<string, any>) {
  rm.engine.setEnvironment({ ...vars, $keyword: vars.keyword, keyword: vars.keyword, $page: vars.page || 1, page: vars.page || 1 });
  const parsed = await rm.analyzer.parseJsUrl(urlRule);
  console.log(`\n=== ${label} ===`);
  console.log('raw rule:', String(urlRule).slice(0, 200));
  console.log('parsed:', typeof parsed === 'string' ? parsed.slice(0, 300) : parsed);
  const params = parseRequest(parsed as any, rule, vars as any);
  console.log('request:', params.method?.toUpperCase(), params.url, JSON.stringify(params.headers));
  const res = await fetch(params).catch((e) => ({ body: `ERROR: ${e.message}` }) as any);
  console.log('body:', String(res.body).slice(0, 800).replace(/\n/g, ' '));
  return res.body;
}

const keyword = arg || '鬼灭';
if (step === 'search') {
  const body = await dump('search', rule.searchUrl, { keyword, page: 1 });
  console.log('\nsearchList ->', await rm.analyzer.getStringList(rule.searchList, body).then((x) => x.length));
} else if (step === 'discover') {
  const map = await rm.discoverMap();
  const value = map[0].pairs[0].value;
  const body = await dump('discover', value, { page: 1 });
  console.log('\ndiscoverList ->', (await rm.analyzer.getStringList(rule.discoverList, body)).length);
} else if (step === 'chapter') {
  rm.engine.setEnvironment({ result: arg, page: 1 });
  const body = await dump('chapter', rule.chapterUrl === 'null' ? 'null' : rule.chapterUrl, { result: arg, page: 1 });
  rm.engine.setEnvironment({ lastResult: arg, result: body });
  const roads = rule.chapterRoads ? await rm.analyzer.getElements(rule.chapterRoads, body) : [body];
  console.log('\nroads ->', roads.length);
  const list = await rm.analyzer.getElements(rule.chapterList, roads[0]);
  console.log('chapterList ->', list.length);
  if (list[0]) {
    console.log('first item html:', String(list[0]).slice(0, 200));
    console.log('name ->', await rm.analyzer.getString(rule.chapterName, list[0]));
    console.log('url ->', await rm.analyzer.getUrl(rule.chapterResult, rule.host, list[0]));
  }
} else if (step === 'content') {
  rm.engine.setEnvironment({ result: arg, lastResult: arg, page: 1 });
  const body = await dump('content', rule.contentUrl || arg, { result: arg, page: 1 });
  rm.engine.setEnvironment({ lastResult: arg, result: body });
  console.log('\ncontentItems ->', await rm.analyzer.getStringList(rule.contentItems, body));
} else if (step === 'map') {
  console.log(JSON.stringify(await rm.discoverMap(), null, 1));
}
