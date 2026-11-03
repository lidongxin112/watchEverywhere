<template>
  <div class="live-player">
    <video ref="videoRef" class="live-player__video" controls autoplay playsinline @playing="onPlaying" @error="onNativeError"></video>
    <div v-if="waiting" class="live-player__tip"><a-spin /> <span>正在连接...</span></div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type Hls from 'hls.js';
import type { StreamKind } from '@/api';

const props = defineProps<{ src: string; kind: StreamKind }>();
const emit = defineEmits<{ error: [string]; playing: [] }>();

const videoRef = ref<HTMLVideoElement>();
const waiting = ref(false);
let hls: Hls | null = null;
let mpegtsPlayer: any = null;
let timer: number | undefined;
/** 每次切换地址递增，丢弃过期回调 */
let seq = 0;
/** 是否直接用 <video src> 播放（只有这种情况才关心原生 error 事件） */
let native = false;

function destroy() {
  window.clearTimeout(timer);
  native = false;
  hls?.destroy();
  hls = null;
  if (mpegtsPlayer) {
    try {
      mpegtsPlayer.pause();
      mpegtsPlayer.unload();
      mpegtsPlayer.detachMediaElement();
      mpegtsPlayer.destroy();
    } catch {
      /* ignore */
    }
    mpegtsPlayer = null;
  }
  const v = videoRef.value;
  if (v) {
    v.removeAttribute('src');
    v.load();
  }
}

function fail(my: number, msg: string) {
  if (my !== seq) return;
  waiting.value = false;
  window.clearTimeout(timer);
  emit('error', msg);
}

async function load() {
  const my = ++seq;
  destroy();
  const video = videoRef.value;
  if (!video || !props.src) return;
  waiting.value = true;
  // 长时间没有画面视为失败（交给上层换代理 / 换线路）
  timer = window.setTimeout(() => fail(my, '连接超时'), 20000);

  const kind = props.kind;
  if (kind === 'hls') {
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      native = true;
      video.src = props.src;
    } else {
      const { default: HlsLib } = await import('hls.js');
      if (my !== seq) return;
      if (!HlsLib.isSupported()) return fail(my, '当前浏览器不支持 HLS 播放');
      let recovered = false;
      hls = new HlsLib({ liveSyncDurationCount: 3, manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 2, fragLoadingMaxRetry: 3 });
      hls.on(HlsLib.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === HlsLib.ErrorTypes.MEDIA_ERROR && !recovered) {
          recovered = true;
          hls?.recoverMediaError();
          return;
        }
        const code = (data.response as any)?.code;
        fail(my, data.type === HlsLib.ErrorTypes.NETWORK_ERROR ? `网络错误${code ? `（${code}）` : ''}` : `播放错误：${data.details}`);
      });
      hls.loadSource(props.src);
      hls.attachMedia(video);
    }
  } else if (kind === 'flv' || kind === 'ts') {
    const { default: mpegts } = await import('mpegts.js');
    if (my !== seq) return;
    if (!mpegts.getFeatureList().mseLivePlayback) return fail(my, '当前浏览器不支持 FLV / TS 直播播放');
    mpegtsPlayer = mpegts.createPlayer(
      { type: kind === 'flv' ? 'flv' : 'mpegts', isLive: true, url: props.src },
      { enableWorker: true, liveBufferLatencyChasing: true, autoCleanupSourceBuffer: true }
    );
    mpegtsPlayer.on(mpegts.Events.ERROR, (type: string, detail: string) => fail(my, `播放错误：${type} ${detail || ''}`));
    mpegtsPlayer.attachMediaElement(video);
    mpegtsPlayer.load();
  } else {
    native = true;
    video.src = props.src;
  }
  video.play().catch((e) => {
    // 自动播放被浏览器拦截：不算失败，等用户点击播放
    if (e?.name === 'NotAllowedError' && my === seq) {
      window.clearTimeout(timer);
      waiting.value = false;
    }
  });
}

function onPlaying() {
  waiting.value = false;
  window.clearTimeout(timer);
  emit('playing');
}

function onNativeError() {
  if (!native || !props.src || !videoRef.value?.error) return;
  fail(seq, '无法播放该地址');
}

watch(() => [props.src, props.kind], load, { flush: 'post' });
onMounted(load);

defineExpose({ reload: load, video: videoRef });

onBeforeUnmount(() => {
  seq++;
  destroy();
});
</script>

<style scoped>
.live-player {
  position: relative;
  width: 100%;
  height: 100%;
  background: #000;
}
.live-player__video {
  width: 100%;
  height: 100%;
  display: block;
  background: #000;
}
.live-player__tip {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 10px;
  color: #fff;
  pointer-events: none;
}
</style>
