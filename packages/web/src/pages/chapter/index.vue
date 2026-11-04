<template>
  <div class="we-page chapter">
    <!-- 资源信息 -->
    <div class="chapter__info">
      <div class="chapter__cover"><CoverImage :src="info.cover" :name="info.name" /></div>
      <div class="chapter__meta">
        <h2 class="chapter__name">{{ info.name || '未命名' }}</h2>
        <div class="we-muted chapter__line">
          <a-tag v-if="rule">{{ rule.name }}</a-tag>
          <a-tag v-if="rule">{{ contentTypeLabel(rule.contentType) }}</a-tag>
          <span v-if="info.author">{{ info.author }}</span>
          <span v-if="info.chapter">· {{ info.chapter }}</span>
        </div>
        <div v-if="info.description" class="chapter__desc we-muted" :title="info.description">{{ info.description }}</div>
        <a-space wrap class="chapter__actions">
          <a-button type="primary" :disabled="!chapters.chapters.length" @click="continueRead">
            <template #icon><CaretRightOutlined /></template>
            {{ lastHistory ? `继续${actionWord}：${lastHistory.chapterName || ''}` : `开始${actionWord}` }}
          </a-button>
          <a-button @click="toggleStar">
            <template #icon><StarFilled v-if="starred" style="color: #fadb14" /><StarOutlined v-else /></template>
            {{ starred ? '已收藏' : '收藏' }}
          </a-button>
          <a-button :type="watching ? 'default' : 'dashed'" @click="toggleWatch">
            <template #icon><BellOutlined /></template>
            {{ watching ? '已追更' : '追更' }}
          </a-button>
          <a-button :loading="chapters.loading" @click="init(true)">
            <template #icon><ReloadOutlined /></template>
            刷新
          </a-button>
          <a-button v-if="reversed !== null" @click="reversed = !reversed">
            <template #icon><SwapOutlined /></template>
            {{ reversed ? '倒序' : '正序' }}
          </a-button>
        </a-space>
      </div>
    </div>

    <!-- 线路 -->
    <div v-if="chapters.roads.length > 1" class="chapter__roads">
      <span class="we-muted">线路：</span>
      <div
        v-for="r in chapters.roads"
        :key="r"
        :class="['we-chip', { active: road === r }]"
        @click="road = r"
      >
        {{ r || '默认' }}
      </div>
    </div>

    <div class="chapter__toolbar">
      <span class="we-muted">共 {{ roadChapters.length }} {{ isVideo ? '集' : '章' }}</span>
      <a-input v-model:value="filterText" size="small" placeholder="搜索章节" allow-clear class="chapter__filter">
        <template #prefix><SearchOutlined /></template>
      </a-input>
    </div>

    <div v-if="chapters.loading" class="we-center"><a-spin /></div>
    <div v-else-if="!roadChapters.length" class="we-center"><a-empty :description="errMsg || '没有获取到章节'" /></div>
    <div v-else ref="listRef" :class="['chapter__list', isVideo ? 'chapter__list--episodes' : '']">
      <div
        v-for="item in displayList"
        :key="item.road + item.chapterPath"
        :data-path="item.chapterPath"
        :title="item.name"
        :class="[
          'chapter__item we-ellipsis',
          { last: lastHistory?.chapterPath === item.chapterPath, read: readSet.has(item.chapterPath) }
        ]"
        @click="openChapter(item)"
      >
        {{ item.name || '未命名' }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  StarFilled,
  StarOutlined,
  ReloadOutlined,
  SearchOutlined,
  CaretRightOutlined,
  SwapOutlined
} from '@ant-design/icons-vue';
import { ContentType, contentTypeLabel } from '@/constants';
import { getChapterHistory, type ChapterHistory, type ChapterItem } from '@/api';
import { useChaptersStore } from '@/stores/chapters';
import { useRulesStore } from '@/stores/rules';
import { useFavoritesStore } from '@/stores/favorites';
import { useWatchStore } from '@/stores/watch';
import { useHistoryStore } from '@/stores/history';
import CoverImage from '@/components/CoverImage.vue';

const route = useRoute();
const router = useRouter();
const chapters = useChaptersStore();
const rules = useRulesStore();
const favorites = useFavoritesStore();
const watchStore = useWatchStore();
const history = useHistoryStore();

const q = route.query as Record<string, string>;
const info = {
  ruleId: q.ruleId,
  url: q.filePath,
  name: q.name || '',
  cover: q.cover || '',
  author: q.author || '',
  chapter: q.chapter || '',
  description: q.description || ''
};

const rule = computed(() => rules.findById(info.ruleId));
const isVideo = computed(() => rule.value?.contentType === ContentType.VIDEO || rule.value?.contentType === ContentType.AUDIO);
const actionWord = computed(() => (isVideo.value ? '播放' : '阅读'));
const starred = computed(() => favorites.starred(info));
const watching = computed(() => watchStore.has(info.ruleId, info.url));

