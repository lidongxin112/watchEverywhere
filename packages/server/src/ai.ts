import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';
import type Router from '@koa/router';
import { RuleManager } from '@watch-everywhere/core';
import { JsonStore, MemoryCache } from './store';
import { rulesStore } from './db';
import { pushLog } from './logs';

/**
 * AI 问片（参考 MoonTVPlus）
 *
 * - 接任意 OpenAI 兼容接口（OpenAI / DeepSeek / 通义千问 / Kimi / 智谱 / 硅基流动 / 本地 Ollama …）
 * - 对话时 AI 可以调用 search_media，在「用户自己添加的规则」里搜可播放的资源，结果作为卡片返回前端
 * - 详情页可以生成 AI 影评
 * - API Key 只存在服务端（单独的 ai.json），任何接口都不会把它原样返回
 */

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const aiStore = new JsonStore<AiConfig>('ai', { baseUrl: '', apiKey: '', model: '' });

const reviewCache = new MemoryCache();
const md5 = (s: string) => createHash('md5').update(s).digest('hex');

export function maskKey(key: string) {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 3)}****${key.slice(-4)}`;
}

function cfg(): AiConfig {
  const v = aiStore.value || ({} as AiConfig);
  return { baseUrl: String(v.baseUrl || '').trim().replace(/\/+$/, ''), apiKey: String(v.apiKey || '').trim(), model: String(v.model || '').trim() };
}

function ensureReady(c = cfg()) {
  if (!c.baseUrl || !c.model) throw new Error('还没有配置 AI：请在「AI 问片」页面右上角的设置里填写接口地址和模型');
  return c;
}

const TYPE_MAP: Record<string, number> = { video: 2, novel: 1, manga: 0, audio: 3 };
const TYPE_NAME: Record<number, string> = { 0: '漫画', 1: '小说', 2: '视频', 3: '音频' };

export interface MediaHit {
  ruleId: string;
  rule: string;
  contentType: number;
  name: string;
  url: string;
  cover?: string;
  author?: string;
  chapter?: string;
  description?: string;
}

/** 在用户添加的规则里搜索（每个规则 8 秒超时，最多 30 条） */
/** 测试可替换的实现（真实环境用默认的跨规则搜索） */
let searchImpl: (keyword: string, type?: string) => Promise<MediaHit[]> = (kw, type) => searchMediaDefault(kw, type);

export function __setSearchImpl(fn: ((keyword: string, type?: string) => Promise<MediaHit[]>) | null) {
  searchImpl = fn || ((kw, type) => searchMediaDefault(kw, type));
}

export async function searchMedia(keyword: string, type?: string): Promise<MediaHit[]> {
  return searchImpl(keyword, type);
}

async function searchMediaDefault(keyword: string, type?: string): Promise<MediaHit[]> {
  const kw = String(keyword || '').trim();
  if (!kw) return [];
  const ct = type && type in TYPE_MAP ? TYPE_MAP[type] : undefined;
  const rules = rulesStore.value.filter((r) => r.enableSearch && r.searchUrl && (ct === undefined || r.contentType === ct)).slice(0, 40);
  const hits: MediaHit[] = [];
  let i = 0;
  const worker = async () => {
    while (i < rules.length) {
      const r = rules[i++];
      try {
        const list = await Promise.race([
          new RuleManager(r).search(kw, 1),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
        ]);
        for (const e of list.slice(0, 3))
          hits.push({
            ruleId: r.id,
            rule: r.name,
            contentType: r.contentType,
            name: e.name,
            url: e.url,
            cover: e.cover,
            author: e.author,
            chapter: e.chapter,
            description: (e.description || '').slice(0, 120)
          });
      } catch {
        /* 单个规则失败不影响 */
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  // 名字完全匹配的排前面
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const k = norm(kw);
  hits.sort((a, b) => Number(norm(b.name) === k) - Number(norm(a.name) === k) || Number(norm(b.name).includes(k)) - Number(norm(a.name).includes(k)));
  return hits.slice(0, 30);
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_media',
      description:
        '在用户已添加的资源规则里搜索可以观看/阅读的作品。用户想看某部作品、询问哪里能看，或你推荐了具体作品时调用。每次只搜一个作品名，不要加年份和多余的词。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '作品名，例如「三体」「葬送的芙莉莲」' },
          type: { type: 'string', enum: ['video', 'novel', 'manga', 'audio'], description: '内容类型，默认 video' }
        },
        required: ['keyword']
      }
    }
  }
];

function systemPrompt() {
  const today = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const types = [...new Set(rulesStore.value.filter((r) => r.enableSearch).map((r) => TYPE_NAME[r.contentType]).filter(Boolean))];
  return [
    '你是 watchEverywhere 内置的影视助手「AI 问片」，用中文回答，简洁、友好。',
    `今天是 ${today}。`,
    '你可以：根据喜好推荐影视 / 动漫 / 小说，介绍剧情、演员、导演、上映年份、评价和看点，帮用户找片。',
    `用户已添加的资源类型：${types.join('、') || '暂无'}。当用户想看某部作品、问哪里能看，或你推荐了具体作品时，调用 search_media 在用户的资源里查找；推荐多部时挑最相关的 1~3 部去搜。`,
    '搜索结果会以卡片形式直接展示给用户，你不需要列出链接，只需说明在哪些来源找到了、建议看哪个；没搜到就如实说，建议换个名字或添加规则。',
    '绝不编造播放链接或下载地址；不确定的信息要说明不确定，不要剧透关键情节，除非用户要求。'
  ].join('\n');
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
}

async function chatRequest(c: AiConfig, body: any, signal?: AbortSignal) {
  const res = await fetch(`${c.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}) },
    body: JSON.stringify({ model: c.model, ...body }),
    signal
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    const err: any = new Error(`AI 接口返回 ${res.status}：${text || res.statusText}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return res;
}

/** 解析 OpenAI 流式响应：逐段回调文本，最后返回完整文本和工具调用 */
export async function readStream(res: Response, onText: (t: string) => void) {
  const decoder = new TextDecoder();
  let buf = '';
  let content = '';
  const calls: { id: string; name: string; args: string }[] = [];
  const handle = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let json: any;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const delta = json?.choices?.[0]?.delta || json?.choices?.[0]?.message || {};
    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content;
      onText(delta.content);
    }
    for (const tc of delta.tool_calls || []) {
      const idx = Number(tc.index ?? calls.length);
      calls[idx] = calls[idx] || { id: '', name: '', args: '' };
      if (tc.id) calls[idx].id = tc.id;
      if (tc.function?.name) calls[idx].name += tc.function.name;
      if (tc.function?.arguments) calls[idx].args += tc.function.arguments;
    }
  };
  for await (const chunk of res.body as any) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      handle(buf.slice(0, i).trim());
      buf = buf.slice(i + 1);
    }
  }
  if (buf.trim()) handle(buf.trim());
  return { content, calls: calls.filter(Boolean) };
}

export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; keyword: string; contentType?: string; results: MediaHit[] }
  | { type: 'error'; message: string }
  | { type: 'done' };

/** 对话主流程：流式输出，遇到工具调用就执行后继续，最多 4 轮 */
export async function runChat(history: { role: string; content: string }[], emit: (e: ChatEvent) => void, signal?: AbortSignal) {
  const c = ensureReady();
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt() },
    ...history
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-20)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, 4000) }))
  ];
  let useTools = true;
  for (let round = 0; round < 4; round++) {
    let res: Response;
    try {
      res = await chatRequest(c, { messages, stream: true, temperature: 0.7, ...(useTools ? { tools: TOOLS, tool_choice: 'auto' } : {}) }, signal);
    } catch (e: any) {
      // 有的模型 / 服务不支持工具调用：去掉工具重试一次
      if (useTools && e?.status && e.status < 500 && /tool|function/i.test(e.body || e.message)) {
        useTools = false;
        round--;
        continue;
      }
      throw e;
    }
    const { content, calls } = await readStream(res, (t) => emit({ type: 'delta', text: t }));
    if (!calls.length) return;

    messages.push({
      role: 'assistant',
      content: content || null,
      tool_calls: calls.map((t, i) => ({ id: t.id || `call_${round}_${i}`, type: 'function', function: { name: t.name, arguments: t.args || '{}' } }))
    });
    for (let i = 0; i < calls.length; i++) {
      const t = calls[i];
      let args: any = {};
      try {
        args = JSON.parse(t.args || '{}');
      } catch {
        /* ignore */
      }
      let result: any;
      if (t.name === 'search_media') {
        const hits = await searchMedia(args.keyword, args.type);
        emit({ type: 'tool', keyword: String(args.keyword || ''), contentType: args.type, results: hits });
        // 只给模型看精简信息，节省 token
        result = hits.length
          ? hits.slice(0, 12).map((h) => ({ 来源: h.rule, 名称: h.name, 备注: h.chapter, 作者: h.author }))
          : `在用户的资源里没有搜到「${args.keyword}」`;
      } else {
        result = `未知工具 ${t.name}`;
      }
      messages.push({ role: 'tool', tool_call_id: t.id || `call_${round}_${i}`, content: typeof result === 'string' ? result : JSON.stringify(result) });
    }
  }
}

async function complete(prompt: string, maxTokens = 600) {
  const c = ensureReady();
  const res = await chatRequest(c, { messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: maxTokens });
  const json: any = await res.json();
  const text = json?.choices?.[0]?.message?.content;
  if (!text) throw new Error('AI 没有返回内容');
  return String(text).trim();
}

export const aiRoutes = {
  'ai/config/read': () => {
    const c = cfg();
    return { baseUrl: c.baseUrl, model: c.model, hasKey: !!c.apiKey, keyPreview: maskKey(c.apiKey) };
  },

  /** apiKey 留空表示不修改；clearKey 为 true 时清除 */
  'ai/config/save': (data: { baseUrl?: string; model?: string; apiKey?: string; clearKey?: boolean }) => {
    const cur = cfg();
    const baseUrl = String(data.baseUrl ?? cur.baseUrl).trim().replace(/\/+$/, '');
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) throw new Error('接口地址需要以 http(s):// 开头');
    const apiKey = data.clearKey ? '' : String(data.apiKey || '').trim() || cur.apiKey;
    aiStore.set({ baseUrl, model: String(data.model ?? cur.model).trim(), apiKey });
    reviewCache.clear();
    return { baseUrl, model: aiStore.value.model, hasKey: !!apiKey, keyPreview: maskKey(apiKey) };
  },

  'ai/test': async () => {
    const text = await complete('请只回复两个字：成功', 20);
    return { reply: text.slice(0, 50), model: cfg().model };
  },

  /** AI 影评（同一作品缓存 7 天） */
  'ai/review': async ({ name, description, author, force }: { name: string; description?: string; author?: string; force?: boolean }) => {
    const title = String(name || '').trim();
    if (!title) throw new Error('缺少作品名');
    const key = md5(`${cfg().model}|${title}|${description || ''}`);
    if (!force) {
      const hit = reviewCache.get<string>(key);
      if (hit) return { text: hit, cached: true };
    }
    const prompt = [
      `请为作品《${title}》写一段 150~250 字的中文短评。`,
      author ? `作者 / 主创：${author}。` : '',
      description ? `简介：${String(description).slice(0, 600)}` : '',
      '内容包括：整体评价、主要看点、适合什么样的观众；不要剧透关键情节。',
      '如果你并不了解这部作品，就只根据简介谨慎点评，并在开头说明「以下基于简介」。直接输出评论正文，不要标题。'
    ]
      .filter(Boolean)
      .join('\n');
    const text = await complete(prompt);
    reviewCache.set(key, text, 7 * 24 * 3600 * 1000);
    return { text, cached: false };
  }
};

/** 流式对话：POST /api/ai/chat，返回 text/event-stream */
export function registerAiStream(router: Router) {
  router.post('/ai/chat', async (ctx) => {
    const body = (ctx.request as any).body || {};
    const history = Array.isArray(body.messages) ? body.messages : [];
    const stream = new PassThrough();
    const controller = new AbortController();
    ctx.status = 200;
    ctx.set('Content-Type', 'text/event-stream; charset=utf-8');
    ctx.set('Cache-Control', 'no-cache');
    ctx.set('Connection', 'keep-alive');
    ctx.set('X-Accel-Buffering', 'no');
    ctx.body = stream;
    let closed = false;
    ctx.res.on('close', () => {
      closed = true;
      controller.abort();
    });
    const emit = (e: ChatEvent) => {
      if (!closed) stream.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    runChat(history, emit, controller.signal)
      .catch((e: any) => {
        if (controller.signal.aborted) return;
        const msg = e?.name === 'AbortError' ? '已停止' : e?.cause?.code === 'ECONNREFUSED' ? '连不上 AI 接口，请检查接口地址' : e?.message || String(e);
        pushLog('warn', 'ai/chat', msg);
        emit({ type: 'error', message: msg });
      })
      .finally(() => {
        emit({ type: 'done' });
        stream.end();
      });
  });
}
