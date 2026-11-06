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
                <a-button type="primary" ghost @click="openSourcePicker">换个源播放</a-button>
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
          @seeking="onSeeking"
          @ended="onEnded"
          @error="onVideoError"
        ></video>

        <!-- 需要用户手势才能播放时显示 -->
        <div v-if="needTap" class="player__tap" @click="startPlayback()">
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

        <!-- 字幕层：ASS 特效字幕由 assjs 渲染到这个容器，其余格式走纯文本 -->
        <div v-show="assOn" ref="assRef" class="player__ass"></div>
        <div v-if="subtitleText" class="player__subtitle">{{ subtitleText }}</div>
        <div v-if="adTip" class="player__adtip">{{ adTip }}</div>

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

      <canvas v-show="srOn" ref="srCanvasRef" class="player__sr"></canvas>

      <div class="player__bar">
        <div class="player__title we-ellipsis" :title="`${name} ${current?.name || ''}`">
          <template v-if="isTorrent">
            <b>{{ q.tName || '磁力播放' }}</b>
            <span v-if="torrentInfo" class="we-muted" style="font-size: 12px">
              {{ torrentInfo.peers }} peers · {{ (torrentInfo.progress * 100).toFixed(1) }}% ·
              {{ (torrentInfo.speed / 1048576).toFixed(2) }} MB/s
            </span>
          </template>
          <b>{{ name }}</b>
          <span class="we-muted">{{ current?.name }}</span>
        </div>
        <a-space wrap>
          <a-button size="small" :disabled="!prev" @click="go(prev)"><StepBackwardOutlined /> 上一集</a-button>
          <a-button size="small" :disabled="!next" @click="go(next, true)">下一集 <StepForwardOutlined /></a-button>
          <a-select v-model:value="rate" size="small" style="width: 84px" :options="rateOptions" />
          <a-tooltip title="自动播放下一集">
            <a-switch v-model:checked="setting.data.player.autoNext" size="small" />
          </a-tooltip>
          <a-button v-if="danmakuCid" size="small" :type="danmakuOn ? 'primary' : 'default'" @click="toggleDanmaku">
            弹幕 {{ danmakuOn ? '开' : '关' }}
          </a-button>
          <a-dropdown>
            <a-button size="small" :type="subtitleCues.length || assOn ? 'primary' : 'default'">
              字幕{{ subtitleName ? ' · ' + subtitleName : '' }}
            </a-button>
            <template #overlay>
              <a-menu>
                <a-menu-item key="local" @click="pickSubtitle">加载本地字幕（.srt / .vtt / .ass / .ssa）</a-menu-item>
                <a-menu-item key="bili" @click="loadBiliSubtitle">从 B 站获取 CC 字幕</a-menu-item>
                <a-menu-item v-if="hasSubtitle" key="delay-" @click="shiftSubtitle(-0.5)">字幕延后 0.5s</a-menu-item>
                <a-menu-item v-if="hasSubtitle" key="delay+" @click="shiftSubtitle(0.5)">字幕提前 0.5s</a-menu-item>
                <a-menu-divider v-if="hasSubtitle" />
                <a-menu-item v-if="hasSubtitle" key="off" @click="clearSubtitle">关闭字幕</a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
          <input ref="subFileRef" type="file" accept=".srt,.vtt,.ass,.ssa,text/plain" style="display: none" @change="onSubtitleFile" />
          <a-select
            v-if="qualities.length > 1"
            :value="currentQuality === -1 ? 'auto' : currentQuality"
            size="small"
            style="width: 92px"
            :options="[{ value: 'auto', label: '自动' }, ...qualities.map((q) => ({ value: q.index, label: q.label }))]"
            @change="(v: any) => setQuality(v === 'auto' ? -1 : Number(v))"
          />
          <a-select
            v-if="audioTracks.length > 1"
            :value="currentAudio"
            size="small"
            style="width: 104px"
            :options="audioTracks.map((t) => ({ value: t.id, label: t.name }))"
            @change="(v: any) => setAudioTrack(Number(v))"
          />
          <a-button size="small" :loading="sameLoading" @click="openSourcePicker">换源</a-button>
          <a-dropdown>
            <a-button size="small" :type="srOn ? 'primary' : 'default'">
              超分{{ srOn ? ' ' + (srScale === 1.5 ? '1.5' : srScale) + 'x' : '' }}
            </a-button>
            <template #overlay>
              <a-menu @click="onSuperResMenu">
                <a-menu-item key="off">关闭</a-menu-item>
                <a-menu-item key="s0.5">柔和（锐化 0.5）</a-menu-item>
                <a-menu-item key="s1.2">标准（锐化 1.2）</a-menu-item>
                <a-menu-item key="s2">强（锐化 2.0）</a-menu-item>
                <a-menu-divider />
                <a-menu-item key="k1.5">1.5 倍</a-menu-item>
                <a-menu-item key="k2">2 倍</a-menu-item>
                <a-menu-item key="k3">3 倍</a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
          <a-tooltip title="画中画（小窗播放）">
            <a-button size="small" :disabled="iframeMode || !playUrl" @click="togglePip"><PictureOutlined /></a-button>
          </a-tooltip>
          <a-tooltip :title="shortcutTip">
            <a-button size="small">快捷键</a-button>
          </a-tooltip>
          <a-button size="small" @click="iframeMode = !iframeMode">{{ iframeMode ? '播放器模式' : '网页模式' }}</a-button>
          <ExternalPlayerMenu :url="playUrl" :title="`${name} ${current?.name || ''}`.trim()" />
        </a-space>
      </div>
    </section>

    <!-- 换源：同一部作品的其他来源 -->
    <a-drawer v-model:open="sourceOpen" title="换个源播放" placement="right" :width="420">
      <p class="we-muted" style="font-size: 12px">
        按片名在其他规则里找同一部作品；切过去会尽量停在相同的集数。
      </p>
      <a-empty v-if="!sameLoading && !sameSources.length" description="没有找到其他来源" />
      <div v-for="s0 in sameSources" :key="s0.ruleId" class="source-item">
        <div class="source-item__main">
          <div class="source-item__name">{{ s0.rule }}</div>
          <div class="source-item__title we-muted we-ellipsis" :title="s0.name">{{ s0.name }}</div>
        </div>
        <a-button size="small" type="primary" :loading="switching === s0.ruleId" @click="switchSource(s0)">切过去</a-button>
      </div>
    </a-drawer>

    <!-- 选集 -->
    <aside class="player__side">
      <div class="player__side-head">
        选集
        <span class="we-muted">{{ roadChapters.length }} 集</span>
      </div>
      <div v-if="chapters.roads.length > 1" class="player__roads">
        <a-tooltip v-for="r in sortedRoads" :key="r" :title="roadHint(r)">
          <div :class="['we-chip', { active: road === r, 'is-bad': isBadRoad(r) }]" @click="road = r">
            {{ r || '默认' }}{{ roadLabel(r) }}<span v-if="isBadRoad(r)" class="player__road-bad">!</span>
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
import { message, Modal } from 'ant-design-vue';
import {
  PictureOutlined,
  PlayCircleOutlined,
  StepBackwardOutlined,
  StepForwardOutlined
} from '@ant-design/icons-vue';
import type Hls from 'hls.js';
import {
  getChapter,
  getSameSources,
  type SameSource,
  fetchBiliSubtitle,
  getBiliSubtitles,
  getContent,
  getDanmaku,
  torrentPlayUrl,
  torrentStatus,
  postClientLog,
  saveChapterHistory,
  type ChapterItem,
  type DanmakuItem
} from '@/api';
import { cuesFromBili, findCue, isAssSubtitle, parseAss, parseSubtitle, type Cue } from '@/utils/subtitle';
import { createAdFilterLoader } from '@/utils/hls-adloader';
import ExternalPlayerMenu from '@/components/ExternalPlayerMenu.vue';
import { loadSkipConfig, recordIntroSample, recordOutroSample, saveSkipConfig, suggestSkip } from '@/utils/skip-learn';
import { SuperResolver, type SuperResScale } from '@/utils/superres';
import { episodeNo } from '@/utils/episode';
import { useChaptersStore } from '@/stores/chapters';
import { useRulesStore } from '@/stores/rules';
import { useSettingStore } from '@/stores/setting';
import { useBus, EVENT_CHAPTERS_BOX } from '@/utils/bus';

