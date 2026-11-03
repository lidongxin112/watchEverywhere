#!/usr/bin/env node
/**
 * 生成 rules/aggregate.json（一次性导入用的规则包）
 *
 *   node scripts/build-rules.mjs
 *
 * 想改规则直接改这里，重新生成再导入即可。
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const CONTENT_TYPE = { MANGA: 0, NOVEL: 1, VIDEO: 2, AUDIO: 3 };

const base = {
  author: 'watchEverywhere',
  loadJs: '',
  cookies: '',
  icon: '',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  sort: 0,
  group: '聚合源',
  createTime: Date.now(),
  modifiedTime: Date.now(),
  enableSearch: false,
  enableDiscover: false,
  enableMultiRoads: false,
  contentDecoder: '',
  contentNextUrl: '',
  chapterNextUrl: '',
  discoverNextUrl: '',
  chapterTime: '',
  chapterCover: '',
  discoverAuthor: ''
};

function rule(data) {
  return {
    ...base,
    id: randomUUID(),
    ...data
  };
}

// ============================================================
// 1. AGE动漫
// ============================================================

/** 目录 / 一周更新 / 排行榜 三种版式统一成同一份列表 */
const AGEDM_LIST = `@js:(() => {
  const $ = cheerio.load(result);
  const out = [];
  const push = (name, cover, url, chapter) => {
    name = String(name || '').replace(/\\s+/g, ' ').trim();
    url = String(url || '').trim();
    // 去掉协议和域名，只留路径：站点有时给 http:// 的绝对地址，直接请求会失败
    if (url.indexOf('http') === 0) {
      const p = url.indexOf('/', url.indexOf('//') + 2);
      url = p > -1 ? url.slice(p) : '/';
    }
    if (!name || !url) return;
    out.push({ name: name, cover: cover || '', url: url, chapter: String(chapter || '').replace(/\\s+/g, ' ').trim() });
  };
  $('.cata_video_item').each((i, el) => {
    const e = $(el);
    const a = e.find('.card-title a').first();
    push(a.text(), e.find('img.video_thumbs').first().attr('data-original'), a.attr('href'), e.find('.video_play_status').first().text());
  });
  $('.video_item').each((i, el) => {
    const e = $(el);
    const a = e.find('.video_item-title a').first();
    push(a.text(), e.find('img').first().attr('data-original'), a.attr('href'), e.find('.video_item--info').first().text());
  });
  $('.rank_list_item').each((i, el) => {
    const e = $(el);
    const a = e.find('a.common_alink').first();
    push(a.text(), '', a.attr('href'), e.find('.rank_list_item_views').first().text());
  });
  return out;
})()`;

/** 详情页每个 tab 是一条线路，包一层 data-road 便于取线路名 */
const AGEDM_ROADS = `@js:(() => {
  const $ = cheerio.load(result);
  const roads = [];
  $('.tab-content .tab-pane').each((i, el) => {
    const id = $(el).attr('id') || '';
    let name = '';
    if (id) name = $('button[data-bs-target="#' + id + '"]').text();
    name = String(name || '').replace(/\\s+/g, ' ').trim() || '线路' + (i + 1);
    const list = $(el).find('ul.video_detail_episode li').length;
    if (!list) return;
    const html = $.html(el);
    roads.push('<section data-road="' + name.replace(/"/g, '') + '">' + html + '</section>');
  });
  return roads;
})()`;

/** 播放页：拿到播放器 iframe（不是直链，播放器会自动切网页模式） */
const AGEDM_PLAY = `@js:(() => {
  const $ = cheerio.load(result);
  const src = $('#iframeForVideo').attr('src') || '';
  if (src) return [src];
  const m = String(result).match(/https?:\\/\\/[^"'\\s]+\\.(?:m3u8|mp4)[^"'\\s]*/i);
  return m ? [m[0]] : [];
})()`;

const agedm = rule({
  name: 'AGE动漫',
  host: 'https://www.agedm.io',
  contentType: CONTENT_TYPE.VIDEO,
  icon: 'https://www.agedm.io/favicon.ico',
  enableSearch: true,
  searchUrl: '/search?query=$keyword',
  searchList: '.cata_video_item',
  searchName: '.card-title a@text',
  searchCover: 'img.video_thumbs@data-original',
  searchChapter: '.video_play_status@text',
  searchDescription: '.desc@text',
  searchResult: '.card-title a@href##^https?://[^/]+',
  enableDiscover: true,
  discoverUrl: [
    '目录::/catalog/all-all-all-all-all-time-$page',
    '一周更新::/update',
    '排行榜::/rank'
  ].join('\n'),
  discoverList: AGEDM_LIST,
  discoverName: '$.name',
  discoverCover: '$.cover',
  discoverChapter: '$.chapter',
  discoverResult: '$.url',
  enableMultiRoads: true,
  chapterUrl: '$result',
  chapterRoads: AGEDM_ROADS,
  chapterRoadName: '@regex:data-road="([^"]*)"',
  chapterList: 'ul.video_detail_episode li a',
  chapterName: 'text',
  chapterResult: 'href',
  contentUrl: '$result',
  contentItems: AGEDM_PLAY
});

/** 站点很慢时，把地址包成带 timeout 的请求描述 */
const slow = (url, timeout = 45000) => JSON.stringify({ url, timeout });

// ============================================================
// 2. 樱花动漫（苹果CMS 模板站，播放页是直链 m3u8）
// ============================================================

/** 从 player_aaaa 里取播放地址，直链优先 */
const YH_PLAY = `@js:(() => {
  const s = String(result);
  const m = s.match(/player_aaaa\\s*=\\s*(\\{[\\s\\S]*?\\})\\s*<\\/script>/);
  if (m) {
    try {
      const j = JSON.parse(m[1]);
      if (j.url) return [j.url];
    } catch (e) {}
  }
  const d = s.match(/https?:\\/\\/[^"'\\s]+\\.(?:m3u8|mp4)[^"'\\s]*/i);
  return d ? [d[0]] : [];
})()`;

