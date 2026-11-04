import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterAds, parseAdPatterns, segmentSignature } from '../../web/src/utils/adfilter';

const BASE = 'https://cdn.example.com/20240101/abc123/1000kb/hls/index.m3u8';

function seg(name: string, d = 4) {
  return `#EXTINF:${d},\n${name}`;
}

function main(from: number, to: number) {
  const out: string[] = [];
  for (let i = from; i < to; i++) out.push(seg(`xyz${String(i).padStart(4, '0')}.ts`));
  return out.join('\n');
}

test('插播广告段（不同目录 + DISCONTINUITY）会被删掉', () => {
  const m3u8 = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:5
#EXT-X-MEDIA-SEQUENCE:0
${main(0, 100)}
#EXT-X-DISCONTINUITY
${seg('https://cdn.example.com/20231201/ggg/index0.ts', 3.3)}
${seg('https://cdn.example.com/20231201/ggg/index1.ts', 3.3)}
${seg('https://cdn.example.com/20231201/ggg/index2.ts', 3.4)}
#EXT-X-DISCONTINUITY
${main(100, 200)}
#EXT-X-ENDLIST`;
  const r = filterAds(m3u8, BASE);
  assert.equal(r.removed, 3);
  assert.equal(r.removedDuration, 10);
  assert.ok(!r.text.includes('ggg'));
  assert.ok(r.text.includes('xyz0199.ts'));
  assert.ok(r.text.includes('#EXT-X-TARGETDURATION:5'));
  assert.ok(r.text.trimEnd().endsWith('#EXT-X-ENDLIST'));
  // 两段正片之间保留一个 DISCONTINUITY
  assert.equal((r.text.match(/#EXT-X-DISCONTINUITY/g) || []).length, 1);
});

test('片头广告（第一块）也能识别', () => {
  const m3u8 = `#EXTM3U
#EXT-X-TARGETDURATION:5
${seg('/ad/a0.ts', 5)}
${seg('/ad/a1.ts', 5)}
#EXT-X-DISCONTINUITY
${main(0, 50)}
#EXT-X-ENDLIST`;
  const r = filterAds(m3u8, BASE);
  assert.equal(r.removed, 2);
  assert.ok(r.text.includes('xyz0000.ts'));
  assert.ok(!r.text.includes('#EXT-X-DISCONTINUITY'));
});

test('关键字 adjump 在单块清单里也会剔除', () => {
  const m3u8 = `#EXTM3U\n${main(0, 10)}\n${seg('https://x.com/adjump/1.ts', 2)}\n#EXT-X-ENDLIST`;
  const r = filterAds(m3u8, BASE);
  assert.equal(r.removed, 1);
});

test('正常的多段正片（同一目录）不受影响', () => {
  const m3u8 = `#EXTM3U\n${main(0, 30)}\n#EXT-X-DISCONTINUITY\n${main(30, 60)}\n#EXT-X-ENDLIST`;
  const r = filterAds(m3u8, BASE);
  assert.equal(r.removed, 0);
  assert.equal(r.text, m3u8);
});

test('时长较长的不同段不当成广告（避免误删正片）', () => {
  const other: string[] = [];
  for (let i = 0; i < 60; i++) other.push(seg(`https://cdn2.example.com/p2/seg${i}.ts`, 6));
  const m3u8 = `#EXTM3U\n${main(0, 100)}\n#EXT-X-DISCONTINUITY\n${other.join('\n')}\n#EXT-X-ENDLIST`;
  assert.equal(filterAds(m3u8, BASE).removed, 0);
});

test('主清单、空内容原样返回', () => {
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nindex.m3u8\n';
  assert.equal(filterAds(master, BASE).text, master);
  assert.equal(filterAds('', BASE).removed, 0);
});

test('转发地址按真实地址计算特征；自定义规则生效', () => {
  const proxied = `/api/media/proxy?u=${encodeURIComponent('https://v.cdn.com/a/b/seg001.ts')}&s=x`;
  assert.equal(segmentSignature(proxied, 'http://localhost:5173/x.m3u8'), 'v.cdn.com/a/b/seg0.ts');
  const m3u8 = `#EXTM3U\n${main(0, 10)}\n${seg('https://x.com/p/promo_1.ts', 2)}\n#EXT-X-ENDLIST`;
  assert.equal(filterAds(m3u8, BASE, { extraPatterns: parseAdPatterns('promo_\n[无效(\n# 注释') }).removed, 1);
});

test('密钥标签跟着分片走，不会丢', () => {
  const m3u8 = `#EXTM3U
#EXT-X-TARGETDURATION:5
#EXT-X-KEY:METHOD=AES-128,URI="key.key"
${main(0, 40)}
#EXT-X-DISCONTINUITY
${seg('/adv/x0.ts', 4)}
#EXT-X-DISCONTINUITY
${main(40, 80)}
#EXT-X-ENDLIST`;
  const r = filterAds(m3u8, BASE);
  assert.equal(r.removed, 1);
  assert.ok(r.text.includes('#EXT-X-KEY:METHOD=AES-128,URI="key.key"'));
});
