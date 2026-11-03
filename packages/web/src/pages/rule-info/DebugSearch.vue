<template>
  <div class="dbg">
    <a-alert type="info" show-icon message="使用当前编辑中（未保存）的规则，依次测试 搜索 → 章节 → 正文" style="margin-bottom: 10px" />
    <a-input-search v-model:value="keyword" placeholder="搜索关键词" enter-button="搜索" :loading="loading === 'search'" @search="doSearch" />

    <div class="dbg__cols">
      <div class="dbg__col">
        <div class="dbg__title">搜索结果 {{ results.length }}</div>
        <div
          v-for="(r, i) in results"
          :key="i"
          :class="['dbg__item', { active: activeResult === i }]"
          @click="doChapter(r, i)"
        >
          <div class="we-ellipsis"><b>{{ r.name }}</b> <span class="we-muted">{{ r.author }}</span></div>
          <div class="we-ellipsis we-muted dbg__sub">{{ r.url }}</div>
        </div>
      </div>
      <div class="dbg__col">
        <div class="dbg__title">章节 {{ chapters.length }} <a-spin v-if="loading === 'chapter'" size="small" /></div>
        <div
          v-for="(c, i) in chapters"
          :key="i"
          :class="['dbg__item', { active: activeChapter === i }]"
          @click="doContent(c, i)"
        >
          <div class="we-ellipsis">
            <a-tag v-if="c.road" color="blue">{{ c.road }}</a-tag>{{ c.name }}
          </div>
          <div class="we-ellipsis we-muted dbg__sub">{{ c.url }}</div>
        </div>
      </div>
      <div class="dbg__col dbg__col--wide">
        <div class="dbg__title">正文 / 播放地址 <a-spin v-if="loading === 'content'" size="small" /></div>
        <pre class="dbg__pre">{{ contentText }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { Rule } from '@/constants';
import { getChapterByRule, getContentByRule, searchByRule, type ChapterItem, type ResourceItem } from '@/api';

const props = defineProps<{ rule: Rule }>();

const keyword = ref('');
const loading = ref<'' | 'search' | 'chapter' | 'content'>('');
const results = ref<ResourceItem[]>([]);
const chapters = ref<ChapterItem[]>([]);
const contentText = ref('');
const activeResult = ref(-1);
const activeChapter = ref(-1);

const plain = () => JSON.parse(JSON.stringify(props.rule));

async function doSearch() {
  if (!keyword.value) return;
  loading.value = 'search';
  results.value = [];
  chapters.value = [];
  contentText.value = '';
  activeResult.value = -1;
  const res = await searchByRule(plain(), keyword.value);
  loading.value = '';
  results.value = res.data || [];
}

async function doChapter(r: ResourceItem, i: number) {
  activeResult.value = i;
  activeChapter.value = -1;
  loading.value = 'chapter';
  chapters.value = [];
  contentText.value = '';
  const res = await getChapterByRule(plain(), r.url);
  loading.value = '';
  chapters.value = res.data || [];
}

async function doContent(c: ChapterItem, i: number) {
  activeChapter.value = i;
  loading.value = 'content';
  contentText.value = '';
  const res = await getContentByRule(plain(), c.url);
  loading.value = '';
  const content = res.data?.content;
  contentText.value = res.code === 0 ? (Array.isArray(content) ? content.join('\n') : String(content || '')) : res.msg;
}
</script>

<style scoped>
.dbg__cols {
  display: grid;
  grid-template-columns: 1fr 1fr 1.3fr;
  gap: 10px;
  margin-top: 10px;
}
.dbg__col {
  min-width: 0;
  max-height: 60vh;
  overflow: auto;
  border: 1px solid var(--we-top-bar-border);
  border-radius: 8px;
  padding: 8px;
}
.dbg__title {
  font-weight: 600;
  margin-bottom: 6px;
}
.dbg__item {
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.dbg__item:hover,
.dbg__item.active {
  background: var(--we-color-primary-bg);
}
.dbg__sub {
  font-size: 11px;
}
.dbg__pre {
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 12px;
  margin: 0;
}
@media (max-width: 800px) {
  .dbg__cols {
    grid-template-columns: 1fr;
  }
}
</style>
