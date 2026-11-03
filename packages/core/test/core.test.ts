import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { AnalyzerManager, ContentType, RuleManager, cmsToRule, createRule, decodeRule, encodeRule, text2rules } from '../src/index';

let server: http.Server;
let host = '';

const CMS_DETAIL = {
  list: [
    {
      vod_id: 7,
      vod_name: '测试剧',
      vod_pic: 'https://img.example.com/7.jpg',
      vod_remarks: '更新至2集',
      vod_content: '<p>简介<b>内容</b></p>',
      type_name: '电视剧',
      vod_time: '2026-01-01 10:00:00',
      vod_play_from: 'lineA$$$lineB',
      vod_play_url: '第1集$https://v.example.com/a1.m3u8#第2集$https://v.example.com/a2.m3u8$$$第1集$https://v.example.com/b1.m3u8'
    }
  ]
};

before(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url!, 'http://x');
    if (u.pathname === '/api.php/provide/vod') {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(u.searchParams.get('ac') === 'list' ? { class: [{ type_id: 1, type_name: '电影' }] } : CMS_DETAIL));
      return;
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (u.pathname === '/search') {
      res.end(`<ul><li class="b"><a href="/book/1">书一</a><img src="/c1.jpg"><span class="au">张三</span></li>
                   <li class="b"><a href="/book/2">书二</a><img src="//cdn.x/c2.jpg"><span class="au">李四</span></li></ul>`);
    } else if (u.pathname === '/book/1') {
      res.end(`<dl><dd><a href="/c/1">第一章</a></dd><dd><a href="/c/2">第二章</a></dd></dl>`);
    } else if (u.pathname === '/c/1') {
      res.end(`<div id="content">第一段<br/>第二段<br/>&nbsp;第三段</div>`);
    } else res.end('<html></html>');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

test('analyzer: css / json / xpath / js / replace / template', async () => {
  const a = new AnalyzerManager();
  const html = '<div class="a"><a href="/x" title="t1">Hello</a><a href="/y">World</a></div>';
  assert.equal(await a.getString('.a a@text', html), 'Hello  World');
  assert.equal(await a.getString('@css:.a a@href', html), '/x  /y');
  assert.deepEqual(await a.getStringList('.a a@href', html), ['/x', '/y']);
  assert.equal((await a.getElements('.a a', html)).length, 2);
  assert.equal(await a.getString('.a a@text##o', html), 'Hell  Wrld');
  assert.equal(await a.getString('//a/@href', html), '/x  /y');
  assert.equal(await a.getString('//a[1]/text()', html), 'Hello');
  assert.equal(await a.getString('$.a.b', '{"a":{"b":"c"}}'), 'c');
  assert.equal(await a.getString('$.n||$.a.b', '{"a":{"b":"c"}}'), 'c');
  assert.equal(await a.getString('$.x&&$.y', '{"x":"1","y":"2"}'), '1  2');
  assert.equal(await a.getString('@js:result.length', 'abcd'), '4');
  assert.equal(await a.getString('@json:$.a@js:result + "!"', '{"a":"hi"}'), 'hi!');
  assert.equal(await a.getString('id={{$.id}}&n={{$.n}}', '{"id":1,"n":"z"}'), 'id=1&n=z');
  assert.equal(await a.getString('@regex:(\\d+)元', '价格 12元'), '12');
});

test('novel rule: search -> chapter -> content', async () => {
  const rule = createRule({
    name: 'html', host, contentType: ContentType.NOVEL, enableSearch: true,
    searchUrl: '/search?q=$keyword', searchList: 'li.b', searchName: 'a@text', searchCover: 'img@src',
    searchAuthor: '.au@text', searchResult: 'a@href',
    chapterList: 'dd', chapterName: 'a@text', chapterResult: 'a@href',
    contentItems: '#content@html'
  });
  const rm = new RuleManager(rule);
  const list = await rm.search('书');
  assert.equal(list.length, 2);
  assert.equal(list[0].name, '书一');
  assert.equal(list[0].url, `${host}/book/1`);
  assert.equal(list[0].cover, `${host}/c1.jpg`);
  assert.equal(list[1].cover, 'http://cdn.x/c2.jpg');
  const chapters = await rm.getChapter(list[0].url);
  assert.deepEqual(chapters.map((c) => c.name), ['第一章', '第二章']);
  const content = await rm.getContent(chapters[0].url);
  assert.deepEqual(content, ['第一段', '第二段', '第三段']);
});

test('cms video rule: discover / search / roads / play url', async () => {
  const rule = cmsToRule({ class: [{ type_id: 1, type_name: '电影' }] }, `${host}/api.php/provide/vod`, 'cms');
  const rm = new RuleManager(rule);
  const map = await rm.discoverMap();
  assert.deepEqual(map.map((m) => m.name), ['最近更新', '电影']);
  const items = await rm.discover(map[1].pairs[0].value);
  assert.equal(items[0].name, '测试剧');
  assert.equal(items[0].url, '7');
  assert.equal(items[0].description, '简介内容');
  assert.deepEqual(items[0].tags, ['电视剧', '2026-01-01']);
  const search = await rm.search('测试');
  assert.equal(search[0].chapter, '更新至2集');
  const chapters = await rm.getChapter(search[0].url);
  assert.equal(chapters.length, 3);
  assert.deepEqual([...new Set(chapters.map((c) => c.road))], ['lineA', 'lineB']);
  assert.equal(chapters[1].url, 'https://v.example.com/a2.m3u8');
  const content = await rm.getContent(chapters[1].url);
  assert.deepEqual(content, ['https://v.example.com/a2.m3u8']);
});

test('rule codec & import', async () => {
  const rule = createRule({ name: 'n', host: 'http://a.b', author: 'me' });
  const eso = encodeRule(rule);
  assert.ok(eso.startsWith('eso://me:n@'));
  assert.equal(decodeRule(eso).id, rule.id);
  const rules = await text2rules(JSON.stringify([rule, eso, { foo: 1 }]));
  assert.equal(rules.length, 2);
});
