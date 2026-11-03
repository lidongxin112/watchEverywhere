import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { compareVersion, detectPlatform, checkUpdate, isStandalone } from '../src/update';
import { mediaProxyUrl, mediaReferer, needsMediaProxy } from '../src/media';
import { extractImages, needsBrowser } from '../src/extract-images';
import { parseDanmakuXml } from '../src/danmaku';

// ======================= 版本比较 =======================

test('compareVersion: 常规比较', () => {
  assert.equal(compareVersion('0.2.0', '0.1.9'), 1);
  assert.equal(compareVersion('0.2.0', '0.2.0'), 0);
  assert.equal(compareVersion('0.1.0', '0.2.0'), -1);
  assert.equal(compareVersion('v1.10.0', '1.9.9'), 1);
  assert.equal(compareVersion('1.0.0-beta', '1.0.0'), 0);
  assert.equal(compareVersion('1.0', '1.0.1'), -1);
});

test('detectPlatform: 返回合法平台', () => {
  assert.match(detectPlatform(), /^(mac-arm64|mac-x64|win-x64|linux-x64)$/);
});

test('isStandalone: 开发态为 false', () => {
  assert.equal(isStandalone(), false);
});

test('checkUpdate: 能识别新版本与下载地址', async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        version: '9.9.9',
        notes: '测试版本',
        platforms: { 'mac-arm64': { url: 'https://example.com/app', size: 1 } }
      })
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  process.env.WE_UPDATE_URL = `http://127.0.0.1:${port}/latest.json`;
  try {
    const info = await checkUpdate(true);
    assert.equal(info.latest, '9.9.9');
    assert.equal(info.hasUpdate, true);
    assert.equal(info.notes, '测试版本');
  } finally {
    delete process.env.WE_UPDATE_URL;
    server.close();
  }
});

// ======================= 媒体转发 =======================

test('needsMediaProxy: 同站直连、跨站转发', () => {
  assert.equal(needsMediaProxy('https://www.bilibili.com/x.mp4', 'https://www.bilibili.com'), false);
  assert.equal(needsMediaProxy('https://upos-sz.bilivideo.com/x.mp4', 'https://www.bilibili.com'), true);
  assert.equal(needsMediaProxy('https://example.com/page.html', 'https://example.com'), false);
});

test('mediaReferer: 按 CDN 补 Referer', () => {
  assert.equal(mediaReferer('https://cn-bj.bilivideo.com/x.mp4'), 'https://www.bilibili.com/');
  assert.equal(mediaReferer('https://omex.tc.qq.com/x.mp4'), 'https://v.qq.com/');
  assert.equal(mediaReferer('https://vod.foo.com/a.m3u8', 'https://bar.com'), 'https://bar.com/');
});

test('mediaProxyUrl: 带签名与编码后的地址', () => {
  const url = mediaProxyUrl('https://cdn.example.com/a b.m3u8?x=1', 'https://ref.example.com/');
  assert.match(url, /^\/api\/media\/proxy\?u=/);
  assert.match(url, /&r=https%3A%2F%2Fref\.example\.com%2F/);
  assert.match(url, /&s=[0-9a-f]{24}$/);
  // 同一个 url+referer 签名稳定，不同 referer 签名不同
  const a = mediaProxyUrl('https://cdn.example.com/a.m3u8', 'https://a.com/');
  const b = mediaProxyUrl('https://cdn.example.com/a.m3u8', 'https://b.com/');
  assert.notEqual(a.split('&s=')[1], b.split('&s=')[1]);
});

// ======================= 图片抽取 =======================

test('extractImages: amp-img / srcset / 相对地址 / 过滤杂图', () => {
  const html = `
    <amp-img src="https://a.com/1.jpg"></amp-img>
    <amp-img srcset="https://a.com/2.webp 1x, https://a.com/3.webp 2x"></amp-img>
    <img src="/pics/4.jpg">
    <img src="https://a.com/logo.png">
    <img src="https://a.com/icon.svg">
    <img src="data:image/png;base64,xxx">
    <img src="https://a.com/banner.jpg">
  `;
  const list = extractImages(html, 'https://a.com/chapter/1');
  assert.equal(list.length, 4);
  assert.deepEqual(list, [
    'https://a.com/1.jpg',
    'https://a.com/2.webp',
    'https://a.com/3.webp',
    'https://a.com/pics/4.jpg'
  ]);
});

test('extractImages: 空页面返回空数组', () => {
  assert.deepEqual(extractImages('', 'https://a.com'), []);
});

test('needsBrowser: 只对需要跑 JS 的站点生效', () => {
  assert.equal(needsBrowser('https://cn.bzmgcn.com/comic/chapter/x/0_0.html'), true);
  assert.equal(needsBrowser('https://www.bilibili.com/bangumi/play/ep1'), false);
});

// ======================= 弹幕解析 =======================

test('parseDanmakuXml: 解析时间/模式/颜色并按时间排序', () => {
  const xml = `<?xml version="1.0"?><i>
    <d p="12.5,1,25,16777215,1693483458,0,abc,1,10">第二条</d>
    <d p="3,5,25,255,1693483458,0,abc,2,10">顶部 &amp; 高亮</d>
    <d p="bad,1,25,16777215,0,0,abc,3,10">忽略</d>
  </i>`;
  const list = parseDanmakuXml(xml);
  assert.equal(list.length, 2);
  assert.equal(list[0].t, 3);
  assert.equal(list[0].m, 5);
  assert.equal(list[0].c, 255);
  assert.equal(list[0].text, '顶部 & 高亮');
  assert.equal(list[1].t, 12.5);
});
