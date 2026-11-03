import tls from 'node:tls';
import https from 'node:https';
import http2 from 'node:http';
import axios, { type AxiosRequestConfig } from 'axios';
import iconv from 'iconv-lite';
import contentType from 'content-type';
import chardet from 'chardet';
import type { Rule } from './rule';
import { FetchException } from './exception';
import { EXTRA_CA_PEMS } from './ca';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 站点偶尔很慢（海外小站 / 首次握手），默认给 20s
const http = axios.create({
  timeout: 20000,
  maxRedirects: 5,
  // Node 自带 CA 列表缺了几个根，补上后再校验证书，避免整站请求失败
  httpsAgent: new https.Agent({
    keepAlive: true,
    ca: [...tls.rootCertificates, ...EXTRA_CA_PEMS]
  }),
  httpAgent: new http2.Agent({ keepAlive: true })
});

// ===================== Cookie 罐 =====================
// 有些站点（如包子漫画的 gatekeeper、樱花动漫的 server_session）先下发验证/会话 cookie，
// 后续请求必须带上才能拿到内容。这里按主机保存，规则无需关心。

interface JarCookie {
  value: string;
  expire: number;
}

const cookieJar = new Map<string, Map<string, JarCookie>>();

function jarHost(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function jarOf(host: string) {
  let jar = cookieJar.get(host);
  if (!jar) cookieJar.set(host, (jar = new Map()));
  return jar;
}

/** 解析 Cookie 字符串为键值对 */
function parseCookieString(str: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(str || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const key = part.slice(0, idx).trim();
    if (key) out[key] = part.slice(idx + 1).trim();
  }
  return out;
}

function setCookieExpire(value: string, maxAge?: string, expires?: string) {
  const age = Number(maxAge);
  if (Number.isFinite(age) && maxAge !== undefined) return age > 0 ? Date.now() + age * 1000 : 0;
  if (expires) {
    const t = Date.parse(expires);
    if (!Number.isNaN(t)) return t;
  }
  // 没有明确有效期：保留 2 小时（会话级）
  return Date.now() + 2 * 60 * 60 * 1000;
}

/** 记录响应里的 Set-Cookie */
function storeSetCookie(url: string, raw: string | string[] | undefined) {
  const host = jarHost(url);
  if (!host || !raw) return;
  const rows = Array.isArray(raw) ? raw : [raw];
  const jar = jarOf(host);
  for (const row of rows) {
    const [pair, ...attrs] = String(row).split(';');
    const idx = pair.indexOf('=');
    if (idx < 1) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    let maxAge: string | undefined;
    let expires: string | undefined;
    for (const attr of attrs) {
      const [k, ...rest] = attr.split('=');
      const key = k.trim().toLowerCase();
      const val = rest.join('=').trim();
      if (key === 'max-age') maxAge = val;
      else if (key === 'expires') expires = val;
    }
    const expire = setCookieExpire(value, maxAge, expires);
    if (!name) continue;
    if (!value || (expire && expire < Date.now())) jar.delete(name);
    else jar.set(name, { value, expire });
  }
}

/** 把罐里的 cookie 合并进请求头（规则里手写的 Cookie 优先） */
function withJarCookie(ruleCookies: string, url: string, headerCookie?: string) {
  const host = jarHost(url);
  if (!host) return headerCookie || ruleCookies || '';
  const jar = cookieJar.get(host);
  const merged = { ...parseCookieString(ruleCookies), ...parseCookieString(headerCookie || '') };
  if (jar) {
    const now = Date.now();
    for (const [name, item] of jar) {
      if (item.expire && item.expire < now) {
        jar.delete(name);
        continue;
      }
      merged[name] = item.value;
    }
  }
  const text = Object.entries(merged)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return text;
}

/** 清空 Cookie 罐（调试用） */
export function clearCookieJar(host?: string) {
  if (host) cookieJar.delete(host.toLowerCase());
  else cookieJar.clear();
}

export interface RequestParams extends AxiosRequestConfig {
  url: string;
  /** 请求体（规则中的写法，会转成 axios 的 data） */
  body?: any;
  /** 响应编码，如 gbk */
  encoding?: string;
}

export interface UrlVars {
  keyword?: string;
  result?: string;
  page?: number;
  pageSize?: number;
}

function replaceVars(url: string, rule: Rule, vars: UrlVars) {
  const map: Record<string, any> = {
    $keyword: vars.keyword ?? '',
    searchKey: vars.keyword ?? '',
    $host: rule.host,
    $result: vars.result ?? '',
    searchPage: vars.page ?? 1,
    $pageSize: vars.pageSize ?? 20,
    $page: vars.page ?? 1
  };
  return url.replace(/\$keyword|\$pageSize|\$page|\$host|\$result|searchKey|searchPage/g, (m) => String(map[m] ?? ''));
}

/** 把规则中的地址（字符串 / JSON 字符串 / 对象）转换成请求参数 */
export function parseRequest(url: string | Record<string, any>, rule: Rule, vars: UrlVars = {}): RequestParams {
  const params: RequestParams = typeof url === 'object' && url ? { method: 'get', ...(url as any) } : { method: 'get', url: String(url) };

  params.url = replaceVars(String(params.url ?? ''), rule, vars);
  if (params.url.trim().startsWith('{')) {
    try {
      Object.assign(params, JSON.parse(params.url));
      params.url = replaceVars(String(params.url), rule, vars);
    } catch {
      /* 不是 JSON，按普通地址处理 */
    }
  }

  const host = (rule.host || '').trim().replace(/\/$/, '');
  if (params.url.startsWith('//')) {
    params.url = (host.startsWith('https') ? 'https:' : 'http:') + params.url;
  } else if (!/^(https?|ftp):/i.test(params.url)) {
    params.url = host + (params.url.startsWith('/') ? '' : '/') + params.url;
  }

  if (typeof params.method === 'string') params.method = params.method.toLowerCase() as any;
  if (params.body !== undefined) {
    params.data = params.body;
    delete params.body;
  }

  const headers: Record<string, any> = { ...(params.headers as any) };
  const ua: any = rule.userAgent;
  if (ua && typeof ua === 'object') Object.assign(headers, ua);
  else if (typeof ua === 'string' && ua.trim().startsWith('{')) {
    try {
      Object.assign(headers, JSON.parse(ua));
    } catch {
      headers['User-Agent'] = ua;
    }
  } else if (typeof ua === 'string' && ua.trim()) headers['User-Agent'] = ua.trim();
  if (!headers['User-Agent'] && !headers['user-agent']) headers['User-Agent'] = DEFAULT_UA;
  if (rule.cookies && !headers.Cookie) headers.Cookie = rule.cookies;
  // 服务器下发的 Cookie（会话 / 验证 cookie）自动带回同一主机
  const withJar = withJarCookie(String(rule.cookies || ''), params.url, headers.Cookie);
  if (withJar) headers.Cookie = withJar;
  params.headers = headers;

  if (params.encoding === 'gb2312') params.encoding = 'gbk';
  params.responseType = 'arraybuffer';
  return params;
}

function decodeBody(data: Buffer, ctHeader: string | undefined, forced?: string) {
  let encoding = forced;
  if (!encoding && ctHeader) {
    try {
      encoding = contentType.parse(ctHeader).parameters.charset;
    } catch {
      /* ignore */
    }
  }
  if (!encoding) {
    // 从 html meta 里找编码
    const head = data.subarray(0, 2048).toString('latin1');
    const m = head.match(/<meta[^>]+charset=["']?([\w-]+)/i);
    encoding = m?.[1] || (chardet.detect(data) as string) || 'utf8';
  }
  if (!iconv.encodingExists(encoding)) encoding = 'utf8';
  return iconv.decode(data, encoding);
}

/** 网络类错误（超时 / 连接被重置）值得重试一次，海外小站经常第一次握手失败 */
const RETRYABLE = /(timeout|aborted|ECONNRESET|socket hang up|EAI_AGAIN|ETIMEDOUT)/i;

export async function fetch(params: RequestParams): Promise<{ params: RequestParams; body: string }> {
  const { encoding, ...config } = params;
  let lastErr: any;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await http.request({ ...config, responseType: 'arraybuffer' });
      storeSetCookie(String(params.url), res.headers['set-cookie'] as any);
      const buf = Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data);
      return { params, body: decodeBody(buf, res.headers['content-type'] as string, encoding) };
    } catch (err: any) {
      lastErr = err;
      if (attempt === 0 && RETRYABLE.test(String(err?.message || err))) continue;
      break;
    }
  }
  throw new FetchException(`${lastErr?.message || lastErr} (${params.url})`);
}

/** 规则 JS 中使用的 http(url)，返回响应文本 */
export async function httpText(url: string, rule: Rule): Promise<string> {
  return (await fetch(parseRequest(url, rule))).body;
}
