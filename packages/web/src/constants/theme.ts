/** 预置配色（沿用 any-reader 的三套主题，并新增一套蓝色） */
export interface ThemeTokens {
  colorPrimary: string;
  leftBarBg: string;
  leftBarText: string;
  leftBarBgSecondary: string;
  leftBarActiveBgSecondary: string;
  topBarBg: string;
  topBarText: string;
  topBarBorder: string;
  cmdBg: string;
  cmdBorder: string;
  mainBackground: string;
  cardBg: string;
  colorPrimaryBg: string;
  colorText: string;
  colorTextSecondary: string;
  chapterBg: string;
  readBg: string;
  readText: string;
}

export interface ThemeDef {
  label: string;
  dark: boolean;
  swatch: string;
  tokens: ThemeTokens;
}

export const THEMES: ThemeDef[] = [
  {
    label: '默认黑',
    dark: true,
    swatch: '#181818',
    tokens: {
      colorPrimary: '#40b883',
      leftBarBg: '#1f1f1f',
      leftBarText: '#ffffffb3',
      leftBarBgSecondary: '#181818',
      leftBarActiveBgSecondary: '#262626',
      topBarBg: '#1f1f1f',
      topBarText: '#ffffffb3',
      topBarBorder: '#2b2b2b',
      cmdBg: '#ffffff0d',
      cmdBorder: '#303030',
      mainBackground: '#181818',
      cardBg: '#1f1f1f',
      colorPrimaryBg: '#40b8831f',
      colorText: 'rgba(255,255,255,0.85)',
      colorTextSecondary: 'rgba(255,255,255,0.55)',
      chapterBg: '#1f1f1f',
      readBg: '#181818',
      readText: '#b3b3b3'
    }
  },
  {
    label: '杏仁黄',
    dark: false,
    swatch: '#FAF9DE',
    tokens: {
      colorPrimary: '#a39a48',
      leftBarBg: '#A39A48',
      leftBarText: '#000000d9',
      leftBarBgSecondary: '#CFCA8A',
      leftBarActiveBgSecondary: '#FCFFE8',
      topBarBg: '#A39A48',
      topBarText: '#000000d9',
      topBarBorder: '#0000001a',
      cmdBg: '#B5B061',
      cmdBorder: '#B5B061',
      mainBackground: '#f6f6f6',
      cardBg: '#ffffff',
      colorPrimaryBg: '#FAF9DE',
      colorText: 'rgba(0,0,0,0.85)',
      colorTextSecondary: 'rgba(0,0,0,0.55)',
      chapterBg: '#ffffff',
      readBg: '#FAF9DE',
      readText: '#000000d9'
    }
  },
  {
    label: '青草绿',
    dark: false,
    swatch: '#E3EDCD',
    tokens: {
      colorPrimary: '#7f9a4a',
      leftBarBg: '#ADC580',
      leftBarText: '#000000d9',
      leftBarBgSecondary: '#E3EDCD',
      leftBarActiveBgSecondary: '#FCFFE8',
      topBarBg: '#ADC580',
      topBarText: '#000000d9',
      topBarBorder: '#0000001a',
      cmdBg: '#BED192',
      cmdBorder: '#BED192',
      mainBackground: '#f6f6f6',
      cardBg: '#ffffff',
      colorPrimaryBg: '#E3EDCD',
      colorText: 'rgba(0,0,0,0.85)',
      colorTextSecondary: 'rgba(0,0,0,0.55)',
      chapterBg: '#ffffff',
      readBg: '#E3EDCD',
      readText: '#000000d9'
    }
  },
  {
    label: '海天蓝',
    dark: false,
    swatch: '#DCE2F1',
    tokens: {
      colorPrimary: '#4a6fbf',
      leftBarBg: '#8fa3d1',
      leftBarText: '#000000d9',
      leftBarBgSecondary: '#DCE2F1',
      leftBarActiveBgSecondary: '#f3f6fd',
      topBarBg: '#8fa3d1',
      topBarText: '#000000d9',
      topBarBorder: '#0000001a',
      cmdBg: '#a5b6dc',
      cmdBorder: '#a5b6dc',
      mainBackground: '#f5f7fb',
      cardBg: '#ffffff',
      colorPrimaryBg: '#DCE2F1',
      colorText: 'rgba(0,0,0,0.85)',
      colorTextSecondary: 'rgba(0,0,0,0.55)',
      chapterBg: '#ffffff',
      readBg: '#DCE2F1',
      readText: '#000000d9'
    }
  }
];