const route = useRoute();
const router = useRouter();
const chapters = useChaptersStore();
const rules = useRulesStore();
const rule = computed(() => rules.list.find((r) => r.id === ruleId));
const setting = useSettingStore();

const q = route.query as Record<string, string>;
const { ruleId, filePath, chapterPath, name } = q;
/** 磁力在线播放：/player?torrent=<infoHash>&tIndex=<index>&tName=<文件名> */
const torrentHash = q.torrent || '';
const torrentIndex = Number(q.tIndex || 0);
const isTorrent = !!torrentHash;

const videoRef = ref<HTMLVideoElement>();
const episodesRef = ref<HTMLElement>();
const loading = ref(true);
const errMsg = ref('');
const playUrl = ref('');
const iframeMode = ref(false);
// ---------------- 码率 / 音轨 ----------------
interface QualityLevel {
  index: number;
  height: number;
  bitrate: number;
  label: string;
}
const qualities = ref<QualityLevel[]>([]);
const currentQuality = ref<number>(-1); // -1 = 自动
const audioTracks = ref<{ id: number; name: string; lang?: string }[]>([]);
const currentAudio = ref<number>(-1);

function readHlsTracks() {
  if (!hls) return;
  const levels = (hls.levels || []).map((lv: any, i: number) => ({
    index: i,
    height: Number(lv.height || 0),
    bitrate: Number(lv.bitrate || 0),
    label: lv.height ? `${lv.height}P` : `${Math.round((lv.bitrate || 0) / 1000)}kbps`
  }));
  qualities.value = levels;
  const tracks = (hls.audioTracks || []).map((t: any, i: number) => ({
    id: i,
    name: t.name || t.lang || `音轨 ${i + 1}`,
    lang: t.lang
  }));
  audioTracks.value = tracks.length > 1 ? tracks : [];
}

