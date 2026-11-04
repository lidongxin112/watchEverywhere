import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCue, isAssSubtitle, parseAss, parseSubtitle } from '../../web/src/utils/subtitle';

const ASS = `\uFEFF[Script Info]
Title: test
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,20

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Comment: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,注释不显示
Dialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,{\\fad(200,200)\\c&H00FFFF&}你好，世界\\N第二行
Dialogue: 0,0:00:01.50,0:00:03.00,EN,,0,0,0,,Hello, world
Dialogue: 0,0:01:02.05,0:01:04.00,Default,,0,0,0,,{\\pos(10,10)}位置\\h特效
`;

test('ASS: 识别格式', () => {
  assert.equal(isAssSubtitle(ASS), true);
  assert.equal(isAssSubtitle('1\n00:00:01,000 --> 00:00:02,000\nhi', 'a.srt'), false);
  assert.equal(isAssSubtitle('', 'movie.SSA'), true);
});

test('ASS: 去特效标签、换行、合并双语、文本里的逗号', () => {
  const cues = parseAss(ASS);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].from, 1.5);
  assert.equal(cues[0].to, 3);
  assert.equal(cues[0].text, '你好，世界\n第二行\nHello, world');
  assert.equal(cues[1].from, 62.05);
  assert.equal(cues[1].text, '位置 特效');
  assert.equal(findCue(cues, 2), cues[0].text);
});

test('SRT 解析不受影响', () => {
  const cues = parseSubtitle('1\n00:00:01,000 --> 00:00:02,500\n<i>hi</i>\n\n2\n00:00:03,000 --> 00:00:04,000\nthere\n');
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, 'hi');
});
