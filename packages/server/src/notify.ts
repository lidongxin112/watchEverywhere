import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { JsonStore } from './store';
import { pushLog } from './logs';

/**
 * 消息推送（追番更新提醒）
 *
 * 支持：Bark、企业微信群机器人、飞书机器人、钉钉机器人、通用 Webhook（POST JSON）
 * 单独存储，不放在 config 里，避免通过 config/read 把推送地址（含密钥）一起返回。
 */

export type ChannelType = 'bark' | 'wecom' | 'feishu' | 'dingtalk' | 'webhook';

export interface NotifyChannel {
  id: string;
  type: ChannelType;
  name: string;
  url: string;
  enabled: boolean;
}

export interface NotifyConfig {
  channels: NotifyChannel[];
  /** 追更检查间隔（分钟） */
  watchInterval: number;
}

export const notifyStore = new JsonStore<NotifyConfig>('notify', { channels: [], watchInterval: 60 });

export const MIN_INTERVAL = 15;

export function getNotifyConfig(): NotifyConfig {
  const v = notifyStore.value;
  return {
    channels: Array.isArray(v.channels) ? v.channels : [],
    watchInterval: Math.max(MIN_INTERVAL, Number(v.watchInterval) || 60)
  };
}

export function saveNotifyConfig(input: Partial<NotifyConfig>): NotifyConfig {
  const cur = getNotifyConfig();
  const channels = Array.isArray(input.channels)
    ? input.channels
        .filter((c) => c && /^https?:\/\//i.test(String(c.url || '').trim()))
        .map((c) => ({
          id: c.id || randomUUID(),
          type: (['bark', 'wecom', 'feishu', 'dingtalk', 'webhook'].includes(c.type) ? c.type : 'webhook') as ChannelType,
          name: String(c.name || '').trim(),
          url: String(c.url).trim(),
          enabled: c.enabled !== false
        }))
    : cur.channels;
  const next: NotifyConfig = {
    channels,
    watchInterval: Math.max(MIN_INTERVAL, Number(input.watchInterval ?? cur.watchInterval) || 60)
  };
  notifyStore.set(next);
  return next;
}

export interface NotifyMessage {
  title: string;
  body: string;
  /** 点击跳转（Bark 支持） */
  url?: string;
  /** 结构化数据（通用 Webhook 会原样带上） */
  data?: unknown;
}

/** 按渠道类型拼请求体 */
export function buildPayload(type: ChannelType, msg: NotifyMessage): Record<string, unknown> {
  // 钉钉 / 企业微信可能开了关键字校验，统一带上项目名
  const text = `【watchEverywhere】${msg.title}\n${msg.body}`;
  switch (type) {
    case 'bark':
      return { title: msg.title, body: msg.body, group: 'watchEverywhere', ...(msg.url ? { url: msg.url } : {}) };
    case 'wecom':
      return { msgtype: 'text', text: { content: text } };
    case 'dingtalk':
      return { msgtype: 'text', text: { content: text } };
    case 'feishu':
      return { msg_type: 'text', content: { text } };
    default:
      return { title: msg.title, body: msg.body, url: msg.url, data: msg.data, source: 'watchEverywhere', time: Date.now() };
  }
}

export async function sendTo(channel: NotifyChannel, msg: NotifyMessage): Promise<void> {
  const res = await axios.post(channel.url, buildPayload(channel.type, msg), {
    timeout: 10000,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    validateStatus: () => true
  });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  // 飞书 / 钉钉 / 企业微信：HTTP 200 但 body 里带错误码
  const d: any = res.data;
  const code = d?.errcode ?? d?.code ?? d?.StatusCode;
  if (code !== undefined && code !== 0 && code !== 200) throw new Error(d?.errmsg || d?.msg || d?.message || `错误码 ${code}`);
}

/** 发给所有启用的渠道；单个失败不影响其他 */
export async function notifyAll(msg: NotifyMessage): Promise<{ ok: number; fail: number }> {
  const channels = getNotifyConfig().channels.filter((c) => c.enabled);
  let ok = 0;
  let fail = 0;
  await Promise.all(
    channels.map(async (c) => {
      try {
        await sendTo(c, msg);
        ok++;
      } catch (e: any) {
        fail++;
        pushLog('warn', 'notify', `推送到「${c.name || c.type}」失败：${e?.message || e}`);
      }
    })
  );
  return { ok, fail };
}
