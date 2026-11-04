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

        <!-- 需要用户手势才能播放时显示 -->
        <div v-if="needTap" class="player__tap" @click="startPlayback">
          <PlayCircleOutlined class="player__tap-icon" />
          <div class="player__tap-text">点击播放</div>
        </div>
        <div v-else-if="buffering || stalled" class="player__buffering">
          <a-spin />
          <div v-if="stalled" class="player__stall">
            还没出画面：可能是这条线路失效，试试选集里的其他线路
            <a-button size="small" style="margin-left: 8px" @click="init(true)">重新解析</a-button>
          </div>
        </div>

        <!-- 弹幕层 -->
        <div v-show="danmakuOn && danmakuVisible.length" class="player__danmaku">
          <span
            v-for="d in danmakuVisible"
            :key="d.key"
            class="player__danmaku-item"
            :class="{ 'is-top': d.m === 5, 'is-bottom': d.m === 4 }"
            :style="d.style"
          >
            {{ d.text }}
          </span>
        </div>
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
          <a-button v-if="danmakuCid" size="small" :type="danmakuOn ? 'primary' : 'default'" @click="toggleDanmaku">
            弹幕 {{ danmakuOn ? '开' : '关' }}
          </a-button>
          <a-tooltip title="画中画（小窗播放）">
            <a-button size="small" :disabled="iframeMode || !playUrl" @click="togglePip"><PictureOutlined /></a-button>
          </a-tooltip>
          <a-tooltip :title="shortcutTip">
            <a-button size="small">快捷键</a-button>
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
        <a-tooltip v-for="r in sortedRoads" :key="r" :title="roadHint(r)">
          <div :class="['we-chip', { active: road === r, 'is-bad': isBadRoad(r) }]" @click="road = r">
            {{ r || '默认' }}<span v-if="isBadRoad(r)" class="player__road-bad">!</span>
          </div>
        </a-tooltip>
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
// ---------------- 线路可用性记忆 ----------------
const roadStat = ref<Record<string, { ok: number; fail: number; lastFail: number }>>({});
const roadKey = (id: string) => `we-roadstat:${id}`;

function loadRoadStat(id: string) {
  try {
    roadStat.value = JSON.parse(localStorage.getItem(roadKey(id)) || '{}');
  } catch {
    roadStat.value = {};
  }
}

function saveRoadStat() {
  try {
    localStorage.setItem(roadKey(ruleId), JSON.stringify(roadStat.value));
  } catch {
    /* ignore */
  }
}

function markRoad(ok: boolean) {
  const r = road.value || '默认';
  const cur = roadStat.value[r] || { ok: 0, fail: 0, lastFail: 0 };
  if (ok) cur.ok += 1;
  else {
    cur.fail += 1;
    cur.lastFail = Date.now();
  }
  roadStat.value = { ...roadStat.value, [r]: cur };
  saveRoadStat();
}

/** 最近 30 分钟失败过、且没成功过的线路判为“可疑” */
function isBadRoad(name: string) {
  const s = roadStat.value[name || '默认'];
  if (!s) return false;
  return s.fail > s.ok * 2 && Date.now() - s.lastFail < 30 * 60_000;
}

function roadHint(name: string) {
  const s = roadStat.value[name || '默认'];
  if (!s) return '还没有播放记录';
  return `成功 ${s.ok} 次 / 失败 ${s.fail} 次`;
}

const sortedRoads = computed(() =>
  [...chapters.roads].sort((a, b) => Number(isBadRoad(a)) - Number(isBadRoad(b)))
);

const needTap = ref(false);
const buffering = ref(false);
const stalled = ref(false);
let stallTimer: number | null = null;

// ---------------- 弹幕 ----------------
const danmakuOn = ref(localStorage.getItem('we-danmaku') !== '0');
const danmakuCid = ref('');
const danmakuList = ref<DanmakuItem[]>([]);
const danmakuVisible = ref<{ key: string; text: string; m: number; style: Record<string, string> }[]>([]);
let danmakuTimer: number | null = null;
let danmakuCursor = 0;
let danmakuSeq = 0;

function toggleDanmaku() {
  danmakuOn.value = !danmakuOn.value;
  localStorage.setItem('we-danmaku', danmakuOn.value ? '1' : '0');
  if (!danmakuOn.value) danmakuVisible.value = [];
}

