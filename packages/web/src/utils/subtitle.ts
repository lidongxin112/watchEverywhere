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

/** 是否是 ASS / SSA 字幕 */
export function isAssSubtitle(text: string, fileName = ''): boolean {
  return /\.(ass|ssa)$/i.test(fileName) || /^\uFEFF?\s*\[Script Info\]/i.test(text);
}

function parseAssTime(s: string): number {
  const m = /^(\d+):(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(s.trim());
  if (!m) return NaN;
  const [, h, mm, ss, frac = '0'] = m;
  return Number(h) * 3600 + Number(mm) * 60 + Number(ss) + Number(frac.padEnd(3, '0').slice(0, 3)) / 1000;
}

/**
 * ASS / SSA → 纯文本 cue（特效渲染器加载失败时的降级方案）
 * 去掉 {\...} 特效标签，\N 换行，\h 空格
 */
export function parseAss(text: string): Cue[] {
  const cues: Cue[] = [];
  let inEvents = false;
  let format: string[] = [];
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (/^\[.+\]$/.test(line)) {
      inEvents = /^\[Events\]$/i.test(line);
      continue;
    }
    if (!inEvents) continue;
    if (/^Format\s*:/i.test(line)) {
      format = line.replace(/^Format\s*:/i, '').split(',').map((f) => f.trim().toLowerCase());
      continue;
    }
    if (!/^Dialogue\s*:/i.test(line)) continue;
    const cols = format.length ? format : ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    const parts = line.replace(/^Dialogue\s*:/i, '').split(',');
    // 最后一列 Text 里可能有逗号
    const fields = [...parts.slice(0, cols.length - 1), parts.slice(cols.length - 1).join(',')];
    const get = (k: string) => fields[cols.indexOf(k)] ?? '';
    const from = parseAssTime(get('start'));
    const to = parseAssTime(get('end'));
    const content = get('text')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\[Nn]/g, '\n')
      .replace(/\\h/g, ' ')
      .trim();
    if (Number.isFinite(from) && Number.isFinite(to) && content) cues.push({ from, to, text: content });
  }
  // 同一时间的多行（双语、多样式）合并成一条
  cues.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: Cue[] = [];
  for (const c of cues) {
    const last = merged[merged.length - 1];
    if (last && last.from === c.from && last.to === c.to) last.text += '\n' + c.text;
    else merged.push({ ...c });
  }
  return merged;
}
