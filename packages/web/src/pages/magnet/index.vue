<template>
  <div class="we-page magnet">
    <div class="magnet__bar">
      <a-input-search
        v-model:value="keyword"
        placeholder="输入番剧 / 剧集名，从 Mikan、Nyaa、ACG.RIP 搜种子"
        enter-button="搜索"
        allow-clear
        :loading="loading"
        @search="search()"
      />
      <a-space wrap>
        <a-select v-model:value="category" :options="categoryOptions" style="width: 120px" size="small" @change="onCategoryChange" />
        <a-button size="small" :loading="batchChecking" :disabled="!list.length" @click="checkAllHealth">
          批量测活{{ batchProgress ? ` ${batchProgress.done}/${batchProgress.total}` : '' }}
        </a-button>
        <a-checkbox-group v-model:value="sources" :options="sourceOptions" />
      </a-space>
    </div>

    <div class="magnet__status we-muted">
      <template v-if="loading"><a-spin size="small" /> <span>正在搜索…</span></template>
      <template v-else-if="searched">
        共 {{ list.length }} 条
        <span v-for="s0 in sourceStatus" :key="s0.name" class="magnet__src" :class="{ bad: !s0.ok }">
          {{ s0.name }}: {{ s0.ok ? s0.count + ' 条 / ' + s0.ms + 'ms' : '无结果或不可达' }}
        </span>
        <div v-if="pending && !list.length" style="margin-top: 4px">
          主站还在后台搜索（这类关键词它要十几秒），稍等一下会自动出结果…
        </div>
        <div v-else-if="!list.length" style="margin-top: 4px">{{ emptyHint }}</div>
      </template>
      <template v-else>
        只做搜索与磁力生成，不包含离线下载 / 网盘转存
        <span v-if="proxyUrl" class="magnet__src">代理 {{ proxyUrl }}</span>
        <span v-else class="magnet__src bad">未配置代理（Nyaa / 动漫花园 可能需要）</span>
      </template>
    </div>

    <a-modal v-model:open="pickOpen" title="选择要播放的文件" :footer="null" :width="560">
      <a-spin v-if="pickLoading" />
      <template v-else>
        <div v-if="pickError" class="we-muted">{{ pickError }}</div>
        <div v-for="f in pickFiles" :key="f.index" class="torrent-file">
          <div class="torrent-file__main">
            <div class="torrent-file__name" :title="f.name">{{ f.name }}</div>
            <div class="we-muted torrent-file__meta">
              {{ (f.length / 1048576).toFixed(0) }} MB · {{ f.kind }}{{ f.playable ? '' : ' · 将转封装为 MP4' }}
            </div>
          </div>
          <a-button size="small" type="primary" @click="startPlay(f)">播放</a-button>
        </div>
        <a-empty v-if="!pickFiles.length && !pickError" description="这个种子里没有视频文件" />
      </template>
    </a-modal>

    <a-table
      v-if="list.length"
      size="small"
      :data-source="list"
      :columns="columns"
      :pagination="{ pageSize: 20, showSizeChanger: false }"
      row-key="title"
      :scroll="{ x: 900 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'title'">
          <div class="magnet__title" :title="record.title">{{ record.title }}</div>
          <div class="magnet__sub we-muted">
            <a-tag>{{ record.source }}</a-tag>
            <span v-if="record.published">{{ record.published }}</span>
            <span v-if="record.seeders">· {{ record.seeders }} 做种</span>
          </div>
        </template>
        <template v-else-if="column.key === 'size'">{{ record.size || '-' }}</template>
        <template v-else-if="column.key === 'health'">
          <a-tooltip :title="healthMap[record.infohash] ? (healthMap[record.infohash].ok ? `做种 ${healthMap[record.infohash].seeders} · 下载中 ${healthMap[record.infohash].leechers}` : healthMap[record.infohash].message) : `来源统计：${record.seeders ?? '未知'} 做种`">
            <a-tag :color="tierColor[(healthMap[record.infohash]?.tier || tierOf(record)).level]">
              {{ (healthMap[record.infohash]?.tier || tierOf(record)).label }}
            </a-tag>
          </a-tooltip>
        </template>
        <template v-else-if="column.key === 'action'">
          <a-space>
            <a-button
              size="small"
              :loading="checkingHealth === record.infohash"
              :disabled="!record.infohash"
              @click="checkHealthOf(record)"
            >
              测活
            </a-button>
            <a-button v-if="record.magnet" size="small" type="primary" @click="copy(record.magnet)">复制磁力</a-button>
            <a-button v-else size="small" :loading="resolving === record.title" @click="makeMagnet(record)">
              生成磁力
            </a-button>
            <a-button v-if="record.torrentUrl" size="small" @click="copy(record.torrentUrl)">种子链接</a-button>
            <a-button
              v-if="record.magnet || record.torrentUrl"
              size="small"
              :loading="opening === record.title"
              @click="playOnline(record)"
            >
              在线看
            </a-button>
            <a v-if="record.detailUrl" :href="record.detailUrl" target="_blank" rel="noreferrer">详情</a>
          </a-space>
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { message } from 'ant-design-vue';
import { useRoute, useRouter } from 'vue-router';
import {
  checkTorrentHealth,
  checkTorrentHealthBatch,
  openTorrent,
  probeMagnetSources,
  resolveMagnet,
  searchMagnet,
  type MagnetItem,
  type MagnetSourceProbe,
  type TorrentHealth,
  type TorrentFileItem
} from '@/api';

