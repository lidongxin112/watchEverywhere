import { createRule, fetch, parseRequest } from '@watch-everywhere/core';

/**
 * 字幕
 *
 * B 站 CC 字幕需要登录态（SESSDATA）；没有 Cookie 时接口会返回空列表，
 * 这里只做“有就取回来”，本地 .srt/.vtt 由前端解析。
 */

export interface SubtitleMeta {
  lan: string;
  lan_doc: string;
  url: string;
}

export interface Cue {
  from: number;
  to: number;
  text: string;
}

function api(cookie: string) {
  return createRule({ host: 'https://api.bilibili.com', cookies: cookie || '' });
}

async function getJson(url: string, cookie = ''): Promise<any> {
  const res = await fetch(
    parseRequest(
      JSON.stringify({
        url,
        headers: {
          Referer: 'https://www.bilibili.com/',
          Origin: 'https://www.bilibili.com',
          ...(cookie ? { Cookie: cookie } : {})
        }
      }),
      api(cookie)
    )
  );
  return JSON.parse(String(res.body || '{}'));
}

/** 拿某个 cid 的字幕列表（aid 可由 bvid 换出来） */
export async function listBiliSubtitles(input: { cid?: string; bvid?: string; epId?: string; cookie?: string }) {
  const cid = String(input.cid || '').replace(/\D/g, '');
  if (!cid) return { code: -1, subtitles: [] as SubtitleMeta[], msg: '缺少 cid' };

  let aid = '';
  if (input.bvid) {
    try {
      const view = await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(input.bvid)}`, input.cookie);
      aid = String(view?.data?.aid || '');
    } catch {
      /* 换不到 aid 就只试 ep */
    }
  }

  const urls = [
    aid ? `https://api.bilibili.com/x/player/v2?aid=${aid}&cid=${cid}` : '',
    input.epId ? `https://api.bilibili.com/x/player/v2?ep_id=${encodeURIComponent(String(input.epId))}&cid=${cid}` : ''
  ].filter(Boolean);

  for (const url of urls) {
    try {
      const json = await getJson(url, input.cookie);
      const subtitles: SubtitleMeta[] = (json?.data?.subtitle?.subtitles || []).map((s: any) => ({
        lan: String(s.lan || ''),
        lan_doc: String(s.lan_doc || ''),
        url: String(s.subtitle_url || '').replace(/^http:/, 'https:')
      }));
      if (subtitles.length) return { code: 0, subtitles };
    } catch {
      /* 换下一个地址 */
    }
  }
  return { code: 0, subtitles: [] as SubtitleMeta[], msg: '没有可用字幕（CC 字幕需要登录态 SESSDATA）' };
}

/** 拉取并解析 B 站字幕 JSON */
export async function fetchBiliSubtitle(url: string): Promise<Cue[]> {
  if (!/^https:\/\//i.test(url)) throw new Error('字幕地址不合法');
  const json = await getJson(url);
  const body = json?.body;
  if (!Array.isArray(body)) return [];
  return body
    .map((row: any) => ({
      from: Number(row.from) || 0,
      to: Number(row.to) || 0,
      text: String(row.content || '').trim()
    }))
    .filter((c: Cue) => c.text);
}