function setQuality(index: number) {
  currentQuality.value = index;
  if (!hls) return;
  hls.currentLevel = index;
  message.success(index === -1 ? '已切到自动码率' : `已切到 ${qualities.value[index]?.label || index}`);
}

function setAudioTrack(id: number) {
  currentAudio.value = id;
  if (!hls) return;
  hls.audioTrack = id;
  message.success(`已切到音轨：${audioTracks.value.find((t) => t.id === id)?.name || id}`);
}

// ---------------- 磁力状态 ----------------
const torrentInfo = ref<{ peers: number; progress: number; speed: number } | null>(null);
let torrentTimer: number | null = null;

function startTorrentPolling() {
  if (!isTorrent) return;
  if (torrentTimer) clearInterval(torrentTimer);
  const tick = async () => {
    const res = await torrentStatus(torrentHash);
    if (res.code === 0 && res.data) {
      torrentInfo.value = { peers: res.data.peers, progress: res.data.progress, speed: res.data.speed };
    }
  };
  void tick();
  torrentTimer = window.setInterval(tick, 3000);
}

// ---------------- 换源 ----------------
const sourceOpen = ref(false);
const sameSources = ref<SameSource[]>([]);
const sameLoading = ref(false);
const switching = ref('');

async function openSourcePicker() {
  sourceOpen.value = true;
  if (sameSources.value.length) return;
  sameLoading.value = true;
  const res = await getSameSources({
    name: String(current.value?.name ? name : name),
    contentType: rule.value?.contentType,
    excludeRuleId: ruleId
  });
  sameLoading.value = false;
  sameSources.value = res.code === 0 ? res.data || [] : [];
}

