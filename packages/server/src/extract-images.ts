/** 从网页 HTML 里挑出漫画图片地址（AMP 页 / 普通页都吃） */

const JUNK = /logo|icon|avatar|qr(code)?|banner|advert|default_cover|placeholder|loading|spinner|1x1|sprite/i;
const IMG_EXT = /\.(jpe?g|png|webp|gif|avif|bmp)(\?|#|$)/i;

export function extractImages(html: string, baseUrl: string): string[] {
  if (!html) return [];
  let origin = '';
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    origin = '';
  }
  const out: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string) => {
    let u = String(raw || '').trim().replace(/&amp;/g, '&');
    if (!u || u.startsWith('data:')) return;
    if (u.startsWith('//')) u = 'https:' + u;
    else if (u.startsWith('/')) u = origin + u;
    if (!/^https?:\/\//i.test(u)) return;
    if (!IMG_EXT.test(u)) return;
    if (JUNK.test(u)) return;
    // 站点按钮/头图常带很小的尺寸参数
    if (/[?&](?:w|width)=(?:[1-9]?\d)&/.test(u)) return;
    if (seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };

  for (const m of html.matchAll(/<amp-img\b[^>]*>/gi)) {
    const tag = m[0];
    for (const attr of ['src', 'data-src', 'data-original']) {
      const v = new RegExp(`\\b${attr}="([^"]+)"`, 'i').exec(tag);
      if (v) add(v[1]);
    }
    const set = /\bsrcset="([^"]+)"/i.exec(tag);
    if (set) set[1].split(',').forEach((p) => add(p.trim().split(' ')[0]));
  }

  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    for (const attr of ['src', 'data-src', 'data-original', 'data-lazy-src']) {
      const v = new RegExp(`\\b${attr}="([^"]+)"`, 'i').exec(tag);
      if (v) add(v[1]);
    }
    const set = /\b(?:srcset|data-srcset)="([^"]+)"/i.exec(tag);
    if (set) set[1].split(',').forEach((p) => add(p.trim().split(' ')[0]));
  }

  return out;
}

/** 这些站点的阅读页必须跑 JS 才能过校验，纯 HTTP 抓不到 */
export const BROWSER_HOSTS = [/bzmgcn\.com$/i, /cnbzmg\.com$/i, /baozimh\./i];

export function needsBrowser(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return BROWSER_HOSTS.some((re) => re.test(host));
  } catch {
    return false;
  }
}