const yinghuabb = rule({
  name: '樱花动漫',
  host: 'https://www.yinghuabb.com',
  contentType: CONTENT_TYPE.VIDEO,
  enableSearch: true,
  searchUrl: slow('/index.php/vod/search.html?wd=$keyword&page=$page'),
  searchList: 'ul.stui-vodlist__media > li',
  searchName: '.title a@text',
  searchCover: 'a.stui-vodlist__thumb@data-original',
  searchChapter: '.pic-text@text',
  searchDescription: '.detail p.hidden-mi@text',
  searchResult: '.title a@href',
  enableDiscover: true,
  discoverUrl: [
    '日本动漫::' + slow('/index.php/vod/type/id/20/page/$page.html'),
    '国产动漫::' + slow('/index.php/vod/type/id/21/page/$page.html'),
    '欧美动漫::' + slow('/index.php/vod/type/id/22/page/$page.html'),
    '动漫电影::' + slow('/index.php/vod/type/id/23/page/$page.html'),
    '其他动漫::' + slow('/index.php/vod/type/id/24/page/$page.html')
  ].join('\n'),
  discoverList: '.stui-vodlist li',
  discoverName: '.title a@text',
  discoverCover: 'a.stui-vodlist__thumb@data-original',
  discoverChapter: '.pic-text@text',
  discoverResult: '.title a@href',
  enableMultiRoads: true,
  chapterUrl: `@js:(() => JSON.stringify({ url: String(result || ''), timeout: 45000 }))()`,
  chapterRoads: '.playlist.mb',
  chapterRoadName: '.title@text',
  chapterList: 'ul.stui-content__playlist li a',
  chapterName: 'text',
  chapterResult: 'href',
  contentUrl: `@js:(() => JSON.stringify({ url: String(result || ''), timeout: 45000 }))()`,
  contentItems: YH_PLAY
});

// ============================================================
// 3. 腾讯视频
// ============================================================

const QQ_SEARCH = `@js:(() => {
  const body = {
    version: '26022601',
    clientType: 1,
    filterValue: '',
    uuid: '1a2b3c4d-1111-2222-3333-' + String(Date.now()).slice(-12),
    retry: 0,
    query: String(keyword || ''),
    pagenum: Number(page || 1) - 1,
    featureList: ['DEFAULT_FEFEATURE', 'PC_SHORT_VIDEOS_WATERFALL', 'PC_WANT_EPISODE_V2', 'PC_WANT_EPISODE', 'RECOMMEND_AI_QUERY']
  };
  return JSON.stringify({
    url: 'https://pbaccess.video.qq.com/trpc.videosearch.mobile_search.MultiTerminalSearch/MbSearch?vversion_platform=2',
    method: 'post',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'trpc-trans-info': '{"trpc-env":""}',
      Origin: 'https://v.qq.com',
      Referer: 'https://v.qq.com/x/search/'
    },
    body: JSON.stringify(body)
  });
})()`;

const QQ_LIST = `@js:(() => {
  let j = {};
  try { j = JSON.parse(result); } catch (e) { return []; }
  const items = (((j.data || {}).normalList || {}).itemList) || [];
  const out = [];
  for (const it of items) {
    const doc = it.doc || {};
    const vi = it.videoInfo || {};
    const vd = vi.videoDoc || {};
    const vid = doc.id || vd.vid || '';
    if (!vid || doc.dataType === 5000 || !vi.title) continue;
    const title = String(vi.title || '').replace(/<[^>]+>/g, '');
    if (!title) continue;
    out.push({
      name: title,
      cover: vi.imgUrl || vi.playCover || (it.coverDoc || {}).pic || '',
      chapter: String(vi.typeName || '') + (vi.year && vi.year !== 0 ? ' · ' + vi.year : ''),
      url: vid
    });
  }
  return out;
})()`;

const QQ_GETINFO = `@js:(() => {
  const vid = String(result || '').trim();
  if (!vid) return 'null';
  // 填了登录 Cookie 就按登录态要最高清晰度（普通账号拿 720P，VIP 账号拿到 1080P/4K）
  const account = String(cookie || '').trim();
  const defn = account ? 'uhd' : 'shd';
  return JSON.stringify({
    url: 'https://vv.video.qq.com/getinfo?vids=' + encodeURIComponent(vid) +
      '&platform=' + (account ? '10201' : '101001') +
      '&charge=0&otype=json&defn=' + defn + '&sdtfrom=v1010',
    headers: account ? { Referer: 'https://v.qq.com/', Cookie: account } : { Referer: 'https://v.qq.com/' }
  });
})()`;

const QQ_CONTENT = `@js:(() => {
  const s = String(result || '');
  const i = s.indexOf('{');
  const k = s.lastIndexOf('}');
  if (i > -1 && k > i) {
    try {
      const j = JSON.parse(s.slice(i, k + 1));
      const vi = ((j.vl || {}).vi || [])[0] || {};
      let url = vi.url || '';
      const ui = ((vi.ul || {}).ui || [])[0] || {};
      if (!url && ui.url && vi.fn && vi.fvkey) {
        // 腾讯只给文件名 + 一个 CDN 前缀，拼成完整地址
        url = ui.url + vi.fn + '?vkey=' + vi.fvkey;
      }
      if (url) return [url.indexOf('http://') === 0 ? 'https://' + url.slice(7) : url];
    } catch (e) {}
  }
  const vid = String(lastResult || '').trim();
  return vid ? ['https://v.qq.com/x/page/' + vid + '.html'] : [];
})()`;


/** 腾讯没有匿名频道列表接口，这里用频道词去搜，等于「热播列表」 */
const QQ_DISCOVER = `@js:(() => {
  const words = { '国漫': '国漫', '日漫': '日漫', '电视剧': '电视剧', '电影': '电影', '综艺': '综艺' };
  return Object.keys(words).map(function (tab) {
    const body = {
      version: '26022601',
      clientType: 1,
      filterValue: '',
      uuid: '1a2b3c4d-1111-2222-3333-' + String(Date.now()).slice(-12),
      retry: 0,
      query: words[tab],
      pagenum: 0,
      featureList: ['DEFAULT_FEFEATURE', 'PC_SHORT_VIDEOS_WATERFALL']
    };
    const req = {
      url: 'https://pbaccess.video.qq.com/trpc.videosearch.mobile_search.MultiTerminalSearch/MbSearch?vversion_platform=2',
      method: 'post',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'trpc-trans-info': '{"trpc-env":""}',
        Origin: 'https://v.qq.com',
        Referer: 'https://v.qq.com/x/search/'
      },
      body: JSON.stringify(body)
    };
    return tab + '::' + JSON.stringify(req);
  });
})()`;

const tencent = rule({
  name: '腾讯视频',
  host: 'https://v.qq.com',
  contentType: CONTENT_TYPE.VIDEO,
  icon: 'https://v.qq.com/favicon.ico',
  enableSearch: true,
  searchUrl: QQ_SEARCH,
  searchList: QQ_LIST,
  searchName: '$.name',
  searchCover: '$.cover',
  searchChapter: '$.chapter',
  searchResult: '$.url',
  enableDiscover: true,
  discoverUrl: QQ_DISCOVER,
  discoverList: QQ_LIST,
  discoverName: '$.name',
  discoverCover: '$.cover',
  discoverChapter: '$.chapter',
  discoverResult: '$.url',
  chapterUrl: 'null',
  chapterList: `@js:(() => [{ name: '在线播放', url: String(lastResult || '').trim() }])()`,
  chapterName: '$.name',
  chapterResult: '$.url',
  contentUrl: QQ_GETINFO,
  contentItems: QQ_CONTENT
});

