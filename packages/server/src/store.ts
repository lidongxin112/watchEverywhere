import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** 数据目录：~/.watch-everywhere（可用 WE_DATA_DIR 覆盖） */
export const DATA_DIR = process.env.WE_DATA_DIR || path.join(os.homedir(), '.watch-everywhere');

/**
 * 极简 JSON 文件存储（替代原项目的 sqlite/typeorm，免去原生依赖编译）
 * 写入做了防抖与原子替换。
 */
export class JsonStore<T> {
  private file: string;
  private data: T;
  private timer: NodeJS.Timeout | null = null;

  constructor(name: string, defaults: T) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    this.file = path.join(DATA_DIR, `${name}.json`);
    this.data = defaults;
    try {
      if (fs.existsSync(this.file)) this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (e) {
      console.warn(`[store] 读取 ${this.file} 失败，使用默认值`, e);
    }
  }

  get value(): T {
    return this.data;
  }

  set(data: T) {
    this.data = data;
    this.save();
  }

  /** 修改后调用以持久化 */
  save() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 200);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

/** 带过期时间的内存缓存 */
export class MemoryCache {
  private map = new Map<string, { value: any; expire: number }>();

  get<T = any>(key: string): T | undefined {
    const row = this.map.get(key);
    if (!row) return undefined;
    if (row.expire && row.expire < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return row.value;
  }

  set(key: string, value: any, ttl = 0) {
    this.map.set(key, { value, expire: ttl ? Date.now() + ttl : 0 });
    if (this.map.size > 2000) this.map.delete(this.map.keys().next().value!);
  }

  delete(key: string) {
    this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }
}
