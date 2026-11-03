import { createRule, fetch, parseRequest } from '@watch-everywhere/core';
import { MemoryCache } from './store';

/**
 * 哔哩哔哩弹幕
 *
 * 接口：GET https://api.bilibili.com/x/v1/dm/list.so?oid=<cid>
 * 返回 XML：<d p="时间,模式,字号,颜色,发送时间戳,池,用户,行号,权重">内容</d>
 * 模式：1/2/3 滚动，4 底部固定，5 顶部固定
 */

export interface DanmakuItem {
  /** 出现时间（秒） */
  t: number;
  /** 1-3 滚动，4 底部，5 顶部 */
  m: number;
  /** 颜色（十进制 RGB） */
  c: number;
  /** 内容 */
  text: string;
}

const cache = new MemoryCache();
const TTL = 6 * 60 * 60 * 1000;
const LIMIT = 3000;

const rule = createRule({ host: 'https://api.bilibili.com', cookies: '' });

export async function fetchDanmaku(cid: string | number): Promise<DanmakuItem[]> {
  const id = String(cid || '').replace(/\D/g, '');
  if (!id) return [];
  const hit = cache.get<DanmakuItem[]>(`dm@${id}`);
  if (hit) return hit;

  const res = await fetch(
    parseRequest(
      JSON.stringify({
        url: `https://api.bilibili.com/x/v1/dm/list.so?oid=${id}`,
        headers: { Referer: 'https://www.bilibili.com/', 'Accept-Encoding': 'gzip, deflate' }
      }),
      rule
    )
  );

  const list = parseDanmakuXml(String(res.body || ''));
  cache.set(`dm@${id}`, list, TTL);
  return list;
}

/** 解析 B 站弹幕 XML（单独抽出来便于测试） */
export function parseDanmakuXml(xml: string): DanmakuItem[] {
  const list: DanmakuItem[] = [];
  const re = /<d\s+p="([^"]*)"[^>]*>([\s\S]*?)<\/d>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const parts = m[1].split(',');
    const t = Number(parts[0]);
    if (!Number.isFinite(t)) continue;
    const text = m[2]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .trim();
    if (!text) continue;
    list.push({
      t,
      m: Number(parts[1]) || 1,
      c: Number(parts[3]) || 0xffffff,
      text
    });
    if (list.length >= LIMIT) break;
  }
  list.sort((a, b) => a.t - b.t);
  return list;
}