// ============================================================
// 4. 爱奇艺（搜索走 mesh 接口，播放打开官网页面）
// ============================================================

const IQ_LIST = `@js:(() => {
  let j = {};
  try { j = JSON.parse(result); } catch (e) { return []; }
  const tpl = (((j.data || {}).templates) || []);
  const out = [];
  for (const t of tpl) {
    const a = t.albumInfo || {};
    const name = String(a.title || '').replace(/<[^>]+>/g, '');
    if (!name) continue;
    const tags = (a.tags || []).map((x) => x.text).filter(Boolean).join(' ');
    out.push({
      name: name,
      cover: a.imgH || a.img || '',
      chapter: String((a.year || {}).value || '') + (tags ? ' · ' + tags : ''),
      url: String(a.qipuId || ''),
      desc: String(a.introduction || a.brief || '').replace(/<[^>]+>/g, '')
    });
  }
  return out;
})()`;


const IQ_DISCOVER_LIST = `@js:(() => {
  let j = {};
  try { j = JSON.parse(result); } catch (e) { return []; }
  const list = ((j.data || {}).list) || [];
  return list.filter((x) => x.name).map((x) => ({
    name: String(x.name),
    cover: x.imageUrl || '',
    author: '',
    chapter: (x.videoCount ? x.videoCount + '集' : '') + (x.period ? ' · ' + x.period : ''),
    url: 'https://so.iqiyi.com/so?q=' + encodeURIComponent(String(x.name)),
    desc: String(x.description || '').replace(/<[^>]+>/g, '')
  }));
})()`;

const IQ_DISCOVER_URL = [
  '电影::https://pcw-api.iqiyi.com/search/recommend/list?channel_id=1&data_type=1&mode=24&page_id=$page&ret_num=24',
  '电视剧::https://pcw-api.iqiyi.com/search/recommend/list?channel_id=2&data_type=1&mode=24&page_id=$page&ret_num=24',
  '纪录片::https://pcw-api.iqiyi.com/search/recommend/list?channel_id=3&data_type=1&mode=24&page_id=$page&ret_num=24',
  '动漫::https://pcw-api.iqiyi.com/search/recommend/list?channel_id=4&data_type=1&mode=24&page_id=$page&ret_num=24',
  '综艺::https://pcw-api.iqiyi.com/search/recommend/list?channel_id=6&data_type=1&mode=24&page_id=$page&ret_num=24',
  '儿童::https://pcw-api.iqiyi.com/search/recommend/list?channel_id=7&data_type=1&mode=24&page_id=$page&ret_num=24'
].join('\n');

const iqiyi = rule({
  name: '爱奇艺',
  host: 'https://www.iqiyi.com',
  contentType: CONTENT_TYPE.VIDEO,
  icon: 'https://www.iqiyi.com/favicon.ico',
  enableSearch: true,
  searchUrl:
    'https://mesh.if.iqiyi.com/portal/lw/search/homePageV3?key=$keyword&pageNum=$page&pageSize=20&source=default',
  searchList: IQ_LIST,
  searchName: '$.name',
  searchCover: '$.cover',
  searchChapter: '$.chapter',
  searchDescription: '$.desc',
  searchResult: `@js:'https://so.iqiyi.com/so?q=' + encodeURIComponent(String(result.name || ''))`,
  enableDiscover: true,
  discoverUrl: IQ_DISCOVER_URL,
  discoverList: IQ_DISCOVER_LIST,
  discoverName: '$.name',
  discoverCover: '$.cover',
  discoverChapter: '$.chapter',
  discoverDescription: '$.desc',
  discoverResult: '$.url',
  chapterUrl: 'null',
  chapterList: `@js:(() => [{ name: '官网观看', url: String(lastResult || '') }])()`,
  chapterName: '$.name',
  chapterResult: '$.url',
  contentUrl: 'null',
  contentItems: '@js:lastResult'
});

// ============================================================
// 5. 哔哩哔哩番剧（wbi 签名 + pgc 接口，匿名可拿 720P）
// ============================================================

const BILI_LOAD = `var __bili = globalThis.__bili || (globalThis.__bili = {});
var __BILI_MIXIN = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
async function __biliWbiKey() {
  if (__bili.key) return __bili.key;
  const nav = JSON.parse(String(await http('https://api.bilibili.com/x/web-interface/nav')));
  const img = ((nav.data || {}).wbi_img || {});
  const a = String(img.img_url || '').split('/').pop().split('.')[0];
  const b = String(img.sub_url || '').split('/').pop().split('.')[0];
  const raw = a + b;
  __bili.key = __BILI_MIXIN.map((i) => raw[i] || '').join('').slice(0, 32);
  return __bili.key;
}
async function __biliBuvid() {
  if (__bili.buvid) return __bili.buvid;
  try {
    const spi = JSON.parse(String(await http('https://api.bilibili.com/x/frontend/finger/spi')));
    __bili.buvid = ((spi.data || {}).b_3) || '';
  } catch (e) { __bili.buvid = ''; }
  return __bili.buvid;
}
function __biliSign(params, key) {
  const wts = Math.round(Date.now() / 1000);
  const q = Object.assign({}, params, { wts: wts });
  const str = Object.keys(q).sort().map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(String(q[k]).replace(/[!'()*]/g, ''));
  }).join('&');
  return str + '&w_rid=' + CryptoJS.MD5(str + key).toString();
}
// 规则里填了账号 Cookie（SESSDATA=...; bili_jct=...; DedeUserID=...）就带上，
// 搜索限流更宽、番剧能拿到该账号权益内的清晰度
function __biliCookie(account, buvid) {
  const parts = [];
  if (buvid) parts.push('buvid3=' + buvid);
  if (account) parts.push(account);
  return parts.join('; ');
}
async function __biliRequest(url, params) {
  const key = await __biliWbiKey();
  const buvid = await __biliBuvid();
  const query = __biliSign(params, key);
  return JSON.stringify({
    url: url + (url.indexOf('?') > -1 ? '&' : '?') + query,
    headers: {
      Referer: 'https://www.bilibili.com/',
      Origin: 'https://www.bilibili.com',
      Cookie: __biliCookie(String(cookie || '').trim(), buvid)
    }
  });
}`;

const BILI_SEARCH = `@js:(async () => {
  return await __biliRequest('https://api.bilibili.com/x/web-interface/wbi/search/type', {
    search_type: 'media_bangumi',
    keyword: String(keyword || ''),
    page: Number(page || 1)
  });
})()`;

const BILI_SEASON = `@js:(async () => {
  const buvid = await __biliBuvid();
  return JSON.stringify({
    url: 'https://api.bilibili.com/pgc/view/web/season?season_id=' + encodeURIComponent(String(result || '')),
    headers: { Referer: 'https://www.bilibili.com/', Cookie: __biliCookie(String(cookie || '').trim(), buvid) }
  });
})()`;

