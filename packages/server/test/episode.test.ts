import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chineseToNumber, episodeNumber, pickRoad, subtitleGroup, summarizeRoads } from '../src/episode';

test('中文数字', () => {
  assert.equal(chineseToNumber('十二'), 12);
  assert.equal(chineseToNumber('二十'), 20);
  assert.equal(chineseToNumber('一百零五'), 105);
  assert.equal(chineseToNumber('十'), 10);
  assert.equal(chineseToNumber('36'), 36);
});

test('集数识别', () => {
  const cases: [string, number | null][] = [
    ['第12集', 12],
    ['第 3 集', 3],
    ['第十二话', 12],
    ['第二十回', 20],
    ['EP05', 5],
    ['Ep.7', 7],
    ['S02E11', 11],
    ['[喵萌奶茶屋] 葬送的芙莉莲 [24][1080p]', 24],
    ['[LoliHouse] Frieren - 23 [WebRip 1080p HEVC]', 23],
    ['12', 12],
    ['12v2', 12],
    ['更新至36集', 36],
    ['海贼王 1100', 1100],
    ['第20240105期', 20240105],
    ['预告', null],
    ['第1集 花絮', null],
    ['SP1', null],
    ['正片', null],
    ['2024', null],
    ['HD 1080', null]
  ];
  for (const [name, want] of cases) assert.equal(episodeNumber(name), want, name);
});

test('字幕组识别', () => {
  assert.equal(subtitleGroup('[喵萌奶茶屋&LoliHouse] 葬送的芙莉莲 - 24'), 'LoliHouse');
  assert.equal(subtitleGroup('【桜都字幕组】xxx 12'), '桜都字幕组');
  assert.equal(subtitleGroup('[北宇治字幕组] Kimi no Na wa'), '北宇治字幕组');
  assert.equal(subtitleGroup('[某某Sub] 番名 05'), '某某Sub');
  assert.equal(subtitleGroup('[1080P] 番名'), '');
  assert.equal(subtitleGroup('线路1'), '');
  assert.equal(subtitleGroup('ffm3u8'), '');
});

test('按线路汇总并挑选最新的线路', () => {
  const list = [
    { name: '第1集', road: 'lineA' },
    { name: '第2集', road: 'lineA' },
    { name: '第1集', road: '[LoliHouse] 高清' },
    { name: '第2集', road: '[LoliHouse] 高清' },
    { name: '第3集', road: '[LoliHouse] 高清' },
    { name: '预告', road: '[LoliHouse] 高清' }
  ];
  const roads = summarizeRoads(list);
  assert.equal(roads.length, 2);
  const lh = roads.find((r) => r.group === 'LoliHouse')!;
  assert.equal(lh.latest, 3);
  assert.equal(lh.latestName, '第3集');
  assert.equal(pickRoad(roads)?.name, '[LoliHouse] 高清');
  assert.equal(pickRoad(roads, 'lineA')?.name, 'lineA');
  assert.equal(pickRoad(roads, 'LoliHouse')?.latest, 3);
  // 指定的线路不存在时自动挑
  assert.equal(pickRoad(roads, 'gone')?.latest, 3);
});
