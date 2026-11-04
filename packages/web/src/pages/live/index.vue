<template>
  <!-- 还没有直播源 -->
  <div v-if="loaded && !sources.length" class="we-page live-empty">
    <a-result
      title="还没有直播源"
      sub-title="内置 iPTV 未安装或已关闭（安装：在项目目录执行 npm run iptv:update 后重启）。也可以手动添加任意 M3U / TXT 订阅地址"
    >
      <template #icon><DesktopOutlined /></template>
      <template #extra>
        <a-button type="primary" @click="managerOpen = true">添加直播源</a-button>
      </template>
    </a-result>
    <a-modal v-model:open="managerOpen" title="直播源" :footer="null" width="640px" destroy-on-close>
      <SourceManager @changed="onSourcesChanged" />
    </a-modal>
  </div>

  <div v-else class="live">
    <!-- 播放区 -->
    <section class="live__main">
      <div class="live__stage">
        <LivePlayer v-if="playSrc" ref="playerRef" :src="playSrc" :kind="playKind" @error="onPlayError" @playing="onPlaying" />
        <div v-if="!current" class="live__mask we-muted">选择右侧频道开始观看</div>
        <div v-else-if="playLoading" class="live__mask"><a-spin /></div>
        <div v-else-if="errMsg" class="live__mask live__mask--err">
          <a-result status="warning" :title="errMsg" :sub-title="playInfo?.url">
            <template #extra>
              <a-space wrap>
                <a-button type="primary" @click="play(current, playInfo?.line ?? 0)">重试</a-button>
                <a-button v-if="playInfo && playInfo.lines > 1" @click="switchLine((playInfo.line + 1) % playInfo.lines)">换一条线路</a-button>
                <a-button v-if="playInfo?.url" @click="copy(playInfo.url)">复制地址</a-button>
              </a-space>
            </template>
          </a-result>
        </div>
      </div>

      <div v-if="current" class="live__bar">
        <div class="live__info">
          <img v-if="current.logo" :src="current.logo" class="live__info-logo" referrerpolicy="no-referrer" alt="" />
          <div class="live__info-text">
            <div class="live__info-name we-ellipsis">
              {{ current.name }}
              <span class="we-muted live__info-group">{{ current.group }}</span>
            </div>
            <div class="we-muted we-ellipsis live__info-epg">
              <template v-if="epgNow">正在播放：{{ epgNow.title }}（{{ hm(epgNow.start) }}-{{ hm(epgNow.stop) }}）</template>
              <template v-if="epgNext"> · 下一个：{{ epgNext.title }}</template>
              <template v-if="!epgNow && !epgNext">暂无节目信息</template>
            </div>
          </div>
        </div>
        <a-space wrap>
          <a-select
            v-if="playInfo && playInfo.lines > 1"
            :value="playInfo.line"
            size="small"
            style="width: 96px"
            :options="Array.from({ length: playInfo.lines }, (_, i) => ({ value: i, label: `线路 ${i + 1}` }))"
            @change="(v: any) => switchLine(Number(v))"
          />
          <a-tooltip :title="usingProxy ? '当前通过服务端转发' : '当前浏览器直连'">
            <a-tag :color="usingProxy ? 'green' : 'default'" class="live__tag" @click="toggleProxy">{{ usingProxy ? '转发' : '直连' }}</a-tag>
          </a-tooltip>
          <ExternalPlayerMenu :url="playInfo?.kind === 'unsupported' ? playInfo.url : playSrc || playInfo?.url || ''" :title="current.name" />
          <a-button size="small" @click="toggleFav(current)">
            <StarFilled v-if="isFav(current)" style="color: #fadb14" />
            <StarOutlined v-else />
          </a-button>
          <a-button size="small" title="上一个频道 (↑)" @click="step(-1)"><UpOutlined /></a-button>
          <a-button size="small" title="下一个频道 (↓)" @click="step(1)"><DownOutlined /></a-button>
        </a-space>
      </div>

      <!-- 节目单 -->
      <div v-if="current && epgList.length" ref="epgRef" class="live__epg">
        <div
          v-for="p in epgList"
          :key="p.start"
          :class="['live__epg-item', { now: p.start <= nowTs && p.stop > nowTs, past: p.stop <= nowTs }]"
        >
          <span class="live__epg-time">{{ dayLabel(p.start) }}{{ hm(p.start) }}</span>
          <span class="we-ellipsis" :title="p.desc || p.title">{{ p.title }}</span>
        </div>
      </div>
    </section>

    <!-- 频道列表 -->
    <aside class="live__side">
      <div class="live__side-head">
        <a-select
          v-model:value="sourceId"
          size="small"
          class="live__source"
          :options="sources.map((s) => ({ value: s.id, label: s.name }))"
          @change="onSourceChange"
        />
        <a-tooltip title="刷新频道列表"><a-button size="small" :loading="listLoading" @click="loadChannels(true)"><ReloadOutlined /></a-button></a-tooltip>
        <a-tooltip title="管理直播源"><a-button size="small" @click="managerOpen = true"><SettingOutlined /></a-button></a-tooltip>
      </div>
      <div v-if="source?.builtin && iptv" class="live__iptv">
        <a-badge :status="iptv.state === 'running' ? 'success' : iptv.state === 'starting' ? 'processing' : 'error'" />
        <span class="we-muted">{{ iptvText }}</span>
        <a v-if="iptv.state === 'running'" :href="iptvAdminUrl(iptv)" target="_blank" rel="noopener">频道管理</a>
      </div>
      <a-input v-model:value="keyword" size="small" allow-clear placeholder="搜索频道" class="live__search">
        <template #prefix><SearchOutlined /></template>
      </a-input>
      <div class="live__groups">
        <div :class="['we-chip', { active: group === FAV }]" @click="group = FAV">收藏 {{ favOfSource.length || '' }}</div>
        <div v-for="g in groups" :key="g.name" :class="['we-chip', { active: group === g.name }]" @click="group = g.name">
          {{ g.name }}
        </div>
      </div>
      <div ref="listRef" class="live__list">
        <div v-if="listLoading && !groups.length" class="we-center"><a-spin /></div>
        <div v-else-if="listError" class="we-center live__list-err">
          <a-result status="warning" :title="listError">
            <template #extra><a-button @click="loadChannels(true)">重试</a-button></template>
          </a-result>
        </div>
        <div v-else-if="!displayChannels.length" class="we-center we-muted">{{ group === FAV && !keyword ? '还没有收藏频道' : '没有频道' }}</div>
        <div
          v-for="c in displayChannels"
          :key="c.id"
          :data-id="c.id"
          :class="['live__ch', { active: current?.id === c.id }]"
          @click="play(c)"
        >
          <div class="live__ch-logo">
            <img v-if="c.logo" :src="c.logo" loading="lazy" referrerpolicy="no-referrer" alt="" @error="(e: any) => (e.target.style.visibility = 'hidden')" />
            <span v-else>{{ c.name.slice(0, 2) }}</span>
          </div>
          <div class="live__ch-text">
            <div class="live__ch-name we-ellipsis">{{ c.name }}</div>
            <div class="live__ch-now we-ellipsis we-muted">{{ c.now || (keyword ? c.group : '') }}</div>
          </div>
          <StarFilled v-if="isFav(c)" class="live__ch-star" />
          <span v-if="c.lines > 1" class="live__ch-lines we-muted">{{ c.lines }}</span>
        </div>
      </div>
    </aside>

    <a-modal v-model:open="managerOpen" title="直播源" :footer="null" width="640px" destroy-on-close>
      <SourceManager @changed="onSourcesChanged" />
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { message } from 'ant-design-vue';
import {
  DesktopOutlined,
  ReloadOutlined,
  SettingOutlined,
  SearchOutlined,
  StarFilled,
  StarOutlined,
  UpOutlined,
  DownOutlined
} from '@ant-design/icons-vue';
import {
  getIptvStatus,
  getLiveChannels,
  getLiveEpg,
  getLivePlay,
  getLiveSources,
  iptvAdminUrl,
  type IptvStatus,
  type LiveChannel,
  type LiveGroup,
  type LivePlayInfo,
  type LiveProgramme,
  type LiveSource,
  type StreamKind
} from '@/api';
import LivePlayer from '@/components/LivePlayer.vue';
import ExternalPlayerMenu from '@/components/ExternalPlayerMenu.vue';
import SourceManager from './SourceManager.vue';
import { readStorage, writeStorage } from '@/utils/storage';

