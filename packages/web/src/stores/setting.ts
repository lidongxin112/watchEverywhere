import { defineStore } from 'pinia';
import { computed, reactive, watch } from 'vue';
import { THEMES } from '@/constants/theme';
import { readStorage, writeStorage } from '@/utils/storage';

export interface ReadStyle {
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  sectionSpacing: number;
  /** 正文宽度上限(px) */
  maxWidth: number;
  /** 为空则跟随主题 */
  textColor: string;
  backgroundColor: string;
}

export interface PlayerSetting {
  /** 自动播放下一集 */
  autoNext: boolean;
  /** 记住播放进度 */
  resume: boolean;
  playbackRate: number;
  /** 音量（0~1） */
  volume?: number;
  /** 跳过片头（秒，0 表示不跳） */
  skipIntro?: number;
  /** 跳过片尾（秒，0 表示不跳） */
  skipOutro?: number;
}

export interface SettingData {
  theme: number;
  readStyle: ReadStyle;
  player: PlayerSetting;
}

const DEFAULTS: SettingData = {
  theme: 0,
  readStyle: {
    fontSize: 18,
    lineHeight: 1.8,
    letterSpacing: 0,
    sectionSpacing: 12,
    maxWidth: 860,
    textColor: '',
    backgroundColor: ''
  },
  player: {
    autoNext: true,
    resume: true,
    playbackRate: 1,
    volume: 1,
    skipIntro: 0,
    skipOutro: 0
  }
};

export const useSettingStore = defineStore('setting', () => {
  const saved = readStorage<Partial<SettingData>>('we-setting', {});
  const data = reactive<SettingData>({
    theme: saved.theme ?? DEFAULTS.theme,
    readStyle: { ...DEFAULTS.readStyle, ...(saved.readStyle || {}) },
    player: { ...DEFAULTS.player, ...(saved.player || {}) }
  });

  watch(data, (v) => writeStorage('we-setting', v), { deep: true });

  const theme = computed(() => THEMES[data.theme] || THEMES[0]);

  function resetReadStyle() {
    Object.assign(data.readStyle, DEFAULTS.readStyle);
  }

  return { data, theme, resetReadStyle };
});
