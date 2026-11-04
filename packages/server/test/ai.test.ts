import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';

process.env.WE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'we-ai-'));

const { aiRoutes, runChat, maskKey, __setSearchImpl } = await import('../src/ai');
const { rulesStore } = await import('../src/db');

let server: http.Server;
let base = '';
const requests: any[] = [];

/** 假的 OpenAI 兼容接口：第一轮要求调用 search_media，第二轮输出最终回答 */
before(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      requests.push({ auth: req.headers.authorization, body });
      if (!body.stream) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: '成功' } }] }));
        return;
      }
      res.setHeader('content-type', 'text/event-stream');
      const send = (o: any) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      const hasToolResult = body.messages.some((m: any) => m.role === 'tool');
      if (!hasToolResult) {
        send({ choices: [{ delta: { content: '我帮你找找。' } }] });
        send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'search_media', arguments: '{"keyw' } }] } }] });
        send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ord":"三体"}' } }] } }] });
      } else {
        send({ choices: [{ delta: { content: '在「测试源」找到了' } }] });
        send({ choices: [{ delta: { content: '《三体》。' } }] });
      }
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  rulesStore.value.push({ id: 'r1', name: '测试源', contentType: 2, enableSearch: true, searchUrl: '/s' } as any);
  // 搜索走桩：不真的发请求，返回一条命中
  __setSearchImpl(async (kw: string) => [
    { ruleId: 'r1', rule: '测试源', contentType: 2, name: `${kw}(全集)`, url: 'https://example.com/1', chapter: '第1集' } as any
  ]);
});

after(() => server.close());

test('配置：密钥不回传，留空不覆盖', () => {
  const saved = aiRoutes['ai/config/save']({ baseUrl: base + '/', model: 'm1', apiKey: 'sk-1234567890abcd' });
  assert.equal(saved.hasKey, true);
  assert.equal(saved.keyPreview, 'sk-****abcd');
  assert.ok(!JSON.stringify(aiRoutes['ai/config/read']()).includes('1234567890'));
  aiRoutes['ai/config/save']({ model: 'm2', apiKey: '' });
  assert.equal(aiRoutes['ai/config/read']().hasKey, true);
  assert.equal(aiRoutes['ai/config/read']().model, 'm2');
  assert.equal(aiRoutes['ai/config/read']().baseUrl, base);
  assert.throws(() => aiRoutes['ai/config/save']({ baseUrl: 'ftp://x' }));
  assert.equal(maskKey(''), '');
});

test('对话：流式输出 + 工具调用搜索 + 第二轮回答', async () => {
  const events: any[] = [];
  await runChat([{ role: 'user', content: '我想看三体' }], (e) => events.push(e));
  const text = events.filter((e) => e.type === 'delta').map((e) => e.text).join('');
  assert.equal(text, '我帮你找找。在「测试源」找到了《三体》。');
  const tool = events.find((e) => e.type === 'tool');
  assert.equal(tool.keyword, '三体');
  assert.equal(tool.results.length, 1);
  assert.equal(tool.results[0].ruleId, 'r1');
  assert.equal(tool.results[0].name, '三体(全集)');
  // 第二轮请求带上了工具结果，并带了鉴权头
  const second = requests.filter((r) => r.body.stream)[1];
  assert.equal(second.auth, 'Bearer sk-1234567890abcd');
  const toolMsg = second.body.messages.find((m: any) => m.role === 'tool');
  assert.match(toolMsg.content, /测试源/);
  assert.equal(second.body.messages[0].role, 'system');
});

test('测试连接 / 影评（带缓存）', async () => {
  assert.equal((await aiRoutes['ai/test']()).reply, '成功');
  const r1 = await aiRoutes['ai/review']({ name: '三体', description: '科幻' });
  assert.equal(r1.cached, false);
  const r2 = await aiRoutes['ai/review']({ name: '三体', description: '科幻' });
  assert.equal(r2.cached, true);
});