const FAV = '__fav__';

interface FavItem {
  sourceId: string;
  id: string;
  name: string;
}

const loaded = ref(false);
const sources = ref<LiveSource[]>([]);
const sourceId = ref<string>(readStorage('we-live-source', ''));
const groups = ref<LiveGroup[]>([]);
const group = ref('');
const keyword = ref('');
const listLoading = ref(false);
const listError = ref('');
const managerOpen = ref(false);

const current = ref<LiveChannel | null>(null);
const playInfo = ref<LivePlayInfo | null>(null);
const playSrc = ref('');
const playKind = ref<StreamKind>('hls');
const usingProxy = ref(false);
const playLoading = ref(false);
const errMsg = ref('');
/** 本次播放已经尝试过的组合，避免死循环重试 */
const tried = new Set<string>();

const epgList = ref<LiveProgramme[]>([]);
const nowTs = ref(Date.now());
const epgRef = ref<HTMLElement>();
const listRef = ref<HTMLElement>();
const playerRef = ref<InstanceType<typeof LivePlayer>>();

const favs = ref<FavItem[]>(readStorage('we-live-fav', []));
watch(favs, (v) => writeStorage('we-live-fav', v), { deep: true });

const source = computed(() => sources.value.find((s) => s.id === sourceId.value));