const BILI_EP = `@js:(() => {
  let j = {};
  try { j = JSON.parse(result); } catch (e) { return []; }
  const eps = (((j.result || {}).episodes) || []);
  return eps.map((e) => ({
    name: '第' + e.title + '话' + (e.long_title ? ' ' + e.long_title : ''),
    cover: e.cover || '',
    url: e.id + '|' + e.cid,
    time: e.pub_time ? '' : ''
  }));
})()`;

/**
 * 番剧播放地址
 *
 * 登录 Cookie（SESSDATA 那一串）填到规则的 cookies 里，qn 直接要 127（8K）/112（1080P+），
 * 服务端会按账号权益自动降级：大会员拿满，普通账号拿 480P，未登录拿试看/480P。
 */
const BILI_PLAY = `@js:(async () => {
  const parts = String(lastResult || '').split('|');
  const ep = parts[0] || '';
  const cid = parts[1] || '';
  if (!ep || !cid) return [];
  const account = String(cookie || '').trim();
  const buvid = __bili.buvid ? 'buvid3=' + __bili.buvid : '';
  const cookieHeader = account ? (buvid ? buvid + '; ' + account : account) : buvid;
  const url = 'https://api.bilibili.com/pgc/player/web/playurl?ep_id=' + ep + '&cid=' + cid +
    '&qn=127&fnval=0&fnver=0&fourk=1';
  let j = {};
  try {
    j = JSON.parse(String(await http(JSON.stringify({
      url: url,
      headers: { Referer: 'https://www.bilibili.com/', Cookie: cookieHeader }
    }))));
  } catch (e) { j = {}; }
  const r = j.result || j.data || {};
  if (r.durl && r.durl.length) return r.durl.map((d) => d.url);
  if (r.dash && r.dash.video && r.dash.video.length) return [r.dash.video[0].baseUrl || r.dash.video[0].base_url];
  return ['https://www.bilibili.com/bangumi/play/ep' + ep];
})()`;


const BILI_PGC_RANK_LIST = `@js:(() => {
  let j = {};
  try { j = JSON.parse(result); } catch (e) { return []; }
  const list = ((j.result || {}).list) || [];
  return list.filter((x) => x.title).map((x) => ({
    name: String(x.title).replace(/<[^>]+>/g, ''),
    cover: x.cover || '',
    author: (x.publish_info || {}).release_date_show || '',
    chapter: ((x.new_ep || {}).index_show) || ((x.new_ep || {}).desc) || '',
    url: String(x.season_id || '')
  }));
})()`;

const BILI_PGC_RANK_URL = [
  '番剧::https://api.bilibili.com/pgc/web/rank/list?day=3&season_type=1',
  '国创::https://api.bilibili.com/pgc/web/rank/list?day=3&season_type=4',
  '电影::https://api.bilibili.com/pgc/web/rank/list?day=3&season_type=2',
  '纪录片::https://api.bilibili.com/pgc/web/rank/list?day=3&season_type=3',
  '电视剧::https://api.bilibili.com/pgc/web/rank/list?day=3&season_type=5'
].join('\n');

const bilibili = rule({
  name: '哔哩哔哩番剧',
  host: 'https://www.bilibili.com',
  contentType: CONTENT_TYPE.VIDEO,
  icon: 'https://www.bilibili.com/favicon.ico',
  loadJs: BILI_LOAD,
  enableSearch: true,
  searchUrl: BILI_SEARCH,
  searchList: '$.data.result',
  searchName: '$.title##<[^>]+>',
  searchCover: '$.cover',
  searchChapter: '$.index_show',
  searchDescription: '$.desc##<[^>]+>',
  searchResult: '$.season_id',
  enableDiscover: true,
  discoverUrl: BILI_PGC_RANK_URL,
  discoverList: BILI_PGC_RANK_LIST,
  discoverName: '$.name',
  discoverCover: '$.cover',
  discoverChapter: '$.chapter',
  discoverResult: '$.url',
  chapterUrl: BILI_SEASON,
  chapterList: BILI_EP,
  chapterName: '$.name',
  chapterCover: '$.cover',
  chapterResult: '$.url',
  contentUrl: 'null',
  contentItems: BILI_PLAY
});


// ============================================================
// 5b. 哔哩哔哩（普通投稿视频）
// ============================================================

const BILI_VIDEO_SEARCH = `@js:(async () => {
  return await __biliRequest('https://api.bilibili.com/x/web-interface/wbi/search/type', {
    search_type: 'video',
    keyword: String(keyword || ''),
    page: Number(page || 1)
  });
})()`;

const BILI_VIDEO_PAGES = `@js:(() => {
  let j = {};
  try { j = JSON.parse(result); } catch (e) { return []; }
  const d = j.data || {};
  if (!d.bvid) return [];
  globalThis.__biliBvid = d.bvid;
  return (d.pages || []).map((p) => ({ cid: p.cid, page: p.page, part: p.part, duration: p.dimension ? '' : '' }));
})()`;

const BILI_VIDEO_PLAY = `@js:(async () => {
  const parts = String(lastResult || '').split('|');
  const cid = parts[0];
  const bvid = parts[1] || globalThis.__biliBvid || '';
  if (!cid || !bvid) return [];
  const url = 'https://api.bilibili.com/x/player/playurl?bvid=' + bvid + '&cid=' + cid + '&qn=80&fnval=0&fnver=0&fourk=1';
  let j = {};
  try {
    j = JSON.parse(String(await http(JSON.stringify({ url: url, headers: { Referer: 'https://www.bilibili.com/' } }))));
  } catch (e) { j = {}; }
  const d = j.data || {};
  if (d.durl && d.durl.length) return d.durl.map((x) => x.url);
  return ['https://www.bilibili.com/video/' + bvid];
})()`;


const BILI_UGC_RANK_LIST = `@js:(() => {
  let j = {};
  try { j = JSON.parse(result); } catch (e) { return []; }
  const list = ((j.data || {}).list) || [];
  return list.filter((x) => x.bvid && x.title).map((x) => ({
    name: String(x.title),
    cover: x.pic || '',
    author: (x.owner || {}).name || '',
    chapter: (x.tname || '') + ' · ' + (((x.stat || {}).view || 0) + ' 播放'),
    url: String(x.bvid)
  }));
})()`;

const biliRank = (rid) =>
  JSON.stringify({
    url: 'https://api.bilibili.com/x/web-interface/ranking/v2?rid=' + rid + '&type=all',
    headers: { Referer: 'https://www.bilibili.com/', Origin: 'https://www.bilibili.com' }
  });