/** 切到另一个源，尽量停在相同的集 */
async function switchSource(src: SameSource) {
  switching.value = src.ruleId;
  try {
    const list = await getChapter(src.ruleId, src.url, true);
    const rows = list.code === 0 ? list.data || [] : [];
    if (!rows.length) {
      message.error('这个源没有可播放的剧集');
      return;
    }
    const want = episodeNo(String(current.value?.name || ''));
    const hit = (want != null && rows.find((r) => episodeNo(r.name) === want)) || rows[0];
    sourceOpen.value = false;
    disableSuperRes();
    router.replace({
      path: '/player',
      query: {
        ruleId: src.ruleId,
        filePath: src.url,
        chapterPath: hit.chapterPath,
        name: src.name,
        currentTime: '0'
      }
    });
  } finally {
    switching.value = '';
  }
}

// ---------------- 超分 ----------------
const srCanvasRef = ref<HTMLCanvasElement>();
const srOn = ref(false);
const srScale = ref<SuperResScale>(2);
const srStrength = ref(1.2);
let sr: SuperResolver | null = null;

async function enableSuperRes() {
  const video = videoRef.value;
  const canvas = srCanvasRef.value;
  if (!video || !canvas) return;
  if (!SuperResolver.supported()) {
    message.warning('当前浏览器不支持 WebGL2，无法开启超分');
    return;
  }
  try {
    if (!sr) {
      sr = new SuperResolver(video, canvas);
      sr.setStrength(srStrength.value);
    }
    sr.setScale(srScale.value);
    await sr.start(srScale.value);
    srOn.value = true;
    if (videoRef.value) videoRef.value.style.visibility = 'hidden';
    message.success(`已开启超分（${srScale.value}x）`);
  } catch (e: any) {
    message.error(String(e?.message || e));
  }
}

function disableSuperRes() {
  sr?.stop();
  srOn.value = false;
  if (videoRef.value) videoRef.value.style.visibility = '';
}

function onSuperResMenu(e: any) {
  const key = String(e.key);
  if (key === 'off') {
    disableSuperRes();
    return;
  }
  if (key.startsWith('s')) {
    srStrength.value = Number(key.slice(1));
    sr?.setStrength(srStrength.value);
    message.success(`锐化强度 ${srStrength.value}`);
    return;
  }
  if (key.startsWith('k')) {
    const scale = Number(key.slice(1)) as SuperResScale;
    srScale.value = scale;
    sr?.setScale(scale);
    if (srOn.value) {
      sr?.stop();
      void sr?.start(scale);
    } else {
      void enableSuperRes();
    }
  }
}

// ---------------- 字幕 ----------------
const subFileRef = ref<HTMLInputElement>();
const subtitleCues = ref<Cue[]>([]);
const subtitleName = ref('');
const subtitleText = ref('');
const subtitleDelay = ref(0);
const SUB_KEY = () => `we-sub:${ruleId}:${chapterPath}`;

// ASS / SSA 特效字幕
const assRef = ref<HTMLElement>();
const assOn = ref(false);
let assText = '';
let assInstance: any = null;
const hasSubtitle = computed(() => subtitleCues.value.length > 0 || assOn.value);

function destroyAss() {
  try {
    assInstance?.destroy?.();
  } catch {
    /* ignore */
  }
  assInstance = null;
  assOn.value = false;
  if (assRef.value) assRef.value.innerHTML = '';
}

/** 用 assjs 渲染特效；失败时降级成纯文本 */
async function loadAss(text: string, label: string, quiet = false) {
  destroyAss();
  subtitleCues.value = [];
  subtitleText.value = '';
  assText = text;
  subtitleName.value = label;
  await nextTick();
  try {
    if (!videoRef.value || !assRef.value) throw new Error('播放器未就绪');
    const { default: ASS } = await import('assjs');
    assInstance = new (ASS as any)(text, videoRef.value, { container: assRef.value, resampling: 'video_width' });
    assInstance.delay = -subtitleDelay.value;
    assOn.value = true;
    if (!quiet) message.success('已加载 ASS 特效字幕');
  } catch (e: any) {
    assText = '';
    subtitleCues.value = parseAss(text);
    if (!quiet) {
      if (subtitleCues.value.length) message.warning(`特效渲染失败（${e?.message || e}），已按纯文本显示`);
      else message.error('没解析出字幕内容');
    }
  }
}