// ---------------- 内置 iPTV 状态 ----------------
const iptv = ref<IptvStatus | null>(null);
const iptvText = computed(() => {
  const s = iptv.value;
  if (!s) return '';
  if (s.state === 'running') return `内置 iPTV 运行中${s.mode === 'external' ? '（复用已有服务）' : ''}`;
  if (s.state === 'starting') return '内置 iPTV 正在启动…';
  return s.error || '内置 iPTV 未运行';
});
let iptvPoll: number | undefined;
let pollCount = 0;

async function refreshIptv() {
  const res = await getIptvStatus();
  if (res.code !== 0) return;
  const before = iptv.value?.state;
  iptv.value = res.data;
  // 启动中轮询；刚变为运行状态时自动加载频道（最多轮询约 5 分钟）
  window.clearTimeout(iptvPoll);
  if (
    ++pollCount < 60 &&
    (res.data.state === 'starting' || (source.value?.builtin && !groups.value.length && res.data.state === 'running'))
  ) {
    iptvPoll = window.setTimeout(refreshIptv, before === 'running' ? 15000 : 5000);
  }
  if (source.value?.builtin && res.data.state === 'running' && (before !== 'running' || !groups.value.length) && !listLoading.value)
    loadChannels();
}
const allChannels = computed(() => groups.value.flatMap((g) => g.channels));
const favOfSource = computed(() => favs.value.filter((f) => f.sourceId === sourceId.value));

const displayChannels = computed(() => {
  const k = keyword.value.trim().toLowerCase();
  // 搜索时在全部分组中查找
  if (k) return allChannels.value.filter((c) => c.name.toLowerCase().includes(k));
  if (group.value === FAV) {
    const ids = new Set(favOfSource.value.map((f) => f.id));
    return allChannels.value.filter((c) => ids.has(c.id));
  }
  return groups.value.find((g) => g.name === group.value)?.channels || [];
});

const epgNow = computed(() => epgList.value.find((p) => p.start <= nowTs.value && p.stop > nowTs.value));
const epgNext = computed(() => epgList.value.find((p) => p.start > nowTs.value));

// ---------------- 直播源 / 频道 ----------------

async function loadSources() {
  const res = await getLiveSources();
  sources.value = res.data || [];
  loaded.value = true;
  if (!sources.value.some((s) => s.id === sourceId.value)) sourceId.value = sources.value[0]?.id || '';
}

async function loadChannels(force = false) {
  if (!sourceId.value) {
    groups.value = [];
    return;
  }
  listLoading.value = true;
  listError.value = '';
  const res = await getLiveChannels(sourceId.value, force);
  listLoading.value = false;
  if (res.code !== 0) {
    listError.value = res.msg || '获取频道失败';
    groups.value = [];
    return;
  }
  groups.value = res.data.groups;
  if (force) message.success(`已刷新，共 ${res.data.total} 个频道`);
  if (!group.value || (group.value !== FAV && !groups.value.some((g) => g.name === group.value))) {
    group.value = favOfSource.value.length ? FAV : groups.value[0]?.name || '';
  }
  // 恢复上次观看的频道
  if (!current.value) {
    const lastId = readStorage<string>(`we-live-last@${sourceId.value}`, '');
    const last = allChannels.value.find((c) => c.id === lastId);
    if (last) {
      group.value = last.group;
      play(last);
    }
  } else {
    const fresh = allChannels.value.find((c) => c.id === current.value!.id);
    if (fresh) current.value = fresh;
  }
}

function onSourceChange() {
  writeStorage('we-live-source', sourceId.value);
  stop();
  current.value = null;
  group.value = '';
  keyword.value = '';
  loadChannels();
  pollCount = 0;
  refreshIptv();
}

async function onSourcesChanged(id?: string) {
  const before = sourceId.value;
  await loadSources();
  if (id) sourceId.value = id;
  if (sourceId.value !== before || id) {
    managerOpen.value = false;
    onSourceChange();
  }
}