const BILI_UGC_RANK_URL = `@js:(async () => {
  const buvid = await __biliBuvid();
  const cookie = buvid ? 'buvid3=' + buvid : '';
  const mk = (rid) => JSON.stringify({
    url: 'https://api.bilibili.com/x/web-interface/ranking/v2?rid=' + rid + '&type=all',
    headers: { Referer: 'https://www.bilibili.com/', Origin: 'https://www.bilibili.com', Cookie: cookie }
  });
  return [
    '全站::' + mk(0),
    '动画::' + mk(1),
    '音乐::' + mk(3),
    '游戏::' + mk(4),
    '影视::' + mk(181)
  ];
})()`;

const bilibiliVideo = rule({
  name: '哔哩哔哩',
  host: 'https://www.bilibili.com',
  contentType: CONTENT_TYPE.VIDEO,
  icon: 'https://www.bilibili.com/favicon.ico',
  loadJs: BILI_LOAD,
  enableSearch: true,
  searchUrl: BILI_VIDEO_SEARCH,
  searchList: '$.data.result',
  searchName: '$.title##<[^>]+>',
  searchCover: '$.pic',
  searchAuthor: '$.author',
  searchChapter: '$.duration',
  searchResult: '$.bvid',
  enableDiscover: true,
  discoverUrl: BILI_UGC_RANK_URL,
  discoverList: BILI_UGC_RANK_LIST,
  discoverName: '$.name',
  discoverCover: '$.cover',
  discoverAuthor: '$.author',
  discoverChapter: '$.chapter',
  discoverResult: '$.url',
  chapterUrl: 'https://api.bilibili.com/x/web-interface/view?bvid=$result',
  chapterList: BILI_VIDEO_PAGES,
  chapterName: `@js:'P' + result.page + (result.part ? ' ' + result.part : '')`,
  chapterResult: `@js:String(result.cid || '') + '|' + String(globalThis.__biliBvid || '')`,
  contentUrl: 'null',
  contentItems: BILI_VIDEO_PLAY
});

// ============================================================
// 6. 包子漫画
// ============================================================

/** 详情页章节项 -> /comic/chapter/<slug>/<section>_<chapter>.html */
const BZ_CHAPTER = `@js:(() => {
  const $ = cheerio.load(result);
  const a = $(result).is('a') ? $(result) : $(result).find('a').first();
  const href = a.attr('href') || '';
  const m = /comic_id=([^&]+)&(?:amp;)?section_slot=(\\d+)&(?:amp;)?chapter_slot=(\\d+)/.exec(href.replace(/&amp;/g, '&'));
  if (!m) return '';
  return '/comic/chapter/' + m[1] + '/' + m[2] + '_' + m[3] + '.html';
})()`;

// ---- 包子漫画：gatekeeper 浏览器校验（SHA-256 前导零位 PoW）----
// 站点首次访问会下发校验页，这里在规则里算完再提交，
// 拿到的 cookie 由引擎的 cookie 罐（request.ts）自动保存、自动携带。
const BZ_LOAD = `var __gkReady = globalThis.__gkReady || false;
function __gkBits(hex) {
  var n = 0;
  for (var i = 0; i < hex.length; i++) {
    var v = parseInt(hex.charAt(i), 16);
    for (var b = 3; b >= 0; b--) {
      if (((v >> b) & 1) === 0) n++;
      else return n;
    }
  }
  return n;
}
async function __gkPrime(host) {
  if (__gkReady) return true;
  try {
    var html = String(await http(host + '/__gatekeeper_challenge/start?return=%2F'));
    var m = /g\\.start\\((\\{[\\s\\S]*?\\})\\)/.exec(html);
    if (!m) { __gkReady = true; return true; }
    var json = m[1].replace(/([a-zA-Z_][a-zA-Z0-9_]*):/g, '"$1":');
    var cfg = JSON.parse(json);
    var nonce = 0;
    while (__gkBits(CryptoJS.SHA256('gatekeeper-pow-v1:' + cfg.challengeId + ':' + nonce).toString()) < cfg.difficultyBits) {
      nonce++;
      if (nonce > 20000000) break;
    }
    await http(JSON.stringify({
      url: host + cfg.verifyUrl,
      method: 'post',
      headers: {
        'content-type': 'application/json',
        Origin: host,
        Referer: host + '/__gatekeeper_challenge/start?return=%2F'
      },
      body: JSON.stringify({ challenge_id: cfg.challengeId, ticket: cfg.ticket, nonce: String(nonce) })
    }));
  } catch (e) {}
  __gkReady = true;
  return true;
}`;

const BZ_SEARCH = `@js:(async () => {
  await __gkPrime('https://cn.bzmgcn.com');
  const p = Number(page || 1);
  return '/search?q=' + encodeURIComponent(String(keyword || '')) + (p > 1 ? '&page=' + p : '');
})()`;

/**
 * 发现走站内的 AMP 列表接口：36 条/页、带 next 游标，能一直翻。
 * 分类参数：type=题材，region=地区，state=连载状态
 */
const bzList = (name, params) => name + '::' + JSON.stringify({ url: '/api/bzmhq/amp_comic_list?' + params, timeout: 30000 });

const BZ_DISCOVER = `@js:(async () => {
  await __gkPrime('https://cn.bzmgcn.com');
  const q = '&filter=*&page=$page&limit=36&language=cn';
  return [
    '全部::' + JSON.stringify({ url: '/api/bzmhq/amp_comic_list?type=all&region=all&state=all' + q }),
    '国漫::' + JSON.stringify({ url: '/api/bzmhq/amp_comic_list?type=all&region=cn&state=all' + q }),
    '日漫::' + JSON.stringify({ url: '/api/bzmhq/amp_comic_list?type=all&region=jp&state=all' + q }),
    '欧美::' + JSON.stringify({ url: '/api/bzmhq/amp_comic_list?type=all&region=en&state=all' + q }),
    '韩漫::' + JSON.stringify({ url: '/api/bzmhq/amp_comic_list?type=all&region=kr&state=all' + q }),
    '连载中::' + JSON.stringify({ url: '/api/bzmhq/amp_comic_list?type=all&region=all&state=serial' + q }),
    '已完结::' + JSON.stringify({ url: '/api/bzmhq/amp_comic_list?type=all&region=all&state=pub' + q }),
    '热血::' + JSON.stringify({ url: '/api/bzmhq/amp_comic_list?type=rexie&region=all&state=all' + q }),
    '恋爱::' + JSON.stringify({ url: '/api/bzmhq/amp_comic_list?type=lianai&region=all&state=all' + q }),
    '玄幻::' + JSON.stringify({ url: '/api/bzmhq/amp_comic_list?type=xuanhuan&region=all&state=all' + q }),
    '都市::' + JSON.stringify({ url: '/api/bzmhq/amp_comic_list?type=dushi&region=all&state=all' + q }),
    '校园::' + JSON.stringify({ url: '/api/bzmhq/amp_comic_list?type=shaonian&region=all&state=all' + q }),
    '古风::' + JSON.stringify({ url: '/api/bzmhq/amp_comic_list?type=gufeng&region=all&state=all' + q }),
    '悬疑::' + JSON.stringify({ url: '/api/bzmhq/amp_comic_list?type=xuanyi&region=all&state=all' + q }),
    '科幻::' + JSON.stringify({ url: '/api/bzmhq/amp_comic_list?type=kehuan&region=all&state=all' + q }),
    '穿越::' + JSON.stringify({ url: '/api/bzmhq/amp_comic_list?type=chuanyue&region=all&state=all' + q }),
    '后宫::' + JSON.stringify({ url: '/api/bzmhq/amp_comic_list?type=hougong&region=all&state=all' + q }),
    '格斗::' + JSON.stringify({ url: '/api/bzmhq/amp_comic_list?type=gedou&region=all&state=all' + q }),
    '总裁::' + JSON.stringify({ url: '/api/bzmhq/amp_comic_list?type=zongcai&region=all&state=all' + q })
  ];
})()`;