function applySubtitleText(time: number) {
  subtitleText.value = findCue(subtitleCues.value, time + subtitleDelay.value);
}

function persistSubtitle() {
  try {
    if (assOn.value && assText) {
      // ASS 存原文（超过 1.5MB 就不存了）
      if (assText.length < 1.5 * 1024 * 1024) localStorage.setItem(SUB_KEY(), JSON.stringify({ name: subtitleName.value, ass: assText }));
      return;
    }
    if (!subtitleCues.value.length) localStorage.removeItem(SUB_KEY());
    else
      localStorage.setItem(
        SUB_KEY(),
        JSON.stringify({ name: subtitleName.value, cues: subtitleCues.value.slice(0, 4000) })
      );
  } catch {
    /* 太大就只保留内存里 */
  }
}

function restoreSubtitle() {
  try {
    const raw = localStorage.getItem(SUB_KEY());
    if (!raw) return;
    const row = JSON.parse(raw);
    if (typeof row?.ass === 'string' && row.ass) {
      void loadAss(row.ass, row.name || 'ASS 字幕', true);
      return;
    }
    if (Array.isArray(row?.cues) && row.cues.length) {
      subtitleCues.value = row.cues;
      subtitleName.value = row.name || '本地字幕';
      subtitleDelay.value = 0;
    }
  } catch {
    /* ignore */
  }
}

function pickSubtitle() {
  subFileRef.value?.click();
}

async function onSubtitleFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const text = await file.text();
  (e.target as HTMLInputElement).value = '';
  subtitleDelay.value = 0;
  if (isAssSubtitle(text, file.name)) {
    await loadAss(text, file.name.replace(/\.(ass|ssa)$/i, ''));
    persistSubtitle();
    return;
  }
  destroyAss();
  const cues = parseSubtitle(text);
  if (!cues.length) {
    message.warning('没解析出字幕，确认是 .srt / .vtt / .ass 格式');
    return;
  }
  subtitleCues.value = cues;
  subtitleName.value = file.name.replace(/\.(srt|vtt)$/i, '');
  subtitleDelay.value = 0;
  persistSubtitle();
  message.success(`已加载 ${cues.length} 条字幕`);
  (e.target as HTMLInputElement).value = '';
}

async function loadBiliSubtitle() {
  if (!danmakuCid.value) return message.warning('这不是 B 站的视频');
  const bvid = String(chapterPath || '').split('|')[1] || '';
  const res = await getBiliSubtitles({ cid: danmakuCid.value, bvid });
  if (res.code !== 0 || !res.data) return message.error(res.msg || '获取失败');
  const list = res.data.subtitles || [];
  if (!list.length) return message.warning(res.data.msg || '没有字幕（CC 字幕需要登录态 SESSDATA）');
  const first = list[0];
  const content = await fetchBiliSubtitle(first.url);
  if (content.code !== 0 || !content.data?.length) return message.error(content.msg || '字幕内容为空');
  destroyAss();
  subtitleCues.value = cuesFromBili(content.data as any);
  subtitleName.value = first.lan_doc || first.lan;
  subtitleDelay.value = 0;
  persistSubtitle();
  message.success(`已加载 ${subtitleCues.value.length} 条字幕`);
}

function shiftSubtitle(delta: number) {
  subtitleDelay.value += delta;
  // assjs 的 delay：正数表示字幕更晚出现，和这里的方向相反
  if (assInstance) assInstance.delay = -subtitleDelay.value;
  subtitleText.value = findCue(subtitleCues.value, (videoRef.value?.currentTime || 0) + subtitleDelay.value);
}

function clearSubtitle() {
  destroyAss();
  assText = '';
  subtitleCues.value = [];
  subtitleName.value = '';
  subtitleText.value = '';
  subtitleDelay.value = 0;
  persistSubtitle();
}