const route = useRoute();
const router = useRouter();

const keyword = ref('');
const loading = ref(false);
const searched = ref(false);
const list = ref<MagnetItem[]>([]);
const sourceStatus = ref<{ name: string; count: number; ok: boolean; ms: number; error?: string }[]>([]);
const pending = ref(false);
const pickOpen = ref(false);
const pickLoading = ref(false);
const pickError = ref('');
const pickFiles = ref<TorrentFileItem[]>([]);
const pickHash = ref('');
const opening = ref('');
const checkingHealth = ref('');

/** 在线播放：先拿到磁力，再让服务端打开种子列文件 */
async function playOnline(row: MagnetItem) {
  opening.value = row.title;
  pickOpen.value = true;
  pickLoading.value = true;
  pickError.value = '';
  pickFiles.value = [];
  try {
    let magnet = row.magnet;
    if (!magnet && row.torrentUrl) {
      const rv = await resolveMagnet({ torrentUrl: row.torrentUrl, title: row.title });
      if (rv.code !== 0 || !rv.data) throw new Error(rv.msg || '生成磁力失败');
      magnet = rv.data.magnet;
      row.magnet = magnet;
    }
    const res = await openTorrent(magnet);
    if (res.code !== 0 || !res.data) throw new Error(res.msg || '打开种子失败（可能没有 peer）');
    pickHash.value = res.data.infoHash;
    pickFiles.value = res.data.files.filter((f) => f.kind === 'video' || f.kind === 'audio');
    if (!pickFiles.value.length) pickError.value = '这个种子里没有可播放的音视频文件';
  } catch (e: any) {
    pickError.value = String(e?.message || e);
  } finally {
    pickLoading.value = false;
    opening.value = '';
  }
}

function startPlay(f: TorrentFileItem) {
  pickOpen.value = false;
  router.push({ path: '/player', query: { torrent: pickHash.value, tIndex: String(f.index), tName: f.name } });
}
let retryTimer: number | null = null;
const resolving = ref('');
const category = ref('all');
const categoryOptions = [
  { value: 'all', label: '全部类型' },
  { value: 'anime', label: '动漫' },
  { value: 'movie', label: '电影' },
  { value: 'tv', label: '电视剧' },
  { value: 'variety', label: '综艺' },
  { value: 'music', label: '音乐' },
  { value: 'book', label: '电子书' },
  { value: 'comic', label: '漫画' }
];
const sources = ref<string[]>([]);
const probes = ref<MagnetSourceProbe[]>([]);
const proxyUrl = ref('');

const allSourceKeys = [
  { key: 'mikan', name: 'Mikan' },
  { key: 'nyaa', name: 'Nyaa' },
  { key: 'dmhy', name: '动漫花园' },
  { key: 'sukebei', name: 'Sukebei' },
  { key: 'acgrip', name: 'ACG.RIP' },
  { key: 'apibay', name: 'TPB' },
  { key: 'csv', name: 'Torrents-CSV' }
];

const sourceOptions = computed(() =>
  allSourceKeys.map((s0) => {
    const probe = probes.value.find((p) => p.key === s0.key);
    const ok = !probe || probe.direct || probe.viaProxy;
    return { value: s0.key, label: ok ? s0.name : `${s0.name}（不可达）` };
  })
);

/** 换类型时清掉手动勾选，交回服务端按类型选源 */
function onCategoryChange() {
  sources.value = [];
  if (keyword.value.trim()) void search(false);
}

const columns = [
  { title: '标题', key: 'title', width: 460 },
  { title: '大小', key: 'size', width: 96 },
  { title: '健康', key: 'health', width: 96 },
  { title: '操作', key: 'action', width: 300 }
];

/** 按做种数分档（用来源给的数据，不发请求） */
function tierOf(item: MagnetItem) {
  const s0 = Number(item.seeders);
  if (!Number.isFinite(s0) || item.seeders === undefined) return { level: 'unknown', label: '未知' };
  if (s0 >= 50) return { level: 'good', label: '优' };
  if (s0 >= 10) return { level: 'ok', label: '良' };
  if (s0 >= 1) return { level: 'bad', label: '差' };
  return { level: 'dead', label: '无种子' };
}

const tierColor: Record<string, string> = { good: 'green', ok: 'blue', bad: 'orange', dead: 'red', unknown: 'default' };
const healthMap = ref<Record<string, TorrentHealth>>({});

const batchChecking = ref(false);
const batchProgress = ref<{ done: number; total: number } | null>(null);