/** 按当前播放时间把 1 秒内的弹幕推到屏幕上 */
function pumpDanmaku() {
  const video = videoRef.value;
  if (!video || !danmakuOn.value || iframeMode.value) {
    danmakuTimer = window.setTimeout(pumpDanmaku, 300);
    return;
  }
  const now = video.currentTime;
  // 快进/回退后重新定位游标
  if (danmakuCursor >= danmakuList.value.length || danmakuList.value[danmakuCursor].t > now + 1) {
    danmakuCursor = 0;
    while (danmakuCursor < danmakuList.value.length && danmakuList.value[danmakuCursor].t < now) danmakuCursor++;
  }
  while (danmakuCursor < danmakuList.value.length) {
    const d = danmakuList.value[danmakuCursor];
    if (d.t > now + 0.4) break;
    danmakuCursor++;
    if (d.t < now - 1) continue; // 已经过时的丢掉
    const lane = danmakuSeq % 8;
    const style: Record<string, string> = {
      color: `#${d.c.toString(16).padStart(6, '0')}`,
      top: d.m === 4 ? 'auto' : `${6 + lane * 11}%`,
      bottom: d.m === 4 ? '8%' : 'auto',
      animationDuration: `${Math.max(6, Math.min(12, d.text.length * 0.4 + 6))}s`
    };
    danmakuVisible.value.push({ key: `${danmakuSeq++}`, text: d.text, m: d.m, style });
  }
  // 只保留最近 60 条，避免 DOM 膨胀
  if (danmakuVisible.value.length > 60) danmakuVisible.value = danmakuVisible.value.slice(-60);
  danmakuTimer = window.setTimeout(pumpDanmaku, 300);
}

async function loadDanmaku(cid: string) {
  danmakuList.value = [];
  danmakuVisible.value = [];
  danmakuCursor = 0;
  danmakuCid.value = cid;
  if (!cid) return;
  const res = await getDanmaku(cid).catch(() => null);
  if (res && res.code === 0 && res.data) {
    danmakuList.value = res.data.list || [];
  }
}
const road = ref('');
const rate = ref(setting.data.player.playbackRate || 1);
const volume = ref(Number(setting.data.player.volume ?? 1));
const shortcutTip = '空格 播放/暂停 · ← → 快退/快进 10s · Shift+← → 上/下一集 · F 全屏 · M 静音 · ↑ ↓ 音量';

async function togglePip() {
  const video = videoRef.value;
  if (!video) return;
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await video.requestPictureInPicture();
  } catch (e: any) {
    console.warn('画中画失败', e?.message || e);
  }
}
const rateOptions = [0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((v) => ({ value: v, label: `${v}x` }));
let hls: Hls | null = null;

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
        if (!data.fatal) return;
        if (data.type === HlsLib.ErrorTypes.MEDIA_ERROR) {
          hls?.recoverMediaError();
          return;
        }
        if (data.type === HlsLib.ErrorTypes.NETWORK_ERROR) {
          void postClientLog({
            level: 'error',
            scope: 'hls',
            message: `hls network error: ${data.details || data.type}`,
            extra: {
              url: data.url || data.frag?.url || '',
              response: data.response?.code || data.response?.text || '',
              playUrl: playUrl.value,
              chapterPath,
              ruleId
            }
          });
          void retryOnce('视频加载失败（网络错误或资源已失效）');
          return;
        }
        errMsg.value = '视频播放失败';
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      return;
    }
  }
  video.src = url;
}

