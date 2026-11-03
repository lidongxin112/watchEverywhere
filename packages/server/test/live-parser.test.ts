import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findProgrammes,
  normName,
  parseM3U,
  parsePlaylist,
  parseTXT,
  parseXmltv,
  parseXmltvTime,
  rewriteM3u8,
  streamKind
} from '../src/live-parser';

test('m3u: header epg / attrs / comma in attr / multi lines / EXTGRP', () => {
  const text = `﻿#EXTM3U x-tvg-url="/playback.xml"
#EXT-X-APP APTV
#EXTINF:-1 tvg-id="CCTV1" tvg-name="CCTV1" tvg-logo="http://l/1.png" group-title="央视,频道",CCTV-1 综合
http://a/cctv1.m3u8
#EXTINF:-1 tvg-id="CCTV1" group-title="央视,频道",CCTV-1 综合
http://b/cctv1.flv
#EXTGRP:地方
#EXTINF:-1,本地台
#EXTVLCOPT:http-user-agent=xx
http://c/local.ts
`;
  const r = parseM3U(text);
  assert.equal(r.epgUrl, '/playback.xml');
  assert.equal(r.channels.length, 2);
  const c = r.channels[0];
  assert.equal(c.name, 'CCTV-1 综合');
  assert.equal(c.group, '央视,频道');
  assert.equal(c.logo, 'http://l/1.png');
  assert.deepEqual(c.urls, ['http://a/cctv1.m3u8', 'http://b/cctv1.flv']);
  assert.equal(r.channels[1].group, '地方');
  assert.equal(r.channels[1].name, '本地台');
});

test('txt: genre groups and # separated lines', () => {
  const r = parseTXT(`央视,#genre#
CCTV1,http://a/1.m3u8#http://b/1.m3u8
CCTV1,http://c/1.m3u8$线路3
卫视,#genre#
湖南卫视,http://d/hn.m3u8
`);
  assert.equal(r.channels.length, 2);
  assert.deepEqual(r.channels[0].urls, ['http://a/1.m3u8', 'http://b/1.m3u8', 'http://c/1.m3u8']);
  assert.equal(r.channels[1].group, '卫视');
  assert.equal(parsePlaylist('#EXTM3U\n#EXTINF:-1,x\nhttp://x').channels.length, 1);
  assert.equal(parsePlaylist('a,#genre#\nb,http://x').channels[0].group, 'a');
});

test('stream kind', () => {
  assert.equal(streamKind('http://x/a.m3u8?t=1'), 'hls');
  assert.equal(streamKind('http://x/live/abc'), 'hls');
  assert.equal(streamKind('https://x/a.flv?sign=1'), 'flv');
  assert.equal(streamKind('http://1.2.3.4:8116/0.ts'), 'ts');
  assert.equal(streamKind('rtmp://x/live'), 'unsupported');
  assert.equal(streamKind('rtp://239.0.0.1:5000'), 'unsupported');
});

test('xmltv parse & match', () => {
  const now = Date.UTC(2026, 10, 2, 2, 30); // 北京时间 10:30
  assert.equal(parseXmltvTime('20261102100000 +0800'), Date.UTC(2026, 10, 2, 2, 0));
  assert.equal(parseXmltvTime('20261102020000 +0000'), Date.UTC(2026, 10, 2, 2, 0));
  const xml = `<?xml version="1.0"?><tv>
  <channel id="CCTV1"><display-name lang="zh">CCTV-1 综合</display-name><display-name>CCTV1</display-name></channel>
  <programme start="20261102100000 +0800" stop="20261102110000 +0800" channel="CCTV1"><title lang="zh">朝闻天下 &amp; 新闻</title><desc>d</desc></programme>
  <programme start="20261102110000 +0800" stop="20261102120000 +0800" channel="CCTV1"><title><![CDATA[今日说法]]></title></programme>
  <programme start="20250101110000 +0800" stop="20250101120000 +0800" channel="CCTV1"><title>过期</title></programme>
  </tv>`;
  const idx = parseXmltv(xml, now);
  assert.equal(idx.channelCount, 1);
  const list = findProgrammes(idx, { tvgId: '', tvgName: '', name: 'CCTV-1综合高清' });
  assert.equal(list.length, 2);
  assert.equal(list[0].title, '朝闻天下 & 新闻');
  assert.equal(list[1].title, '今日说法');
  assert.equal(findProgrammes(idx, { tvgId: 'CCTV1', tvgName: '', name: 'x' }).length, 2);
  assert.equal(normName('CCTV-1 HD'), 'cctv1');
});

test('rewrite m3u8', () => {
  const out = rewriteM3u8(
    `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXTINF:6,
seg1.ts
/abs/seg2.ts
https://cdn.x/seg3.ts`,
    'http://h/live/index.m3u8',
    (u) => `P(${u})`
  );
  assert.match(out, /URI="P\(http:\/\/h\/live\/key\.bin\)"/);
  assert.match(out, /^P\(http:\/\/h\/live\/seg1\.ts\)$/m);
  assert.match(out, /^P\(http:\/\/h\/abs\/seg2\.ts\)$/m);
  assert.match(out, /^P\(https:\/\/cdn\.x\/seg3\.ts\)$/m);
});
