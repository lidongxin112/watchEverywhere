import { createRule, fetch, parseRequest } from '@watch-everywhere/core';
import { MemoryCache } from './store';

/**
 * 豆瓣短评（参考 MoonTVPlus 的评论抓取）
 *
 * 两步：先用 suggest 接口按片名找 subject，再取该 subject 的热门短评。
 * 都走公开页面，不需要登录；做 6 小时缓存，避免频繁请求。
 */

export interface DoubanComment {
  author: string;
  rating: number;
  text: string;
  votes: number;
  time: string;
}

export interface DoubanResult {
  ok: boolean;
  subjectId?: string;
  title?: string;
  year?: string;
  rating?: number;
  comments: DoubanComment[];
  message?: string;
}

const cache = new MemoryCache();
const TTL = 6 * 3600_000;

const rule = createRule({
  host: 'https://movie.douban.com',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
});

async function getJson(url: string, referer: string): Promise<any> {
  const res = await fetch(
    parseRequest(
      JSON.stringify({ url, headers: { Referer: referer, 'Accept-Language': 'zh-CN,zh;q=0.9' } }),
      rule
    )
  );
  return JSON.parse(String(res.body || '{}'));
}

/** 资源站标题通常带季/年份/清晰度后缀，生成几个候选去豆瓣试 */
function titleCandidates(name: string): string[] {
  const raw = String(name || '').trim();
  const out = new Set<string>([raw]);
  const strip = (s: string) =>
    s
      .replace(/[（(【[][^)）】]]*[)）】]]/g, '')
      .replace(/\b(4K|1080P|720P|HD|BD|WEB-?DL|BluRay|HDR|杜比视界)\b/gi, '')
      .replace(/(第[一二三四五六七八九十\d]+季|Season\s*\d+|S\d{1,2})/gi, '')
      .replace(/(全\s*\d+\s*集|更新至\s*\d+\s*集?|完结|国语|粤语|中字|双语|真人版|动画版|剧场版)/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  const s1 = strip(raw);
  if (s1) out.add(s1);
  const s2 = s1.replace(/[·:：\-—].*$/, '').trim();
  if (s2) out.add(s2);
  return [...out].filter(Boolean).slice(0, 3);
}

export async function doubanComments(name: string, year?: string): Promise<DoubanResult> {
  const kw = String(name || '').trim();
  if (!kw) return { ok: false, comments: [], message: '缺少片名' };
  const key = `db@${kw}@${year || ''}`;
  const hit = cache.get<DoubanResult>(key);
  if (hit) return hit;

  const empty: DoubanResult = { ok: false, comments: [], message: '豆瓣没有找到这部作品' };
  try {
    let subject: any = null;
    for (const candidate of titleCandidates(kw)) {
      const suggest = await getJson(
        `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(candidate)}`,
        'https://movie.douban.com/'
      );
      const list: any[] = Array.isArray(suggest) ? suggest : [];
      subject =
        list.find((x) => x.type === 'movie' && year && String(x.year || '').includes(String(year))) ||
        list.find((x) => x.type === 'movie');
      if (subject?.id) break;
    }
    if (!subject?.id) {
      cache.set(key, empty, 3600_000);
      return empty;
    }

    const detail = await getJson(
      `https://m.douban.com/rexxar/api/v2/movie/${subject.id}/interests?count=20&start=0&order_by=hot`,
      `https://m.douban.com/movie/subject/${subject.id}/`
    );
    const comments: DoubanComment[] = (detail?.interests || []).map((c: any) => ({
      author: String(c?.user?.name || '匿名'),
      rating: Number(c?.rating?.value || 0),
      text: String(c?.comment || '').replace(/\s+/g, ' ').trim(),
      votes: Number(c?.vote_count || 0),
      time: String(c?.create_time || '').slice(0, 10)
    })).filter((c: DoubanComment) => c.text);

    const result: DoubanResult = {
      ok: true,
      subjectId: String(subject.id),
      title: String(subject.title || kw),
      year: String(subject.year || ''),
      comments
    };
    if (!comments.length) {
      result.message = '这部作品还没有短评';
    }
    cache.set(key, result, TTL);
    return result;
  } catch (e: any) {
    const failed: DoubanResult = { ok: false, comments: [], message: `豆瓣请求失败：${String(e?.message || e).slice(0, 120)}` };
    cache.set(key, failed, 10 * 60_000);
    return failed;
  }
}