// ---------------- 播放 ----------------

function stop() {
  playSrc.value = '';
  playInfo.value = null;
  errMsg.value = '';
  epgList.value = [];
}

function applySrc(info: LivePlayInfo, viaProxy: boolean) {
  usingProxy.value = viaProxy && !!info.proxyUrl;
  playKind.value = info.kind;
  playSrc.value = usingProxy.value ? info.proxyUrl : info.url;
  tried.add(`${info.line}@${usingProxy.value}`);
}

async function play(c: LiveChannel | null, line = 0) {
  if (!c) return;
  const isNewChannel = current.value?.id !== c.id;
  current.value = c;
  if (isNewChannel) tried.clear();
  errMsg.value = '';
  playLoading.value = true;
  writeStorage(`we-live-last@${sourceId.value}`, c.id);

  const res = await getLivePlay(sourceId.value, c.id, line);
  if (current.value?.id !== c.id) return; // 已经切走了
  playLoading.value = false;
  if (res.code !== 0) {
    playSrc.value = '';
    errMsg.value = res.msg || '获取播放地址失败';
    return;
  }
  const info = res.data;
  playInfo.value = info;
  if (info.kind === 'unsupported') {
    playSrc.value = '';
    errMsg.value = '浏览器无法播放这种地址（如 rtmp / rtp / udp），可以复制到 VLC 等播放器观看';
    return;
  }
  // 相同地址重试时强制重新加载
  const prevSrc = playSrc.value;
  applySrc(info, info.proxy);
  if (prevSrc === playSrc.value) playerRef.value?.reload();
  loadEpg(c.id);
  nextTick(() => listRef.value?.querySelector(`[data-id="${c.id}"]`)?.scrollIntoView({ block: 'nearest' }));
}

function switchLine(line: number) {
  if (!current.value) return;
  tried.clear();
  play(current.value, line);
}

function toggleProxy() {
  if (!playInfo.value?.proxyUrl) return;
  errMsg.value = '';
  applySrc(playInfo.value, !usingProxy.value);
}

/** 播放失败：直连 → 转发 → 下一条线路，依次自动尝试 */
function onPlayError(msg: string) {
  const info = playInfo.value;
  if (!info || !current.value) return;
  if (!usingProxy.value && info.proxyUrl && !tried.has(`${info.line}@true`)) {
    message.info('直连失败，已改用服务端转发');
    applySrc(info, true);
    return;
  }
  for (let i = 1; i < info.lines; i++) {
    const next = (info.line + i) % info.lines;
    if (!tried.has(`${next}@${info.proxy}`) && !tried.has(`${next}@true`)) {
      message.info(`线路 ${info.line + 1} 不可用，切换到线路 ${next + 1}`);
      play(current.value, next);
      return;
    }
  }
  playSrc.value = '';
  errMsg.value = `播放失败：${msg}`;
}

function onPlaying() {
  errMsg.value = '';
}

function step(offset: 1 | -1) {
  const list = displayChannels.value;
  if (!list.length) return;
  const i = list.findIndex((c) => c.id === current.value?.id);
  const next = list[(i + offset + list.length) % list.length];
  play(next);
}

// ---------------- 节目单 ----------------

async function loadEpg(channelId: string) {
  epgList.value = [];
  const res = await getLiveEpg(sourceId.value, channelId);
  if (current.value?.id !== channelId) return;
  epgList.value = res.data?.list || [];
  await nextTick();
  epgRef.value?.querySelector('.now')?.scrollIntoView({ block: 'center' });
}

function hm(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dayLabel(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const diff = Math.round((new Date(d.toDateString()).getTime() - new Date(today.toDateString()).getTime()) / 86400000);
  return diff === 0 ? '' : diff === -1 ? '昨天 ' : diff === 1 ? '明天 ' : `${d.getMonth() + 1}/${d.getDate()} `;
}

// ---------------- 收藏 ----------------

function isFav(c: LiveChannel) {
  return favs.value.some((f) => f.sourceId === sourceId.value && f.id === c.id);
}

function toggleFav(c: LiveChannel) {
  const i = favs.value.findIndex((f) => f.sourceId === sourceId.value && f.id === c.id);
  if (i > -1) favs.value.splice(i, 1);
  else favs.value.push({ sourceId: sourceId.value, id: c.id, name: c.name });
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    message.success('已复制');
  } catch {
    message.error('复制失败');
  }
}

// ---------------- 快捷键 / 定时刷新 ----------------

function onKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || managerOpen.value) return;
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    step(-1);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    step(1);
  }
}

