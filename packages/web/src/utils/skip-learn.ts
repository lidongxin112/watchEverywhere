/**
 * 片头片尾自动识别（学习用户行为，不做音频分析）
 *
 * - 每条规则单独记一份：用户每次实际从第几秒开始看、在第几秒点下一集
 * - 样本够 3 个就取中位数，作为“建议值”，确认后写入该规则的默认片头/片尾
 * - 比“分析黑帧/音量”稳，代价是要看两三集才有建议
 */

export interface SkipSamples {
  intro: number[];
  outro: number[];
}

export interface SkipConfig {
  /** 已确认的片头秒数（0 表示不跳） */
  intro: number;
  /** 已确认的片尾秒数 */
  outro: number;
}

const SAMPLE_KEY = (ruleId: string) => `we-skip-samples:${ruleId}`;
const CONFIG_KEY = (ruleId: string) => `we-skip-config:${ruleId}`;
const MAX_SAMPLES = 5;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function loadSamples(ruleId: string): SkipSamples {
  const row = readJson<SkipSamples>(SAMPLE_KEY(ruleId), { intro: [], outro: [] });
  return { intro: Array.isArray(row.intro) ? row.intro : [], outro: Array.isArray(row.outro) ? row.outro : [] };
}

export function loadSkipConfig(ruleId: string): SkipConfig {
  return readJson<SkipConfig>(CONFIG_KEY(ruleId), { intro: 0, outro: 0 });
}

export function saveSkipConfig(ruleId: string, config: SkipConfig) {
  writeJson(CONFIG_KEY(ruleId), config);
}

/** 中位数，样本少的时候比平均值抗噪 */
export function median(list: number[]): number {
  if (!list.length) return 0;
  const arr = [...list].sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
}

/** 记录一次“用户手动跳过片头”：只在开头 10% 内的跳转算样本 */
export function recordIntroSample(ruleId: string, duration: number, seekTo: number): number[] {
  if (!duration || duration < 240) return [];
  if (seekTo < 3 || seekTo > Math.min(300, duration * 0.1)) return [];
  const samples = loadSamples(ruleId);
  samples.intro = [...samples.intro, Math.round(seekTo)].slice(-MAX_SAMPLES);
  writeJson(SAMPLE_KEY(ruleId), samples);
  return samples.intro;
}

/** 记录一次“用户手动跳过片尾”：在结尾 25% 内点下一集算样本 */
export function recordOutroSample(ruleId: string, duration: number, currentTime: number): number[] {
  if (!duration || duration < 240) return [];
  const remain = duration - currentTime;
  if (remain < 5 || remain > Math.min(300, duration * 0.25)) return [];
  const samples = loadSamples(ruleId);
  samples.outro = [...samples.outro, Math.round(remain)].slice(-MAX_SAMPLES);
  writeJson(SAMPLE_KEY(ruleId), samples);
  return samples.outro;
}

/** 样本 ≥3 才给建议 */
export function suggestSkip(ruleId: string): { intro?: number; outro?: number } {
  const samples = loadSamples(ruleId);
  const config = loadSkipConfig(ruleId);
  const out: { intro?: number; outro?: number } = {};
  if (samples.intro.length >= 3 && !config.intro) out.intro = median(samples.intro);
  if (samples.outro.length >= 3 && !config.outro) out.outro = median(samples.outro);
  return out;
}
