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
        <span v-if="!list.length">（没搜到，换个关键词，或者这些站点当前网络不可达）</span>
      </template>
      <template v-else>只做搜索与磁力生成，不包含离线下载 / 网盘转存</template>
    </div>

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
            <a v-if="record.detailUrl" :href="record.detailUrl" target="_blank" rel="noreferrer">详情</a>
          </a-space>
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { message } from 'ant-design-vue';
import { useRoute, useRouter } from 'vue-router';
import { resolveMagnet, searchMagnet, type MagnetItem } from '@/api';

const route = useRoute();
const router = useRouter();

const keyword = ref('');
const loading = ref(false);
const searched = ref(false);
const list = ref<MagnetItem[]>([]);
const resolving = ref('');
const sources = ref<string[]>(['mikan', 'nyaa', 'acgrip']);

const sourceOptions = [
  { value: 'mikan', label: 'Mikan' },
  { value: 'nyaa', label: 'Nyaa' },
  { value: 'acgrip', label: 'ACG.RIP' }
];

const columns = [
  { title: '标题', key: 'title', width: 520 },
  { title: '大小', key: 'size', width: 100 },
  { title: '操作', key: 'action', width: 260 }
];

async function search(reset = true) {
  const kw = keyword.value.trim();
  if (!kw) return;
  if (reset) router.replace({ query: { keyword: kw } });
  loading.value = true;
  searched.value = true;
  const res = await searchMagnet({ keyword: kw, sources: sources.value });
  loading.value = false;
  if (res.code !== 0) {
    message.error(res.msg || '搜索失败');
    list.value = [];
    return;
  }
  list.value = res.data || [];
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

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    message.success('已复制');
  } catch {
    message.warning(text);
  }
}

onMounted(() => {
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
.magnet__status {
  font-size: 12px;
  margin-bottom: 8px;
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