// ---------------- 线路可用性记忆 ----------------
interface RoadStat {
  ok: number;
  fail: number;
  lastFail: number;
  /** 画面高度（从 m3u8 的 RESOLUTION 里读） */
  height?: number;
  bandwidth?: number;
  /** 拉流耗时（毫秒） */
  ms?: number;
}
const roadStat = ref<Record<string, RoadStat>>({});
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

function roadLabel(name: string) {
  const h = roadStat.value[name || '默认']?.height;
  if (!h) return '';
  return ` · ${h >= 2000 ? '2K' : h >= 1000 ? '1080P' : h >= 700 ? '720P' : `${h}P`}`;
}

function roadHint(name: string) {
  const s = roadStat.value[name || '默认'];
  if (!s) return '还没有播放记录';
  const parts = [`成功 ${s.ok} 次`, `失败 ${s.fail} 次`];
  if (s.height) parts.push(`分辨率 ${s.height}P`);
  if (s.bandwidth) parts.push(`码率 ${Math.round(s.bandwidth / 1000)}kbps`);
  if (s.ms) parts.push(`拉流 ${s.ms}ms`);
  return parts.join(' / ');
}

/** 解析 m3u8 主清单里的清晰度；不是主清单就返回 undefined */
function parseVariant(text: string): { height: number; bandwidth: number } | undefined {
  if (!text.includes('#EXT-X-STREAM-INF')) return undefined;
  let best: { height: number; bandwidth: number } | undefined;
  for (const line of text.split('\n')) {
    if (!line.startsWith('#EXT-X-STREAM-INF')) continue;
    const bw = Number(/BANDWIDTH=(\d+)/.exec(line)?.[1] || 0);
    const res = /RESOLUTION=(\d+)x(\d+)/.exec(line);
    const height = res ? Number(res[2]) : 0;
    if (!best || height > best.height || (height === best.height && bw > best.bandwidth)) best = { height, bandwidth: bw };
  }
  return best;
}

/** 拉一次清单，记下这条线路的清晰度和耗时 */
async function probeRoadQuality(url: string) {
  if (!/m3u8|\.m3u/i.test(url)) return;
  const name = road.value || '默认';
  const started = Date.now();
  try {
    const text = await (await fetch(url)).text();
    const ms = Date.now() - started;
    const v = parseVariant(text);
    const cur = roadStat.value[name] || { ok: 0, fail: 0, lastFail: 0 };
    roadStat.value = { ...roadStat.value, [name]: { ...cur, height: v?.height || cur.height, bandwidth: v?.bandwidth || cur.bandwidth, ms } };
    saveRoadStat();
  } catch {
    /* 探测失败不影响播放 */
  }
}

const sortedRoads = computed(() => {
  const score = (name: string) => {
    const s = roadStat.value[name || '默认'];
    const bad = isBadRoad(name) ? 1 : 0;
    const height = s?.height || 0;
    const ms = s?.ms || 9999;
    return { bad, height, ms };
  };
  return [...chapters.roads].sort((a, b) => {
    const x = score(a);
    const y = score(b);
    if (x.bad !== y.bad) return x.bad - y.bad;
    if (x.height !== y.height) return y.height - x.height;
    return x.ms - y.ms;
  });
});

/** 打开剧集时，如果当前线路被判坏，自动换成最优线路 */
function pickBestRoad(): string {
  const good = sortedRoads.value.filter((r) => !isBadRoad(r));
  return good[0] || chapters.roads[0] || '';
}

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
  qualities.value = [];
  audioTracks.value = [];
  currentQuality.value = -1;
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

// ---------------- 智能去广告 ----------------
const adTip = ref('');
let adTipTimer: number | null = null;
let adReported = 0;