async function init(noCache = false) {
  if (!noCache) autoRetried = false;
  loading.value = true;
  errMsg.value = '';
  iframeMode.value = false;
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
  if (res.code === 0) loadDanmaku(String(res.data?.danmakuCid || ''));
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

/** 播放迟迟不进画面：记日志 + 给提示，避免“黑屏 0:00”没有任何线索 */
function watchStall() {
  if (stallTimer) clearTimeout(stallTimer);
  stalled.value = false;
  stallTimer = window.setTimeout(() => {
    const v = videoRef.value;
    if (!v || errMsg.value) return;
    if (v.readyState >= 2 && v.currentTime > 0.3) return;
    stalled.value = true;
    markRoad(false);
    void postClientLog({
      level: 'error',
      scope: 'stalled',
      message: '播放 8 秒仍未出画面',
      extra: {
        playUrl: playUrl.value,
        readyState: v.readyState,
        networkState: v.networkState,
        duration: String(v.duration),
        paused: v.paused,
        error: v.error ? `${v.error.code}/${v.error.message}` : '',
        chapterPath,
        ruleId
      }
    });
  }, 8000);
}

/** 浏览器拦截带声音的自动播放时：先静音播，仍失败就提示点击 */
async function startPlayback(mutedRetry = false) {
  const video = videoRef.value;
  if (!video) return;
  try {
    await video.play();
    needTap.value = false;
  } catch (e: any) {
    if (!mutedRetry && e?.name === 'NotAllowedError') {
      video.muted = true;
      try {
        await video.play();
        needTap.value = false;
        message.info('已静音自动播放（点音量图标可恢复声音）');
        return;
      } catch {
        /* 仍然不行 */
      }
    }
    needTap.value = true;
  }
}

function onLoaded() {
  const video = videoRef.value!;
  video.playbackRate = rate.value;
  video.volume = volume.value;
  const t = Number(q.currentTime || 0);
  const resumeFrom = setting.data.player.resume && t > 5 && (!video.duration || t < video.duration - 10) ? t : 0;
  const intro = Number(setting.data.player.skipIntro || 0);
  if (resumeFrom) {
    video.currentTime = resumeFrom;
    message.info(`已从上次的位置 ${formatTime(resumeFrom)} 继续播放`);
  } else if (intro > 0 && intro < (video.duration || 0)) {
    video.currentTime = intro;
  }
  outroSkipped = false;
  void startPlayback();
  watchStall();
}

let lastSave = 0;
let markedOk = false;
function updateBuffering() {
  const v = videoRef.value;
  buffering.value = !!v && !v.paused && v.readyState < 3;
  if (v && v.currentTime > 0.5) stalled.value = false;
  if (v && v.currentTime > 3 && !markedOk) {
    markedOk = true;
    markRoad(true);
  }
}

let outroSkipped = false;
function onTimeUpdate() {
  updateBuffering();
  // 跳过片尾
  const v = videoRef.value;
  const outro = Number(setting.data.player.skipOutro || 0);
  if (v && outro > 0 && !outroSkipped && v.duration && v.duration - v.currentTime <= outro) {
    outroSkipped = true;
    if (next.value) {
      message.info('已跳过片尾，播放下一集');
      go(next.value);
    }
  }
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

/** 资源站 m3u8 的 sign 会过期 → 第一次失败自动重新解析一次（带 noCache） */
let autoRetried = false;
/** 选一条没被判坏的备用线路 */
function betterRoad(): string | null {
  const candidates = chapters.roads.filter((r) => r !== road.value && !isBadRoad(r));
  return candidates[0] ?? null;
}

async function retryOnce(reason: string) {
  if (autoRetried) {
    markRoad(false);
    const alt = betterRoad();
    if (alt) {
      message.warning(`这条线路播不出来，已切到「${alt}」`);
      road.value = alt;
      autoRetried = false;
      errMsg.value = '';
      const target = chapters.chapters.find((c) => (c.road || '') === alt && c.name === current.value?.name);
      if (target) go(target);
      return;
    }
    errMsg.value = reason;
    return;
  }
  autoRetried = true;
  message.info('资源可能已过期，正在重新解析…');
  await init(true);
}

function onVideoError() {
  if (hls || iframeMode.value || loading.value) return;
  void postClientLog({
    level: 'error',
    scope: 'video',
    message: 'video 元素报错',
    extra: { playUrl: playUrl.value, chapterPath, ruleId, name }
  });
  void retryOnce('视频无法播放（格式不支持或资源已失效）');
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

watch(volume, (v) => {
  setting.data.player.volume = v;
  if (videoRef.value) videoRef.value.volume = v;
});

function onKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const video = videoRef.value;
  if (!video || iframeMode.value) return;
  if (e.key === ' ') {
    e.preventDefault();
    if (video.paused) void video.play();
    else video.pause();
  } else if (e.key === 'ArrowRight' && !e.shiftKey) video.currentTime += 10;
  else if (e.key === 'ArrowLeft' && !e.shiftKey) video.currentTime -= 10;
  else if (e.key === 'ArrowRight' && e.shiftKey) go(next.value);
  else if (e.key === 'ArrowLeft' && e.shiftKey) go(prev.value);
  else if (e.key === 'f' || e.key === 'F') video.requestFullscreen?.();
  else if (e.key === 'm' || e.key === 'M') video.muted = !video.muted;
  else if (e.key === 'ArrowUp') {
    e.preventDefault();
    volume.value = Math.min(1, Math.round((video.volume + 0.1) * 10) / 10);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    volume.value = Math.max(0, Math.round((video.volume - 0.1) * 10) / 10);
  }
}

useBus(EVENT_CHAPTERS_BOX).on(() => episodesRef.value?.querySelector('.active')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));

onMounted(() => {
  loadRoadStat(ruleId);
  markedOk = false;
  pumpDanmaku();
  init();
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  saveProgress();
  destroyHls();
  if (danmakuTimer) clearTimeout(danmakuTimer);
  if (stallTimer) clearTimeout(stallTimer);
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
.player__tap {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  cursor: pointer;
  z-index: 5;
}
.player__tap-icon {
  font-size: 56px;
}
.player__tap-text {
  font-size: 14px;
}
.player__buffering {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 4;
}
.player__stall {
  font-size: 12px;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
  padding: 6px 10px;
  border-radius: 6px;
  pointer-events: auto;
}
.player__danmaku {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 3;
}
.player__danmaku-item {
  position: absolute;
  left: 100%;
  white-space: nowrap;
  font-size: 18px;
  font-weight: 600;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
  animation-name: danmaku-move;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
  will-change: transform;
}
.player__danmaku-item.is-top,
.player__danmaku-item.is-bottom {
  left: 50%;
  transform: translateX(-50%);
  animation: danmaku-fade 4s linear forwards;
}
@keyframes danmaku-move {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(calc(-100vw - 100%));
  }
}
@keyframes danmaku-fade {
  0% { opacity: 0; }
  10% { opacity: 1; }
  85% { opacity: 1; }
  100% { opacity: 0; }
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
.player__road-bad {
  margin-left: 4px;
  color: #fa8c16;
  font-weight: 700;
}
.player__roads .we-chip.is-bad {
  opacity: 0.65;
  border: 1px dashed rgba(250, 140, 22, 0.6);
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