const road = ref('');
const filterText = ref('');
const errMsg = ref('');
const histories = ref<ChapterHistory[]>([]);
const listRef = ref<HTMLElement>();
/** 视频默认正序；null 表示不显示排序按钮 */
const reversed = ref<boolean | null>(false);

const lastHistory = computed(() => histories.value[0]);
const readSet = computed(() => new Set(histories.value.map((h) => h.chapterPath)));

const roadChapters = computed(() => chapters.chapters.filter((c) => (c.road || '') === road.value));
const displayList = computed(() => {
  let list = roadChapters.value;
  if (filterText.value) list = list.filter((c) => c.name.toLowerCase().includes(filterText.value.toLowerCase()));
  return reversed.value ? [...list].reverse() : list;
});

async function init(force = false) {
  if (!info.ruleId || !info.url) return;
  errMsg.value = '';
  const list = await chapters.load(info.ruleId, info.url, force);
  if (!list.length) errMsg.value = '没有获取到章节，可以点击刷新重试或检查规则';
  const hres = await getChapterHistory(info.ruleId, info.url);
  histories.value = hres.data || [];
  // 选中上次的线路
  const last = histories.value[0] && list.find((c) => c.chapterPath === histories.value[0].chapterPath);
  road.value = last?.road ?? chapters.roads[0] ?? '';
  await nextTick();
  if (last) listRef.value?.querySelector(`[data-path="${CSS.escape(last.chapterPath)}"]`)?.scrollIntoView({ block: 'center' });
}

function openChapter(item: ChapterItem) {
  const h = histories.value.find((e) => e.chapterPath === item.chapterPath);
  const query = {
    ruleId: info.ruleId,
    filePath: info.url,
    chapterPath: item.chapterPath,
    name: info.name,
    percentage: String(h?.percentage ?? 0),
    currentTime: String(h?.currentTime ?? 0)
  };
  router.push({ path: isVideo.value ? '/player' : '/content', query });
}

function continueRead() {
  const last = lastHistory.value && chapters.chapters.find((c) => c.chapterPath === lastHistory.value!.chapterPath);
  openChapter(last || roadChapters.value[0] || chapters.chapters[0]);
}

function toggleStar() {
  favorites.toggle({ ...info, contentType: rule.value?.contentType });
}

async function toggleWatch() {
  const hit = watchStore.list.find((w) => w.ruleId === info.ruleId && w.url === info.url);
  if (hit) {
    await watchStore.remove(hit.id);
    message.success('已取消追更');
    return;
  }
  const res = await watchStore.add({ ...info, contentType: rule.value?.contentType });
  if (res.code !== 0) return message.error(res.msg || '追更失败');
  await watchStore.check(res.data?.id);
  message.success('已加入追更，有新集会在首页提示');
}

watch(
  () => rules.loaded,
  (v) => v && init(),
  { immediate: true }
);

onMounted(() => {
  if (info.ruleId && info.url)
    history.add({ ...info, contentType: rule.value?.contentType });
});
</script>

<style scoped>
.chapter {
  max-width: 1100px;
  margin: 0 auto;
}
.chapter__info {
  display: flex;
  gap: 18px;
  margin-bottom: 16px;
}
.chapter__cover {
  width: 132px;
  height: 184px;
  flex-shrink: 0;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
}
.chapter__meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.chapter__name {
  margin: 0;
  font-size: 22px;
  color: var(--we-color-text);
}
.chapter__line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 13px;
}
.chapter__desc {
  font-size: 13px;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.chapter__actions {
  margin-top: auto;
}
.chapter__roads {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 10px;
}
.chapter__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}
.chapter__filter {
  width: 220px;
}
.chapter__list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 6px;
  padding: 10px;
  border-radius: 10px;
  background: var(--we-chapter-bg);
}
.chapter__list--episodes {
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
}
.chapter__item {
  height: 34px;
  line-height: 34px;
  padding: 0 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--we-color-text);
}
.chapter__list--episodes .chapter__item {
  text-align: center;
  background: var(--we-color-primary-bg);
}
.chapter__item:hover {
  background: var(--we-color-primary-bg);
  color: var(--we-color-primary);
}
.chapter__item.read {
  opacity: 0.6;
}
.chapter__item.last {
  opacity: 1;
  color: var(--we-color-primary);
  font-weight: 600;
  outline: 1px solid var(--we-color-primary);
}
@media (max-width: 640px) {
  .chapter__cover {
    width: 96px;
    height: 134px;
  }
  .chapter__name {
    font-size: 18px;
  }
  .chapter__filter {
    width: 150px;
  }
}
</style>