function onAdsFiltered(r: { removed: number; removedDuration: number }) {
  // 直播 / 分段清单会反复加载，同一集只提示一次
  adReported += r.removed;
  if (adTip.value) return;
  void adReported;
  adTip.value = `已跳过 ${r.removed} 段广告（约 ${Math.round(r.removedDuration)} 秒）`;
  if (adTipTimer) clearTimeout(adTipTimer);
  adTipTimer = window.setTimeout(() => (adTip.value = ''), 4000);
  void postClientLog({ level: 'info', scope: 'adfilter', message: adTip.value, extra: { playUrl: playUrl.value, ruleId } });
}

async function play(url: string) {
  const video = videoRef.value!;
  destroyHls();
  const isM3u8 = /\.m3u8(\?|#|$)/i.test(probeUrl(url)) || /m3u8/i.test(url);
  const adFilter = setting.data.player.adFilter !== false;
  // 开了去广告时优先用 hls.js（Safari 原生 HLS 没法改写清单）
  if (isM3u8 && (adFilter || !video.canPlayType('application/vnd.apple.mpegurl'))) {
    const { default: HlsLib } = await import('hls.js');
    if (HlsLib.isSupported()) {
      adReported = 0;
      hls = new HlsLib({
        maxBufferLength: 60,
        ...(adFilter ? { pLoader: createAdFilterLoader(HlsLib, setting.data.player.adPatterns || '', onAdsFiltered) as any } : {})
      });
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
      hls.on(HlsLib.Events.MANIFEST_PARSED, () => {
        readHlsTracks();
        currentQuality.value = -1;
        currentAudio.value = hls?.audioTrack ?? -1;
      });
      hls.on(HlsLib.Events.AUDIO_TRACKS_UPDATED, () => readHlsTracks());
      hls.on(HlsLib.Events.LEVEL_SWITCHED, (_e, data) => {
        if (currentQuality.value === -1) {
          // 自动模式下把实际选中的码率反映到界面上
          const lv = qualities.value[data.level];
          if (lv) currentQuality.value = -2;
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
  if (!noCache) autoRetried = false;
  loading.value = true;

  // 磁力在线播放：地址是服务端的边下边播流，不需要走规则解析
  if (isTorrent) {
    playUrl.value = torrentPlayUrl(torrentHash, torrentIndex);
    document.title = `${q.tName || '磁力播放'} - watchEverywhere`;
    loading.value = false;
    errMsg.value = '';
    startTorrentPolling();
    await nextTick();
    if (videoRef.value) {
      await play(playUrl.value);
      watchStall();
    }
    return;
  }

  errMsg.value = '';
  iframeMode.value = false;
  chapters.currentPath = chapterPath;

  const list = await chapters.load(ruleId, filePath);
  chapters.title = [name, current.value?.name].filter(Boolean).join(' · ');
  document.title = `${chapters.title} - watchEverywhere`;
  const initialRoad = current.value?.road ?? list[0]?.road ?? '';
  road.value = isBadRoad(initialRoad) ? pickBestRoad() : initialRoad;
  nextTick(() => episodesRef.value?.querySelector('.active')?.scrollIntoView({ block: 'center' }));

  const res = await getContent({ ruleId, filePath, chapterPath, noCache });
  loading.value = false;
  const url = res.code === 0 ? String(Array.isArray(res.data?.content) ? res.data.content[0] : res.data?.content || '') : '';
  playUrl.value = url;
  if (url) void probeRoadQuality(url);
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
  if (torrentTimer) clearInterval(torrentTimer);
  sr?.destroy();
  sr = null;
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
  const learned = loadSkipConfig(ruleId);
  const intro = resumeFrom ? 0 : Number(setting.data.player.skipIntro || learned.intro || 0);
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
let introRecorded = false;
function onSeeking() {
  const v = videoRef.value;
  if (!v || introRecorded) return;
  const d = v.duration || 0;
  if (!d) return;
  // 只认“刚开始就看的那次跳转”
  if (v.currentTime > d * 0.12) return;
  introRecorded = true;
  const samples = recordIntroSample(ruleId, d, v.currentTime);
  if (samples.length >= 3) void offerSkip('intro');
}

/** 学够了就问一次要不要记住（每条规则只问一次） */
const askedSkip = new Set<string>();
async function offerSkip(kind: 'intro' | 'outro') {
  const key = `${ruleId}:${kind}`;
  if (askedSkip.has(key)) return;
  const suggestion = suggestSkip(ruleId);
  const value = kind === 'intro' ? suggestion.intro : suggestion.outro;
  if (!value) return;
  askedSkip.add(key);
  const label = kind === 'intro' ? '片头' : '片尾';
  Modal.confirm({
    title: `记住这${label}吗？`,
    content: `你最近几次都跳过了 ${value} 秒的${label}，要不要以后自动跳过？`,
    okText: '记住',
    cancelText: '不用',
    onOk: () => {
      const cfg = loadSkipConfig(ruleId);
      saveSkipConfig(ruleId, { ...cfg, [kind]: value });
      message.success(`已记住：${label} ${value} 秒`);
    }
  });
}

function onTimeUpdate() {
  updateBuffering();
  if (subtitleCues.value.length) applySubtitleText(videoRef.value?.currentTime || 0);
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

function go(c?: ChapterItem, recordOutro = false) {
  if (!c || c.chapterPath === chapterPath) return;
  const v = videoRef.value;
  if (recordOutro && v?.duration) {
    const samples = recordOutroSample(ruleId, v.duration, v.currentTime);
    if (samples.length >= 3) void offerSkip('outro');
  }
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
  else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  else if (e.key === 'm' || e.key === 'M') video.muted = !video.muted;
  else if (e.key === 'ArrowUp') {
    e.preventDefault();
    volume.value = Math.min(1, Math.round((video.volume + 0.1) * 10) / 10);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    volume.value = Math.max(0, Math.round((video.volume - 0.1) * 10) / 10);
  }
}

/** 全屏整个播放区（视频 + 字幕 + 弹幕），否则字幕和弹幕在全屏时看不到 */
function toggleFullscreen() {
  const stage = videoRef.value?.parentElement;
  if (document.fullscreenElement) void document.exitFullscreen();
  else if (stage?.requestFullscreen) void stage.requestFullscreen();
  else videoRef.value?.requestFullscreen?.();
}

function onResize() {
  try {
    assInstance?.resize?.();
  } catch {
    /* ignore */
  }
}

useBus(EVENT_CHAPTERS_BOX).on(() => episodesRef.value?.querySelector('.active')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));

onMounted(() => {
  restoreSubtitle();
  loadRoadStat(ruleId);
  markedOk = false;
  pumpDanmaku();
  init();
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  document.addEventListener('fullscreenchange', onResize);
});
onBeforeUnmount(() => {
  saveProgress();
  destroyHls();
  destroyAss();
  if (adTipTimer) clearTimeout(adTipTimer);
  window.removeEventListener('resize', onResize);
  document.removeEventListener('fullscreenchange', onResize);
  if (danmakuTimer) clearTimeout(danmakuTimer);
  if (stallTimer) clearTimeout(stallTimer);
  if (torrentTimer) clearInterval(torrentTimer);
  sr?.destroy();
  sr = null;
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
.player__ass {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 3;
  overflow: hidden;
}
.player__adtip {
  position: absolute;
  left: 12px;
  top: 12px;
  z-index: 6;
  padding: 4px 10px;
  border-radius: 14px;
  font-size: 12px;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
  pointer-events: none;
}
.source-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px dashed var(--we-border-color, rgba(128, 128, 128, 0.25));
}
.source-item__main {
  flex: 1;
  min-width: 0;
}
.source-item__name {
  font-weight: 600;
  font-size: 13px;
}
.source-item__title {
  font-size: 12px;
}
.player__sr {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  z-index: 2;
  pointer-events: none;
}
.player__subtitle {
  position: absolute;
  left: 50%;
  bottom: 8%;
  transform: translateX(-50%);
  max-width: 86%;
  text-align: center;
  font-size: 20px;
  font-weight: 600;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
  pointer-events: none;
  z-index: 6;
  white-space: pre-wrap;
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