let clock: number | undefined;
let refreshTimer: number | undefined;

onMounted(async () => {
  window.addEventListener('keydown', onKey);
  clock = window.setInterval(() => (nowTs.value = Date.now()), 30000);
  // 每 15 分钟静默刷新一次频道「正在播放」信息
  refreshTimer = window.setInterval(async () => {
    if (!sourceId.value) return;
    const res = await getLiveChannels(sourceId.value);
    if (res.code === 0) groups.value = res.data.groups;
    if (current.value) loadEpg(current.value.id);
  }, 15 * 60 * 1000);
  await loadSources();
  await loadChannels();
  refreshIptv();
});

onBeforeUnmount(() => {
  window.clearTimeout(iptvPoll);
  window.removeEventListener('keydown', onKey);
  window.clearInterval(clock);
  window.clearInterval(refreshTimer);
});
</script>

<style scoped>
.live-empty {
  display: flex;
  align-items: center;
  justify-content: center;
}
.live-empty :deep(.anticon) {
  color: var(--we-color-primary);
}
.live {
  height: 100%;
  display: flex;
  overflow: hidden;
}

/* ---------- 播放区 ---------- */
.live__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.live__stage {
  flex: 1;
  min-height: 0;
  position: relative;
  background: #000;
}
.live__mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  padding: 20px;
  overflow: auto;
  word-break: break-all;
}
.live__mask--err {
  background: var(--we-main-background);
  color: var(--we-color-text);
}
.live__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--we-top-bar-border);
}
.live__info {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}
.live__info-logo {
  width: 54px;
  height: 32px;
  object-fit: contain;
  flex-shrink: 0;
}
.live__info-text {
  min-width: 0;
}
.live__info-name {
  font-weight: 600;
  font-size: 15px;
}
.live__info-group {
  font-weight: 400;
  font-size: 12px;
  margin-left: 6px;
}
.live__info-epg {
  font-size: 12px;
}
.live__tag {
  cursor: pointer;
  margin: 0;
}
.live__epg {
  max-height: 26%;
  min-height: 90px;
  overflow: auto;
  padding: 6px 12px 10px;
  border-top: 1px solid var(--we-top-bar-border);
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 2px 16px;
  align-content: start;
}
.live__epg-item {
  display: flex;
  gap: 10px;
  font-size: 13px;
  line-height: 26px;
  min-width: 0;
}
.live__epg-item.past {
  opacity: 0.5;
}
.live__epg-item.now {
  color: var(--we-color-primary);
  font-weight: 600;
}
.live__epg-time {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  width: 82px;
  text-align: right;
}

/* ---------- 频道列表 ---------- */
.live__side {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-left: 1px solid var(--we-top-bar-border);
  background: var(--we-left-bar-bg-secondary);
  min-height: 0;
}
.live__side-head {
  display: flex;
  gap: 6px;
}
.live__source {
  flex: 1;
  min-width: 0;
}
.live__iptv {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  min-width: 0;
}
.live__iptv > span:nth-child(2) {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.live__groups {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-height: 102px;
  overflow: auto;
  flex-shrink: 0;
}
.live__groups .we-chip {
  height: 26px;
  font-size: 12px;
  padding: 0 10px;
}
.live__list {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
.live__list-err :deep(.ant-result) {
  padding: 12px;
}
.live__ch {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
}
.live__ch:hover {
  background: var(--we-left-bar-active-bg-secondary);
}
.live__ch.active {
  background: var(--we-color-primary-bg);
  color: var(--we-color-primary);
}
.live__ch-logo {
  width: 48px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(127, 127, 127, 0.12);
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
}
.live__ch-logo img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.live__ch-text {
  flex: 1;
  min-width: 0;
}
.live__ch-name {
  font-size: 13px;
  line-height: 18px;
}
.live__ch-now {
  font-size: 11px;
  line-height: 16px;
  min-height: 16px;
}
.live__ch-star {
  color: #fadb14;
  font-size: 12px;
}
.live__ch-lines {
  font-size: 11px;
  border: 1px solid currentColor;
  border-radius: 8px;
  padding: 0 5px;
  line-height: 14px;
}

@media (max-width: 900px) {
  .live {
    flex-direction: column;
  }
  .live__main {
    flex: none;
  }
  .live__stage {
    flex: none;
    aspect-ratio: 16 / 9;
  }
  .live__epg {
    display: none;
  }
  .live__side {
    width: 100%;
    flex: 1;
    border-left: none;
    border-top: 1px solid var(--we-top-bar-border);
  }
}
</style>