const BZ_JSON_LIST = `@js:(() => {
  let j = {};
  const text = String(result || '').trim();
  if (!text.startsWith('{')) return [];
  try { j = JSON.parse(text); } catch (e) { return []; }
  return (j.items || []).map((x) => ({
    name: String(x.name || ''),
    cover: x.topic_img ? 'https://static-tw.bzmgcn.com/cover/' + x.topic_img : '',
    author: String(x.author || ''),
    chapter: (x.type_names || []).join(' / ') + (x.region_name ? ' · ' + x.region_name : '') +
      (x.state ? ' · ' + x.state : ''),
    url: '/comic/' + String(x.comic_id || '')
  })).filter((x) => x.name && x.url !== '/comic/');
})()`;

const BZ_CHAPTER_URL = `@js:(async () => {
  await __gkPrime('https://cn.bzmgcn.com');
  return String(result || '');
})()`;

/** 包子漫画列表：卡片 → 对象；封面只取外层第一张 amp-img，避免多张图拼在一起 */
const BZ_CARD_LIST = `@js:(() => {
  const $ = cheerio.load(result);
  const out = [];
  $('.comics-card').each((i, el) => {
    const e = $(el);
    const name = e.find('.comics-card__title').first().text().replace(/\\s+/g, ' ').trim();
    const url = e.find('a.comics-card__poster').first().attr('href') || '';
    if (!name || !url) return;
    const cover = e.find('amp-img').first().attr('src') || '';
    out.push({
      name: name,
      cover: cover,
      author: e.find('.tags').first().text().replace(/\\s+/g, ' ').trim(),
      url: url,
      chapter: ''
    });
  });
  return out;
})()`;


/** 正文：章节页里挑漫画图；页面被登录墙挡住时退回原站章节页 */
const BZ_CONTENT = String.raw`@js:(async () => {
  const pageUrl = String(lastResult || '');
  const origin = (pageUrl.match(/^https?:\/\/[^/]+/) || ['https://cn.bzmgcn.com'])[0];
  const out = [];
  const seen = {};
  const abs = (u) => {
    if (!u) return '';
    if (u.indexOf('//') === 0) return 'https:' + u;
    if (u.charAt(0) === '/') return origin + u;
    return u;
  };
  const add = (raw) => {
    const src = abs(String(raw || '').trim());
    if (!src || seen[src]) return;
    if (!/^https?:\/\//.test(src)) return;
    if (!/\.(jpe?g|png|webp|gif|avif|bmp)/i.test(src)) return;
    if (/logo|icon|avatar|qr(code)?|banner|advert|default_cover|placeholder|loading|spinner|1x1/i.test(src)) return;
    // 小尺寸元素（站点 logo / 按钮）一般带 size 参数，这里顺手排掉
    if (/[?&](w|width)=(1?\d{1,2})&/.test(src)) return;
    seen[src] = 1;
    out.push(src);
  };

  // 包子漫画有浏览器校验，先把 clearance 拿到手（同一进程内只算一次）
  try { await __gkPrime(origin); } catch (e) {}

  let page = '';
  try { page = String(await http(pageUrl)); } catch (e) { page = ''; }

  if (page) {
    const $ = cheerio.load(page);
    $('amp-img, img').each((i, el) => {
      const e = $(el);
      add(e.attr('src') || e.attr('data-src') || e.attr('data-original') || e.attr('data-lazy-src'));
      const srcset = e.attr('srcset') || e.attr('data-srcset');
      if (srcset) {
        String(srcset).split(',').forEach((part) => {
          const u = part.trim().split(' ')[0];
          if (u) add(u);
        });
      }
    });
  }

  // 图片列表有时在 amp-list 里按需拉取：跟着把它的接口也请求一遍
  if (page && out.length < 3) {
    const $2 = cheerio.load(page);
    const lists = [];
    $2('amp-list').each((i, el) => {
      const src = $2(el).attr('src');
      if (src) lists.push(abs(src));
    });
    for (const u of lists) {
      try {
        const body = String(await http(u));
        let j = null;
        try { j = JSON.parse(body); } catch (e) { j = null; }
        if (!j) continue;
        const walk = (v) => {
          if (typeof v === 'string') add(v);
          else if (Array.isArray(v)) v.forEach(walk);
          else if (v && typeof v === 'object') Object.keys(v).forEach((k) => walk(v[k]));
        };
        walk(j);
      } catch (e) {}
    }
  }

  return out.length ? out : [pageUrl];
})()`;

/** 包子漫画目录：页面里正序/倒序各渲染一份，按章节地址去重 */
const BZ_CHAPTERS = String.raw`@js:(() => {
  const $ = cheerio.load(result);
  const out = [];
  const seen = {};
  $('.comics-chapters').each((i, el) => {
    const e = $(el);
    const a = e.find('a').first();
    const href = (a.attr('href') || '').replace(/&amp;/g, '&');
    const m = /comic_id=([^&]+)&section_slot=(\d+)&chapter_slot=(\d+)/.exec(href);
    if (!m) return;
    const name = e.find('span').first().text().replace(/\s+/g, ' ').trim() || a.text().replace(/\s+/g, ' ').trim();
    if (!name) return;
    const url = '/comic/chapter/' + m[1] + '/' + m[2] + '_' + m[3] + '.html';
    if (seen[url]) return;
    seen[url] = 1;
    out.push({ name: name, url: url });
  });
  return out;
})()`;

