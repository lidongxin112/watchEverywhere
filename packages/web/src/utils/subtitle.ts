/** 字幕解析：SRT / WebVTT / B 站 JSON 统一成 cue 列表 */

export interface Cue {
  from: number;
  to: number;
  text: string;
}

function parseTime(s: string): number {
  const t = s.trim().replace(',', '.');
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/.exec(t);
  if (!m) return NaN;
  const [, h, mm, ss, ms] = m;
  return (Number(h || 0) * 3600 + Number(mm) * 60 + Number(ss)) * 1000 + Number((ms || '0').padEnd(3, '0'));
}

/** 同时兼容 SRT 与 WebVTT（VTT 只多了个 WEBVTT 头和 . 毫秒分隔） */
export function parseSubtitle(text: string): Cue[] {
  const body = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const blocks = body.split(/\n{2,}/);
  const cues: Cue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) continue;
    if (/^WEBVTT/i.test(lines[0])) continue;
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx === -1) continue;
    const [startRaw, endRaw] = lines[timeIdx].split('-->');
    const from = parseTime(startRaw);
    const to = parseTime((endRaw || '').trim().split(/\s+/)[0]);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const content = lines
      .slice(timeIdx + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (content) cues.push({ from: from / 1000, to: to / 1000, text: content });
  }
  return cues.sort((a, b) => a.from - b.from);
}

/** B 站字幕 JSON → cue */
export function cuesFromBili(body: { from: number; to: number; content: string }[]): Cue[] {
  return body
    .map((r) => ({ from: Number(r.from) || 0, to: Number(r.to) || 0, text: String(r.content || '').trim() }))
    .filter((c) => c.text)
    .sort((a, b) => a.from - b.from);
}

/** 取当前时间对应的一条字幕（二分查找） */
export function findCue(cues: Cue[], time: number): string {
  let lo = 0;
  let hi = cues.length - 1;
  let hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].from <= time) {
      hit = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (hit === -1) return '';
  const cue = cues[hit];
  return time >= cue.from && time <= cue.to + 0.3 ? cue.text : '';
}
