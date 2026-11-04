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
      <a-checkbox-group v-model:value="sources" :options="sourceOptions" />
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
        <template v-else-if="column.key === 'action'">
          <a-space>
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
  openTorrent,
  probeMagnetSources,
  resolveMagnet,
  searchMagnet,
  type MagnetItem,
  type MagnetSourceProbe,
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
const sources = ref<string[]>(['mikan', 'nyaa', 'dmhy']);
const probes = ref<MagnetSourceProbe[]>([]);
const proxyUrl = ref('');

const sourceOptions = computed(() =>
  (probes.value.length
    ? probes.value
    : [
        { key: 'mikan', name: 'Mikan', direct: true },
        { key: 'nyaa', name: 'Nyaa', direct: false },
        { key: 'dmhy', name: '动漫花园', direct: false },
        { key: 'sukebei', name: 'Sukebei', direct: false },
        { key: 'acgrip', name: 'ACG.RIP', direct: false }
      ]
  ).map((s0: any) => ({
    value: s0.key,
    label: `${s0.name}${s0.direct || s0.viaProxy ? '' : '（不可达）'}`
  }))
);

const columns = [
  { title: '标题', key: 'title', width: 520 },
  { title: '大小', key: 'size', width: 100 },
  { title: '操作', key: 'action', width: 260 }
];

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
  const res = await searchMagnet({ keyword: kw, sources: sources.value });
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