const bzmgcn = rule({
  name: '包子漫画',
  host: 'https://cn.bzmgcn.com',
  contentType: CONTENT_TYPE.MANGA,
  // 该站有浏览器校验，loadJs 里自动过检；章节正文接口要登录，规则只到目录
  loadJs: BZ_LOAD,
  enableSearch: true,
  searchUrl: BZ_SEARCH,
  searchList: BZ_CARD_LIST,
  searchName: '$.name',
  searchCover: '$.cover',
  searchAuthor: '$.author',
  searchResult: '$.url',
  enableDiscover: true,
  discoverUrl: BZ_DISCOVER,
  discoverList: BZ_JSON_LIST,
  discoverName: '$.name',
  discoverCover: '$.cover',
  discoverChapter: '$.chapter',
  discoverResult: '$.url',
  chapterUrl: BZ_CHAPTER_URL,
  chapterList: BZ_CHAPTERS,
  chapterName: '$.name',
  chapterResult: '$.url',
  contentUrl: 'null',
  contentItems: BZ_CONTENT
});

// ============================================================
// 7. 哔哩哔哩漫画（搜索 + 官方页打开）
// ============================================================

const BILI_MANGA_SEARCH = `@js:(async () => {
  const buvid = await __biliBuvid();
  const body = JSON.stringify({ key_word: String(keyword || ''), page_num: Number(page || 1), page_size: 30 });
  const res = String(await http(JSON.stringify({
    url: 'https://manga.bilibili.com/twirp/comic.v1.Comic/Search?device=pc&platform=web',
    method: 'post',
    headers: {
      'content-type': 'application/json',
      Referer: 'https://manga.bilibili.com/',
      Origin: 'https://manga.bilibili.com',
      Cookie: buvid ? 'buvid3=' + buvid : ''
    },
    body: body
  })));
  return JSON.stringify({
    url: 'https://manga.bilibili.com/twirp/comic.v1.Comic/Search?device=pc&platform=web',
    method: 'post',
    headers: {
      'content-type': 'application/json',
      Referer: 'https://manga.bilibili.com/',
      Origin: 'https://manga.bilibili.com',
      Cookie: buvid ? 'buvid3=' + buvid : ''
    },
    body: body
  });
})()`;

/** 漫画首页是 SSR，一页就有 170+ 部；按 mc 号去重 */
const BILI_MANGA_LIST = String.raw`@js:(() => {
  const $ = cheerio.load(result);
  const out = [];
  const seen = {};
  $('a[href*="/detail/mc"]').each((i, el) => {
    const a = $(el);
    const m = /\/detail\/mc(\d+)/.exec(a.attr('href') || '');
    if (!m) return;
    const id = m[1];
    if (seen[id]) return;
    const name = String(a.find('h3').first().text() || a.attr('title') || a.find('img').attr('alt') || a.text() || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name || name.length > 40) return;
    const cover = a.find('img').attr('src') || a.find('source').attr('srcSet') || '';
    seen[id] = 1;
    out.push({ name: name, cover: cover, url: id, chapter: '' });
  });
  return out;
})()`;

/**
 * 哔哩哔哩漫画正文
 *
 * 目录/图片接口都要登录态（SESSDATA），匿名只会返回 code 99：
 *   ComicDetail{comic_id}      → data.episodes[]
 *   GetImageIndex{ep_id}       → data.images[{ path, x, y }]
 *   ImageToken{urls}           → data[{ url, token }]（带 token 的直链）
 * 没填 Cookie 时退回原站详情页，让内嵌页面自己处理。
 */
const BILI_MANGA_CHAPTER = String.raw`@js:(async () => {
  const comicId = String(result || '').trim();
  const account = String(cookie || '').trim();
  if (!account || !comicId) {
    // 没登录态就把详情页抓下来（chapterList 会退回“在哔哩哔哩漫画中阅读”）
    return JSON.stringify({ url: 'https://manga.bilibili.com/detail/mc' + comicId });
  }
  return JSON.stringify({
    url: 'https://manga.bilibili.com/twirp/comic.v1.Comic/ComicDetail?device=pc&platform=web',
    method: 'post',
    headers: {
      'content-type': 'application/json',
      Referer: 'https://manga.bilibili.com/',
      Origin: 'https://manga.bilibili.com',
      Cookie: account
    },
    body: JSON.stringify({ comic_id: Number(comicId) })
  });
})()`;

const BILI_MANGA_CHAPTERS = String.raw`@js:(() => {
  const comicId = String(lastResult || '').trim();
  let j = null;
  try { j = JSON.parse(String(result || '')); } catch (e) { j = null; }
  const eps = j && j.data && j.data.episodes;
  if (!eps || !eps.length) {
    return [{ name: '在哔哩哔哩漫画中阅读', url: 'https://manga.bilibili.com/detail/mc' + comicId }];
  }
  return eps.map((e) => ({
    name: '第' + (e.ord || e.id) + '话' + (e.title ? ' ' + e.title : ''),
    url: String(e.id)
  }));
})()`;

const BILI_MANGA_IMAGES = String.raw`@js:(async () => {
  const account = String(cookie || '').trim();
  const ep = String(lastResult || '').trim();
  if (!account || !/^\d+$/.test(ep)) return [ep];

  const post = async (path, payload) => {
    const body = String(await http(JSON.stringify({
      url: 'https://manga.bilibili.com/twirp/comic.v1.Comic/' + path + '?device=pc&platform=web',
      method: 'post',
      headers: {
        'content-type': 'application/json',
        Referer: 'https://manga.bilibili.com/',
        Origin: 'https://manga.bilibili.com',
        Cookie: account
      },
      body: JSON.stringify(payload)
    })));
    return JSON.parse(body);
  };

  let images = [];
  try {
    const idx = await post('GetImageIndex', { ep_id: Number(ep) });
    images = (idx.data || {}).images || [];
  } catch (e) { images = []; }
  if (!images.length) return ['https://manga.bilibili.com/detail/mc0'];

  const paths = images.map((x) => String(x.path || ''));
  let urls = [];
  try {
    const tok = await post('ImageToken', { urls: JSON.stringify(paths) });
    urls = (tok.data || []).map((x) => String(x.url || '').replace(/^http:/, 'https:'));
  } catch (e) { urls = []; }
  if (!urls.length) return ['https://manga.bilibili.com/detail/mc0'];
  return urls.filter(Boolean);
})()`;

const bilibiliManga = rule({
  name: '哔哩哔哩漫画',
  host: 'https://manga.bilibili.com',
  contentType: CONTENT_TYPE.MANGA,
  icon: 'https://manga.bilibili.com/favicon.ico',
  loadJs: BILI_LOAD,
  enableSearch: true,
  searchUrl: BILI_MANGA_SEARCH,
  searchList: '$.data.list',
  searchName: '$.title##<[^>]+>',
  searchCover: '$.horizontal_cover||$.square_cover',
  searchAuthor: '$.author[0].name',
  searchChapter: '$.styles[0]',
  searchResult: '$.id',
  enableDiscover: true,
  discoverUrl: '首页推荐::https://manga.bilibili.com/',
  discoverList: BILI_MANGA_LIST,
  discoverName: '$.name',
  discoverCover: '$.cover',
  discoverResult: '$.url',
  chapterUrl: BILI_MANGA_CHAPTER,
  chapterList: BILI_MANGA_CHAPTERS,
  chapterName: '$.name',
  chapterResult: '$.url',
  contentUrl: 'null',
  contentItems: BILI_MANGA_IMAGES
});

