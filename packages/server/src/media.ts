import type { Readable } from 'node:stream';
import axios from 'axios';
import type Router from '@koa/router';
import { rewriteM3u8 } from './live-parser';
import { sign } from './secret';
import { pushLog } from './logs';

/** 日志里只留 CDN 域名 + 路径，避免把整条签名地址刷进缓冲 */
function finalUrlForLog(u: string) {
  try {
    const x = new URL(u);
    return `${x.host}${x.pathname}`;
  } catch {
    return u.slice(0, 80);
  }
}

/**
 * 通用媒体转发
 *
 * 规则解析出来的播放地址大多在第三方 CDN（B 站 upos、腾讯 tc.qq、各种 m3u8），
 * 直接丢给 <video> 会因为防盗链（缺 Referer）、跨域、混合内容而播不了。
 * 这里把它们统一转成 `/api/media/proxy` 的同源地址：服务端补上 Referer/UA，
 * m3u8 里的分片也会一起改写，前端只用拿到一个普通地址。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** 需要伪造 Referer 的 CDN：域名关键字 -> Referer */
const REFERER_RULES: [RegExp, string][] = [
  [/(^|\.)bilivideo\.(com|cn)$|(^|\.)hdslb\.com$|(^|\.)biliimg\.com$/i, 'https://www.bilibili.com/'],
  [/(^|\.)tc\.qq\.com$|(^|\.)qqvideo\.|(^|\.)video\.qq\.com$|(^|\.)qpic\.cn$/i, 'https://v.qq.com/'],
  [/(^|\.)iqiyipic\.com$|(^|\.)iqiyi\.com$/i, 'https://www.iqiyi.com/'],
  [/(^|\.)acimg\.cn$/i, 'https://ac.qq.com/'],
  [/(^|\.)bzmgcn\.com$|(^|\.)bzmdm\.com$/i, 'https://cn.bzmgcn.com/'],
  [/(^|\.)agedm\.io$|(^|\.)aqdstatic\.com$/i, 'https://www.agedm.io/'],
  [/(^|\.)yinghuabb\.com$/i, 'https://www.yinghuabb.com/']
];

const MEDIA_RE = /\.(m3u8|m3u|mp4|m4v|flv|webm|mkv|mov|ts|mp3|m4a|aac|ogg|wav)(\?|#|$)/i;

export function mediaReferer(mediaUrl: string, ruleHost = ''): string {
  try {
    const host = new URL(mediaUrl).hostname;
    for (const [re, ref] of REFERER_RULES) if (re.test(host)) return ref;
  } catch {
    /* ignore */
  }
  return ruleHost ? ruleHost.replace(/\/$/, '') + '/' : '';
}

/** 跨站的媒体地址才需要转发（同站直连更快） */
export function needsMediaProxy(mediaUrl: string, ruleHost = ''): boolean {
  if (!/^https?:\/\//i.test(mediaUrl)) return false;
  if (!MEDIA_RE.test(mediaUrl) && !/m3u8/i.test(mediaUrl)) return false;
  try {
    const media = new URL(mediaUrl);
    const host = ruleHost ? new URL(ruleHost).hostname : '';
    if (host && (media.hostname === host || media.hostname.endsWith('.' + host))) return false;
  } catch {
    /* ignore */
  }
  return true;
}

/** 签名基于持久化密钥，进程重启后旧链接依然可用 */
const signPair = (u: string, r: string) => sign(u + '|' + r);

/** 生成同源转发地址；返回相对路径，前端直接用即可 */
export function mediaProxyUrl(mediaUrl: string, referer = ''): string {
  const r = referer || mediaReferer(mediaUrl);
  return `/api/media/proxy?u=${encodeURIComponent(mediaUrl)}&r=${encodeURIComponent(r)}&s=${signPair(mediaUrl, r)}`;
}

function readAll(stream: Readable, limit = 8 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        stream.destroy();
        reject(new Error('清单过大'));
      } else chunks.push(c);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

export function registerMediaProxy(router: Router) {
  router.get('/media/proxy', async (ctx) => {
    const u = String(ctx.query.u || '');
    const r = String(ctx.query.r || '');
    const s = String(ctx.query.s || '');
    if (!/^https?:\/\//i.test(u) || s !== signPair(u, r)) {
      ctx.status = 403;
      ctx.body = 'forbidden';
      return;
    }

    const headers: Record<string, string> = { 'User-Agent': UA };
    if (r) {
      headers.Referer = r;
      headers.Origin = r.replace(/\/$/, '');
    }
    if (ctx.get('range')) headers.Range = ctx.get('range');

    let res;
    try {
      res = await axios.get(u, {
        responseType: 'stream',
        timeout: 30000,
        maxRedirects: 5,
        validateStatus: () => true,
        headers
      });
    } catch (err: any) {
      pushLog('error', 'media/proxy', `代理请求失败：${err?.message || err}`, { url: finalUrlForLog(u), referer: r });
      ctx.status = 502;
      ctx.body = `upstream error: ${err?.message}`;
      return;
    }

    // 上游 4xx（签名过期 / 防盗链）时把状态带出去，客户端据此自动重新解析
    if (res.status >= 400) {
      ctx.set('x-upstream-status', String(res.status));
      pushLog('warn', 'media/proxy', `upstream ${res.status} ${finalUrlForLog(u)}`);
    }

    const upstream = res.data as Readable;
    upstream.on('error', () => {});
    ctx.res.on('close', () => upstream.destroy());
    ctx.res.on('error', () => upstream.destroy());

    const finalUrl: string = (res.request as any)?.res?.responseUrl || u;
    const ct = String(res.headers['content-type'] || '');
    let path = '';
    try {
      path = new URL(finalUrl).pathname.toLowerCase();
    } catch {
      /* ignore */
    }
    const isPlaylist = /mpegurl/i.test(ct) || path.endsWith('.m3u8') || path.endsWith('.m3u');

    ctx.status = res.status;
    if (isPlaylist && res.status < 400) {
      const text = await readAll(upstream).catch(() => '');
      if (text.trimStart().startsWith('#EXTM3U')) {
        ctx.set('Content-Type', 'application/vnd.apple.mpegurl');
        ctx.set('Cache-Control', 'no-cache');
        ctx.body = rewriteM3u8(text, finalUrl, (nested) => mediaProxyUrl(nested, r));
      } else {
        ctx.set('Content-Type', ct || 'text/plain');
        ctx.body = text;
      }
      return;
    }

    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = res.headers[h];
      if (v) ctx.set(h, String(v));
    }
    ctx.set('Cache-Control', 'no-cache');
    ctx.body = upstream;
  });
}
