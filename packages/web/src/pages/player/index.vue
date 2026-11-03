<template>
  <div class="player">
    <section class="player__main">
      <div class="player__stage">
        <div v-if="loading" class="player__mask"><a-spin tip="正在解析播放地址..." /></div>
        <div v-else-if="errMsg" class="player__mask">
          <a-result status="warning" :title="errMsg" :sub-title="playUrl">
            <template #extra>
              <a-space wrap>
                <a-button type="primary" @click="init(true)">重新解析</a-button>
                <a-button v-if="playUrl && !iframeMode" @click="iframeMode = true">以网页方式打开</a-button>
                <a-button v-if="playUrl" @click="openRaw">新窗口打开</a-button>
              </a-space>
            </template>
          </a-result>
        </div>
        <iframe
          v-if="iframeMode && playUrl"
          :src="playUrl"
          class="player__iframe"
          allowfullscreen
          referrerpolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-presentation"
        ></iframe>
        <video
          v-show="!iframeMode && !loading && !errMsg"
          ref="videoRef"
          class="player__video"
          controls
          autoplay
          playsinline
          @loadedmetadata="onLoaded"
          @timeupdate="onTimeUpdate"
          @ended="onEnded"
          @error="onVideoError"
        ></video>
      </div>

      <div class="player__bar">
        <div class="player__title we-ellipsis" :title="`${name} ${current?.name || ''}`">
          <b>{{ name }}</b>
          <span class="we-muted">{{ current?.name }}</span>
        </div>
        <a-space wrap>
          <a-button size="small" :disabled="!prev" @click="go(prev)"><StepBackwardOutlined /> 上一集</a-button>
          <a-button size="small" :disabled="!next" @click="go(next)">下一集 <StepForwardOutlined /></a-button>
          <a-select v-model:value="rate" size="small" style="width: 84px" :options="rateOptions" />
          <a-tooltip title="自动播放下一集">
            <a-switch v-model:checked="setting.data.player.autoNext" size="small" />
          </a-tooltip>
          <a-button size="small" @click="iframeMode = !iframeMode">{{ iframeMode ? '播放器模式' : '网页模式' }}</a-button>
          <a-button size="small" @click="openRaw"><ExportOutlined /></a-button>
        </a-space>
      </div>
    </section>

    <!-- 选集 -->
    <aside class="player__side">
      <div class="player__side-head">
        选集
        <span class="we-muted">{{ roadChapters.length }} 集</span>
      </div>
      <div v-if="chapters.roads.length > 1" class="player__roads">
        <div v-for="r in chapters.roads" :key="r" :class="['we-chip', { active: road === r }]" @click="road = r">{{ r || '默认' }}</div>
      </div>
      <div ref="episodesRef" class="player__episodes">
        <div
          v-for="c in roadChapters"
          :key="c.chapterPath"
          :data-path="c.chapterPath"
          :title="c.name"
          :class="['player__ep we-ellipsis', { active: c.chapterPath === chapterPath }]"
          @click="go(c)"
        >
          {{ c.name }}
        </div>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { StepBackwardOutlined, StepForwardOutlined, ExportOutlined } from '@ant-design/icons-vue';
import type Hls from 'hls.js';
import { getContent, saveChapterHistory, type ChapterItem } from '@/api';
import { useChaptersStore } from '@/stores/chapters';
import { useSettingStore } from '@/stores/setting';
import { useBus, EVENT_CHAPTERS_BOX } from '@/utils/bus';

const route = useRoute();
const router = useRouter();
const chapters = useChaptersStore();
const setting = useSettingStore();

const q = route.query as Record<string, string>;
const { ruleId, filePath, chapterPath, name } = q;