// ============================================================
// 8. 腾讯动漫（目录页可用；站内搜索是 SPA，未接入）
// ============================================================

const AC_LIST = `@js:(() => {
  const $ = cheerio.load(result);
  const out = [];
  $('a[href*="comicInfo/id/"]').each((i, el) => {
    const a = $(el);
    const href = a.attr('href') || '';
    if (!/comicInfo\\/id\\/\\d+/.test(href)) return;
    const name = String(a.attr('title') || a.text() || '').replace(/\\s+/g, ' ').trim();
    if (!name) return;
    const box = a.closest('li');
    const cover = box.find('img').attr('data-original') || box.find('img').attr('src') || '';
    if (out.some((x) => x.url === href)) return;
    out.push({ name: name, cover: cover, url: href });
  });
  return out;
})()`;

/** 腾讯动漫详情页 SSR 里带全部章节：按 cid 去重、丢掉“开始阅读/上一话”这种入口 */
const AC_CHAPTERS = String.raw`@js:(() => {
  const $ = cheerio.load(result);
  const out = [];
  const seen = {};
  $('.works-chapter-list-wr a[href*="/ComicView/index/id/"], .works-chapter-list a[href*="/ComicView/index/id/"]').each((i, el) => {
    const a = $(el);
    const href = a.attr('href') || '';
    const m = /\/cid\/(\d+)/.exec(href);
    if (!m) return;
    const name = String(a.attr('title') || a.text() || '').replace(/\s+/g, ' ').trim();
    if (!name) return;
    if (/开始阅读|上一话|下一话|返回/.test(name)) return;
    if (seen[m[1]]) return;
    seen[m[1]] = 1;
    out.push({ name: name, url: href });
  });
  return out;
})()`;

const tencentComic = rule({
  name: '腾讯动漫',
  host: 'https://ac.qq.com',
  contentType: CONTENT_TYPE.MANGA,
  icon: 'https://ac.qq.com/favicon.ico',
  enableSearch: false,
  enableDiscover: true,
  // 站内真实可用的只有「排序 + 题材」两种参数：sort 为 time/hot，theme 取 tagList 里的 id
  discoverUrl: [
    '最近更新::/Comic/all/search/time?page=$page',
    '人气::/Comic/all/search/hot?page=$page',
    '恋爱::/Comic/all/search/time?theme=105&page=$page',
    '玄幻::/Comic/all/search/time?theme=101&page=$page',
    '动作::/Comic/all/search/time?theme=109&page=$page',
    '悬疑::/Comic/all/search/time?theme=112&page=$page'
  ].join('\n'),
  discoverList: AC_LIST,
  discoverName: '$.name',
  discoverCover: '$.cover',
  discoverResult: '$.url',
  chapterUrl: '$result',
  chapterList: AC_CHAPTERS,
  chapterName: '$.name',
  chapterResult: '$.url',
  contentUrl: 'null',
  contentItems: '@js:[String(lastResult || \'\')]'
});

// ============================================================
// 9. 拷贝漫画（JSON 接口；本机网络被墙，规则按公开 v3 API 写，需在国内网络验证）
// ============================================================

const CM_SEARCH_LIST = String.raw`@js:(() => {
  let j = null;
  try { j = JSON.parse(String(result || '')); } catch (e) { return []; }
  const list = (j.results && j.results.list) || [];
  return list.map((x) => ({
    name: String(x.name || ''),
    cover: String(x.cover || ''),
    author: (x.author || []).map((a) => a.name).filter(Boolean).join(' / '),
    chapter: (x.theme ? '' : '') + ((x.status || 0) === 1 ? '连载中' : '已完结'),
    url: String(x.path_word || '')
  })).filter((x) => x.name && x.url);
})()`;

const CM_CHAPTERS = String.raw`@js:(() => {
  let j = null;
  try { j = JSON.parse(String(result || '')); } catch (e) { return []; }
  const path = String(lastResult || '');
  const groups = (j.results && j.results.groups) || {};
  const out = [];
  Object.keys(groups).forEach((k) => {
    const chs = (groups[k] || {}).chapters || [];
    chs.forEach((c) => {
      out.push({ name: String(c.name || ''), url: path + '|' + String(c.uuid || c.id || '') });
    });
  });
  return out;
})()`;

const CM_CONTENT = String.raw`@js:(async () => {
  const parts = String(lastResult || '').split('|');
  const path = parts[0];
  const uuid = parts[1];
  if (!path || !uuid) return [String(lastResult || '')];
  const url = 'https://api.copymanga.tv/api/v3/comic/' + path + '/chapter2/' + uuid + '?platform=3';
  let j = null;
  try { j = JSON.parse(String(await http(JSON.stringify({ url: url, headers: { Referer: 'https://www.copymanga.tv/' } })))); } catch (e) { return []; }
  const contents = ((j.results || {}).chapter || {}).contents || [];
  return contents.map((c) => String(c.url || '')).filter(Boolean);
})()`;

const copymanga = rule({
  name: '拷贝漫画',
  host: 'https://api.copymanga.tv',
  contentType: CONTENT_TYPE.MANGA,
  enableSearch: true,
  searchUrl: 'https://api.copymanga.tv/api/v3/search/comic?q=$keyword&limit=20&offset=0&platform=3',
  searchList: CM_SEARCH_LIST,
  searchName: '$.name',
  searchCover: '$.cover',
  searchAuthor: '$.author',
  searchChapter: '$.chapter',
  searchResult: '$.url',
  enableDiscover: false,
  chapterUrl: 'https://api.copymanga.tv/api/v3/comic2/$result?platform=3',
  chapterList: CM_CHAPTERS,
  chapterName: '$.name',
  chapterResult: '$.url',
  contentUrl: 'null',
  contentItems: CM_CONTENT
});

const rules = [agedm, yinghuabb, tencent, iqiyi, bilibili, bilibiliVideo, bzmgcn, bilibiliManga, tencentComic, copymanga];

const outFile = path.resolve(import.meta.dirname, '../rules/aggregate.json');

// 保留 build-cms-rules.ts 追加进来的资源站规则，别被这里覆盖掉
let extra = [];
try {
  const old = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  extra = old.filter((r) => (r.group || '').startsWith('资源站'));
} catch {
  /* 首次生成 */
}

fs.writeFileSync(outFile, JSON.stringify([...rules, ...extra], null, 2));
console.log(`生成 ${rules.length} 条规则（+${extra.length} 条资源站）-> ${outFile}`);
for (const r of rules) console.log(` - ${r.name} (${r.host})`);
