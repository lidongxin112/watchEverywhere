/**
 * 外部播放器跳转（参考 MoonTVPlus）
 * 各播放器注册的 URL Scheme 不同，这里统一生成。
 */

export interface ExternalPlayer {
  key: string;
  name: string;
  /** 适用平台说明 */
  platform: string;
  build: (url: string, title: string) => string;
}

export const EXTERNAL_PLAYERS: ExternalPlayer[] = [
  { key: 'potplayer', name: 'PotPlayer', platform: 'Windows', build: (u) => `potplayer://${u}` },
  { key: 'vlc', name: 'VLC', platform: '全平台', build: (u) => `vlc://${u}` },
  { key: 'iina', name: 'IINA', platform: 'macOS', build: (u) => `iina://weblink?url=${encodeURIComponent(u)}` },
  { key: 'mpv', name: 'MPV', platform: '需安装 mpv-handler', build: (u) => `mpv://${u}` },
  { key: 'infuse', name: 'Infuse', platform: 'iOS / macOS', build: (u) => `infuse://x-callback-url/play?url=${encodeURIComponent(u)}` },
  { key: 'nplayer', name: 'nPlayer', platform: 'iOS / Android', build: (u) => `nplayer-${u}` },
  {
    key: 'mx',
    name: 'MX Player',
    platform: 'Android',
    build: (u, t) => `intent:${u}#Intent;package=com.mxtech.videoplayer.ad;S.title=${encodeURIComponent(t)};end`
  }
];

/** 相对地址（例如 /api/media/proxy?...）补全为外部播放器能访问的绝对地址 */
export function absoluteUrl(url: string) {
  try {
    return new URL(url, location.href).href;
  } catch {
    return url;
  }
}

/** 外部播放器打开 localhost 地址时，只有同一台设备上能播 */
export function isLocalOnly(url: string) {
  try {
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url, location.href).hostname);
  } catch {
    return false;
  }
}

export function openExternal(player: ExternalPlayer, url: string, title = '') {
  const target = player.build(absoluteUrl(url), title);
  const a = document.createElement('a');
  a.href = target;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