/** 批量测活：当前页（或全部结果，最多 60 条）一次测完 */
async function checkAllHealth() {
  const targets = list.value.filter((x) => x.infohash).slice(0, 60);
  if (!targets.length) return message.warning('没有可测活的种子');
  batchChecking.value = true;
  batchProgress.value = { done: 0, total: targets.length };
  const chunk = 5;
  try {
    for (let i = 0; i < targets.length; i += chunk) {
      const part = targets.slice(i, i + chunk);
      const res = await checkTorrentHealthBatch(
        part.map((x) => ({ infohash: x.infohash, magnet: x.magnet })),
        4
      );
      if (res.code === 0 && res.data) {
        healthMap.value = { ...healthMap.value, ...res.data };
      }
      batchProgress.value = { done: Math.min(i + chunk, targets.length), total: targets.length };
    }
    const rows = Object.values(healthMap.value);
    const alive = rows.filter((r) => r.ok && r.seeders > 0).length;
    if (alive) message.success(`测活完成：${alive}/${targets.length} 有做种`);
    else message.warning('测活完成：所有 tracker 都不可达（网络可能拦了 P2P）');
  } finally {
    batchChecking.value = false;
    batchProgress.value = null;
  }
}

/** 深度测活：问 tracker 要真实做种数 */
async function checkHealthOf(item: MagnetItem) {
  if (!item.infohash) return message.warning('这条没有 infohash');
  const key = item.infohash;
  checkingHealth.value = key;
  const res = await checkTorrentHealth({ infohash: key, magnet: item.magnet });
  checkingHealth.value = '';
  if (res.code !== 0 || !res.data) return message.error(res.msg || '测活失败');
  healthMap.value = { ...healthMap.value, [key]: res.data };
  if (res.data.ok) message.success(`做种 ${res.data.seeders} · 下载中 ${res.data.leechers} · 完成 ${res.data.completed}`);
  else message.warning(res.data.message || 'tracker 不可达');
}

const emptyHint = computed(() => {
  if (list.value.length) return '';
  const tried = sourceStatus.value.map((s0) => s0.name).join('、') || '所选站点';
  return `没搜到。已尝试：${tried}。可以换个关键词（日文原名命中率更高，例如「鬼滅の刃」），或在设置里错开时间再试。`;
});

async function search(reset = true, silent = false) {
  const kw = keyword.value.trim();
  if (!kw) return;
  if (reset) router.replace({ query: { keyword: kw } });
  if (!silent) loading.value = true;
  searched.value = true;
  const res = await searchMagnet({
    keyword: kw,
    category: category.value,
    ...(sources.value.length ? { sources: sources.value } : {})
  });
  loading.value = false;
  if (res.code !== 0) {
    message.error(res.msg || '搜索失败');
    list.value = [];
    return;
  }
  list.value = res.data?.items || [];
  sourceStatus.value = res.data?.sources || [];
  pending.value = !!(res.data?.pending || res.data?.pendingOther);
  if (retryTimer) clearTimeout(retryTimer);
  if (pending.value) {
    // 后台补搜完成后自动再拉一次（最多两次）
    retryTimer = window.setTimeout(() => {
      if (pending.value) void search(false, true);
    }, 9000);
  }
}

async function makeMagnet(row: MagnetItem) {
  if (!row.torrentUrl) return;
  resolving.value = row.title;
  const res = await resolveMagnet({ torrentUrl: row.torrentUrl, title: row.title });
  resolving.value = '';
  if (res.code !== 0 || !res.data) return message.error(res.msg || '生成失败');
  row.magnet = res.data.magnet;
  row.infohash = res.data.infohash;
  await copy(row.magnet);
}

async function loadProbes() {
  const res = await probeMagnetSources();
  if (res.code === 0 && res.data) {
    probes.value = res.data.sources || [];
    proxyUrl.value = res.data.proxy || '';
  }
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    message.success('已复制');
  } catch {
    message.warning(text);
  }
}

onMounted(() => {
  void loadProbes();
  const kw = typeof route.query.keyword === 'string' ? route.query.keyword : '';
  if (kw) {
    keyword.value = kw;
    void search(false);
  }
});
</script>

<style scoped>
.magnet {
  padding: 12px 16px;
}
.magnet__bar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}
.magnet__src {
  margin-left: 10px;
  padding: 0 6px;
  border-radius: 4px;
  background: rgba(64, 184, 131, 0.15);
}
.magnet__src.bad {
  background: rgba(255, 77, 79, 0.15);
  color: #ff7875;
}
.magnet__status {
  font-size: 12px;
  margin-bottom: 8px;
}
.torrent-file {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px dashed var(--we-border-color, rgba(128, 128, 128, 0.25));
}
.torrent-file__main {
  flex: 1;
  min-width: 0;
}
.torrent-file__name {
  font-size: 13px;
  word-break: break-all;
}
.torrent-file__meta {
  font-size: 12px;
}
.magnet__title {
  font-size: 13px;
  line-height: 1.5;
  word-break: break-all;
}
.magnet__sub {
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}
</style>
