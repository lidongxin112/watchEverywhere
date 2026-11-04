/** 从章节名里取集数（前端用的精简版，和 server/src/episode.ts 规则保持一致） */
export function episodeNo(name: string): number | null {
  const s = String(name || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/预告|花絮|特辑|特别篇|彩蛋|片花|幕后|番外|总集篇|先导/i.test(s)) return null;
  let m: RegExpExecArray | null;
  if ((m = /S\d{1,2}\s*E(\d{1,4})/i.exec(s))) return Number(m[1]);
  if ((m = /第\s*(\d{1,4})\s*[集话話回章节期]/.exec(s))) return Number(m[1]);
  if ((m = /(?:^|[^a-z])EP?\.?\s*(\d{1,4})(?!\d)/i.exec(s))) return Number(m[1]);
  if ((m = /\[(\d{1,4})(?:v\d)?\]/.exec(s))) return Number(m[1]);
  if ((m = /^(\d{1,4})(?:v\d)?$/.exec(s))) return Number(m[1]);
  return null;
}

/** 标题归一化：用于判断两个源是不是同一部作品 */
export function normalizeTitle(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[（(【[][^)）】]]*[)）】]]/g, '')
    .replace(/(第[一二三四五六七八九十\d]+季|season\s*\d+|全\s*\d+\s*集|更新至\s*\d+\s*集?|完结|国语|粤语|中字|双语|4k|1080p|720p|hd|bd)/gi, '')
    .replace(/[\s\-_:：·,，.。!！?？"'“”‘’]/g, '');
}
