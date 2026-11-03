import { message } from 'ant-design-vue';

export interface ApiResult<T = any> {
  code: number;
  data: T;
  msg: string;
}

const BASE_URL = (import.meta.env.VITE_API_BASE as string) || '/api';

/**
 * 所有接口均为 POST + JSON
 * @param showMsg 失败时是否弹出提示
 */
export async function request<T = any>(url: string, data: any = {}, showMsg = true, signal?: AbortSignal): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${BASE_URL}/${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data ?? {}),
      signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as ApiResult<T>;
    if (json.code !== 0 && showMsg && json.msg) message.error(json.msg);
    return json;
  } catch (err: any) {
    if (err?.name === 'AbortError') return { code: -2, data: null as T, msg: '已取消' };
    const msg = `服务请求失败：${err?.message || err}`;
    if (showMsg) message.error(msg);
    return { code: -1, data: null as T, msg };
  }
}