const videoRef = ref<HTMLVideoElement>();
const episodesRef = ref<HTMLElement>();
const loading = ref(true);
const errMsg = ref('');
const playUrl = ref('');
const iframeMode = ref(false);
const road = ref('');
const rate = ref(setting.data.player.playbackRate || 1);
const rateOptions = [0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((v) => ({ value: v, label: `${v}x` }));
let hls: Hls | null = null;
let resumed = false;

const current = computed(() => chapters.chapters.find((c) => c.chapterPath === chapterPath));
const roadChapters = computed(() => chapters.chapters.filter((c) => (c.road || '') === road.value));
const sameRoad = computed(() => chapters.chapters.filter((c) => (c.road || '') === (current.value?.road || '')));
const prev = computed(() => {
  const i = sameRoad.value.findIndex((c) => c.chapterPath === chapterPath);
  return i > 0 ? sameRoad.value[i - 1] : undefined;
});
const next = computed(() => {
  const i = sameRoad.value.findIndex((c) => c.chapterPath === chapterPath);
  return i > -1 ? sameRoad.value[i + 1] : undefined;
});

const MEDIA_RE = /\.(m3u8|mp4|flv|webm|mkv|mov|m4v|mp3|m4a|aac|ogg|wav)(\?|#|$)/i;

function destroyHls() {
  hls?.destroy();
  hls = null;
}

/** 转发地址里的真实地址是 URL 编码的，判断类型前先解码 */
function probeUrl(url: string) {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

async function play(url: string) {
  const video = videoRef.value!;
  destroyHls();
  const isM3u8 = /\.m3u8(\?|#|$)/i.test(probeUrl(url)) || /m3u8/i.test(url);
  if (isM3u8 && !video.canPlayType('application/vnd.apple.mpegurl')) {
    const { default: HlsLib } = await import('hls.js');
    if (HlsLib.isSupported()) {
      hls = new HlsLib({ maxBufferLength: 60 });
      hls.on(HlsLib.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          if (data.type === HlsLib.ErrorTypes.NETWORK_ERROR) errMsg.value = '视频加载失败（网络错误或资源已失效）';
          else if (data.type === HlsLib.ErrorTypes.MEDIA_ERROR) hls?.recoverMediaError();
          else errMsg.value = '视频播放失败';
        }
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      return;
    }
  }
  video.src = url;
}

async function init(noCache = false) {
  loading.value = true;
  errMsg.value = '';
  iframeMode.value = false;
  resumed = false;
  chapters.currentPath = chapterPath;

  const list = await chapters.load(ruleId, filePath);
  chapters.title = [name, current.value?.name].filter(Boolean).join(' · ');
  document.title = `${chapters.title} - watchEverywhere`;
  road.value = current.value?.road ?? list[0]?.road ?? '';
  nextTick(() => episodesRef.value?.querySelector('.active')?.scrollIntoView({ block: 'center' }));

  const res = await getContent({ ruleId, filePath, chapterPath, noCache });
  loading.value = false;
  const url = res.code === 0 ? String(Array.isArray(res.data?.content) ? res.data.content[0] : res.data?.content || '') : '';
  playUrl.value = url;
  if (!url) {
    errMsg.value = res.msg || '没有解析到播放地址';
    return;
  }
  if (!MEDIA_RE.test(probeUrl(url)) && !/m3u8/i.test(url)) {
    // 不是直链（通常是网页播放页），用内嵌网页播放
    iframeMode.value = true;
    return;
  }
  await nextTick();
  play(url);
}

function onLoaded() {
  const video = videoRef.value!;
  video.playbackRate = rate.value;
  const t = Number(q.currentTime || 0);
  if (!resumed && setting.data.player.resume && t > 5 && (!video.duration || t < video.duration - 10)) {
    video.currentTime = t;
    message.info(`已从上次的位置 ${formatTime(t)} 继续播放`);
  }
  resumed = true;
}

let lastSave = 0;
function onTimeUpdate() {
  const now = Date.now();
  if (now - lastSave < 5000) return;
  lastSave = now;
  saveProgress();
}

function saveProgress() {
  const video = videoRef.value;
  if (!video || !video.currentTime) return;
  saveChapterHistory({
    ruleId,
    filePath,
    chapterPath,
    chapterName: current.value?.name || '',
    currentTime: Math.floor(video.currentTime),
    percentage: video.duration ? Math.floor((video.currentTime / video.duration) * 100000) : 0
  });
}

function onEnded() {
  saveProgress();
  if (setting.data.player.autoNext && next.value) go(next.value);
}

function onVideoError() {
  if (hls || iframeMode.value || loading.value) return;
  errMsg.value = '视频无法播放（格式不支持或资源已失效）';
}

function go(c?: ChapterItem) {
  if (!c || c.chapterPath === chapterPath) return;
  saveProgress();
  router.replace({ path: '/player', query: { ...q, chapterPath: c.chapterPath, currentTime: '0' } });
}

function openRaw() {
  if (playUrl.value) window.open(playUrl.value, '_blank', 'noopener');
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const h = Math.floor(m / 60);
  return h ? `${h}:${String(m % 60).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}

watch(rate, (v) => {
  setting.data.player.playbackRate = v;
  if (videoRef.value) videoRef.value.playbackRate = v;
});

function onKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const video = videoRef.value;
  if (!video || iframeMode.value) return;
  if (e.key === ' ') {
    e.preventDefault();
    video.paused ? video.play() : video.pause();
  } else if (e.key === 'ArrowRight' && !e.shiftKey) video.currentTime += 10;
  else if (e.key === 'ArrowLeft' && !e.shiftKey) video.currentTime -= 10;
  else if (e.key === 'ArrowRight' && e.shiftKey) go(next.value);
  else if (e.key === 'ArrowLeft' && e.shiftKey) go(prev.value);
  else if (e.key === 'f') video.requestFullscreen?.();
}

useBus(EVENT_CHAPTERS_BOX).on(() => episodesRef.value?.querySelector('.active')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));

onMounted(() => {
  init();
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  saveProgress();
  destroyHls();
  window.removeEventListener('keydown', onKey);
});
</script>

<style scoped>
.player {
  height: 100%;
  display: flex;
  overflow: hidden;
  background: var(--we-main-background);
}
.player__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.player__stage {
  flex: 1;
  position: relative;
  background: #000;
  min-height: 0;
}
.player__video,
.player__iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
  background: #000;
}
.player__mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  background: var(--we-main-background);
  padding: 20px;
  overflow: auto;
  word-break: break-all;
}
.player__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--we-top-bar-border);
}
.player__title {
  display: flex;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.player__side {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--we-top-bar-border);
  background: var(--we-left-bar-bg-secondary);
}
.player__side-head {
  padding: 10px 12px;
  font-weight: 600;
  display: flex;
  justify-content: space-between;
}
.player__roads {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0 8px 8px;
}
.player__episodes {
  flex: 1;
  overflow: auto;
  padding: 0 8px 12px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
  gap: 6px;
  align-content: start;
}
.player__ep {
  height: 32px;
  line-height: 32px;
  text-align: center;
  padding: 0 6px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  background: var(--we-color-primary-bg);
}
.player__ep:hover {
  color: var(--we-color-primary);
}
.player__ep.active {
  background: var(--we-color-primary);
  color: #fff;
  font-weight: 600;
}
@media (max-width: 900px) {
  .player {
    flex-direction: column;
    overflow: auto;
  }
  .player__main {
    flex: none;
  }
  .player__stage {
    flex: none;
    aspect-ratio: 16 / 9;
  }
  .player__side {
    width: 100%;
    flex: 1;
    border-left: none;
    min-height: 260px;
  }
}
</style>
