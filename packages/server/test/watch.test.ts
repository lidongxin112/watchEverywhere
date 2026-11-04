import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// 数据目录指到临时目录，避免碰到真实数据
process.env.WE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'we-watch-'));

const { applySnapshot, markSeen, snapshot } = await import('../src/watch');
const { buildPayload } = await import('../src/notify');

const eps = (n: number, road = '') => Array.from({ length: n }, (_, i) => ({ name: `第${i + 1}集`, road }));

function item(): any {
  return { id: '1', ruleId: 'r', url: 'u', name: '测试番', lastCount: 0, newCount: 0, createTime: 0 };
}

test('首次检查只建立基线，不算新集', () => {
  const w = item();
  const fresh = applySnapshot(w, snapshot(eps(5)), 1);
  assert.deepEqual(fresh, []);
  assert.equal(w.newCount, 0);
  assert.equal(w.lastEpisode, 5);
});

test('按集数判断更新；角标一直保留到标记已读', () => {
  const w = item();
  applySnapshot(w, snapshot(eps(5)), 1);
  const fresh = applySnapshot(w, snapshot(eps(7)), 2);
  assert.deepEqual(fresh, ['第6集', '第7集']);
  assert.equal(w.newCount, 2);
  // 下一轮没有新集：角标不能消失（旧实现的问题）
  assert.deepEqual(applySnapshot(w, snapshot(eps(7)), 3), []);
  assert.equal(w.newCount, 2);
  assert.deepEqual(w.newEpisodes, ['第6集', '第7集']);
  markSeen(w);
  assert.equal(w.newCount, 0);
  applySnapshot(w, snapshot(eps(8)), 4);
  assert.equal(w.newCount, 1);
});

test('多线路：自动追最新的线路，识别字幕组；不会把各线路的集数加在一起', () => {
  const w = item();
  const list = [...eps(10, 'lineA'), ...eps(12, '[LoliHouse] 1080P')];
  applySnapshot(w, snapshot(list), 1);
  assert.equal(w.lastEpisode, 12);
  assert.equal(w.lastCount, 12);
  assert.equal(w.trackingGroup, 'LoliHouse');
  assert.equal(w.roads.length, 2);
  // 指定只追 lineA
  const s2 = snapshot([...eps(11, 'lineA'), ...eps(13, '[LoliHouse] 1080P')], 'lineA');
  assert.equal(s2.road?.name, 'lineA');
  assert.equal(s2.episode, 11);
});

test('识别不出集数时按条目数', () => {
  const w = item();
  const names = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `正片${'ABCDEFGHIJ'[i]}` }));
  applySnapshot(w, snapshot(names(3)), 1);
  assert.equal(w.lastEpisode, undefined);
  const fresh = applySnapshot(w, snapshot(names(4)), 2);
  assert.deepEqual(fresh, ['正片D']);
  assert.equal(w.newCount, 1);
});

test('老数据迁移：不会把所有集都当成新集推送', () => {
  const w: any = { id: '1', ruleId: 'r', url: 'u', name: 'old', lastCount: 20, newCount: 2, lastCheck: 1, createTime: 0 };
  const fresh = applySnapshot(w, snapshot(eps(21)), 2);
  assert.deepEqual(fresh, ['第21集']);
  assert.equal(w.lastEpisode, 21);
});

test('推送内容格式', () => {
  const msg = { title: 't', body: 'b' };
  assert.deepEqual(buildPayload('wecom', msg), { msgtype: 'text', text: { content: '【watchEverywhere】t\nb' } });
  assert.deepEqual(buildPayload('feishu', msg), { msg_type: 'text', content: { text: '【watchEverywhere】t\nb' } });
  assert.equal((buildPayload('bark', msg) as any).group, 'watchEverywhere');
});
