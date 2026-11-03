<template>
  <RuleEmpty v-if="rules.loaded && !rules.list.length" />
  <div v-else class="we-page search">
    <div class="search__bar">
      <a-input-group compact class="search__group">
        <a-select v-model:value="contentType" class="search__type" :options="typeOptions" />
        <a-input-search
          v-model:value="keyword"
          placeholder="输入关键词，回车搜索"
          enter-button="搜索"
          allow-clear
          :loading="loading"
          class="search__input"
          @search="onSearch()"
        />
      </a-input-group>
    </div>

    <div class="search__status we-muted">
      <a-switch v-if="searched && !loading && groups.length" v-model:checked="merged" size="small" checked-children="合并同名" un-checked-children="按源分组" style="margin-right: 8px" />
      <template v-if="loading">
        <a-button size="small" @click="cancel">取消</a-button>
        <a-spin size="small" />
        <span>搜索进度 {{ done }}/{{ total }}（{{ total ? Math.round((done / total) * 100) : 0 }}%）</span>
      </template>
      <template v-else-if="searched">
        <span>共 {{ total }} 个规则，{{ groups.length }} 个有结果，{{ groups.reduce((n, g) => n + g.list.length, 0) }} 条</span>
        <span v-if="failed.length">，{{ failed.length }} 个失败</span>
      </template>
      <template v-else>
        <span>当前类型可搜索的规则 {{ searchableRules.length }} 个</span>
      </template>
    </div>

    <div v-if="searched && !loading && !groups.length" class="we-center"><a-empty description="没有搜到结果" /></div>

    <!-- 合并同名：一行一个作品，展开选源 -->
    <div v-if="merged" class="search__merged">
      <div v-for="m in mergedGroups" :key="m.key" class="search__merged-item">
        <MediaCard
          :item="{ ...m.primary.item, ruleId: m.primary.rule.id, contentType: m.primary.rule.contentType }"
          @open="() => openFrom(m)"
        />
        <div class="search__merged-sources">
          <a-tag
            v-for="s in m.sources"
            :key="s.rule.id"
            :color="s.item.url === m.primary.item.url ? 'blue' : ''"
            @click="openFromSource(s)"
          >
            {{ s.rule.name }}
          </a-tag>
        </div>
      </div>
    </div>

    <div v-for="g in groups" v-show="!merged" :key="g.rule.id" class="search__group-block">
      <div class="we-section-title">
        {{ g.rule.name }}
        <span class="we-muted" style="font-weight: 400; font-size: 12px">{{ g.list.length }} 条</span>
      </div>
      <div class="search__row">
        <MediaCard
          v-for="(row, idx) in g.list"
          :key="idx"
          class="search__card"
          :item="{ ...row, ruleId: g.rule.id, contentType: g.rule.contentType }"
          @open="(item) => open(item, g.rule.id)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import pLimit from 'p-limit';
import { CONTENT_TYPES, ContentType, type Rule } from '@/constants';
import { searchByRuleId, type ResourceItem } from '@/api';
import { useRulesStore } from '@/stores/rules';
import MediaCard from '@/components/MediaCard.vue';
import RuleEmpty from '@/components/RuleEmpty.vue';
import { useOpenResource } from '@/utils/navigate';

const route = useRoute();
const router = useRouter();
const rules = useRulesStore();
const open = useOpenResource();

const typeOptions = [{ value: -1, label: '全部' }, ...CONTENT_TYPES];
const contentType = ref<number>(ContentType.VIDEO);
const keyword = ref('');
const loading = ref(false);
const searched = ref(false);
const total = ref(0);
const done = ref(0);
const groups = ref<{ rule: Rule; list: ResourceItem[] }[]>([]);
const merged = ref(localStorage.getItem('we-search-merged') === '1');

/** 同名作品合并（去掉空格/标点后比较） */
const mergedGroups = computed(() => {
  const norm = (s: string) =>
    String(s || '')
      .toLowerCase()
      .replace(/[\s\-_:：·,，.。!！?？"'“”‘’()（）[\]【】]/g, '');
  const map = new Map<string, { key: string; name: string; sources: { rule: Rule; item: ResourceItem }[] }>();
  for (const g of groups.value) {
    for (const item of g.list) {
      const key = norm(item.name);
      if (!key) continue;
      const hit = map.get(key);
      if (hit) hit.sources.push({ rule: g.rule, item });
      else map.set(key, { key, name: item.name, sources: [{ rule: g.rule, item }] });
    }
  }
  return [...map.values()]
    .map((m) => ({ ...m, primary: m.sources[0] }))
    .sort((a, b) => b.sources.length - a.sources.length);
});

function openFrom(m: { sources: { rule: Rule; item: ResourceItem }[] }) {
  openFromSource(m.sources[0]);
}

function openFromSource(s: { rule: Rule; item: ResourceItem }) {
  open({ ...s.item, ruleId: s.rule.id }, s.rule.id);
}

watch(merged, (v) => localStorage.setItem('we-search-merged', v ? '1' : '0'));
const failed = ref<string[]>([]);
let controller: AbortController | null = null;
let lastToken = '';

const searchableRules = computed(() =>
  rules.list.filter((r) => r.enableSearch && r.searchUrl && (contentType.value === -1 || r.contentType === contentType.value))
);

async function onSearch(token = String(Date.now())) {
  const k = keyword.value.trim();
  if (!k) return;
  cancel();
  lastToken = token;
  if (route.query.keyword !== k) router.replace({ query: { keyword: k, t: token } });

  controller = new AbortController();
  const signal = controller.signal;
  const list = searchableRules.value;
  groups.value = [];
  failed.value = [];
  total.value = list.length;
  done.value = 0;
  loading.value = true;
  searched.value = true;

  const limit = pLimit(8);
  await Promise.all(
    list.map((rule) =>
      limit(async () => {
        if (signal.aborted) return;
        const res = await searchByRuleId(rule.id, k, signal);
        if (signal.aborted) return;
        done.value++;
        if (res.code === 0 && res.data?.length) groups.value.push({ rule, list: res.data });
        else if (res.code !== 0) failed.value.push(rule.name);
      })
    )
  );
  if (!signal.aborted) loading.value = false;
}

function cancel() {
  controller?.abort();
  controller = null;
  loading.value = false;
}

function init() {
  const { keyword: k, t } = route.query;
  if (typeof k !== 'string' || !k) return;
  const token = String(t || '');
  if (k === keyword.value && token === lastToken) return;
  keyword.value = k;
  lastToken = token;
  // 规则还没加载完时等一下
  if (!rules.loaded) {
    const stop = watch(
      () => rules.loaded,
      (v) => {
        if (v) {
          stop();
          onSearch(token);
        }
      }
    );
    return;
  }
  onSearch(token);
}

watch(() => route.query, () => route.path === '/search' && init());
onMounted(init);
onActivated(init);
</script>

<style scoped>
.search__bar {
  max-width: 720px;
  margin: 0 auto 8px;
}
.search__group {
  display: flex !important;
}
.search__type {
  width: 96px;
}
.search__input {
  flex: 1;
}
.search__status {
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  font-size: 13px;
}
.search__merged {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(calc(var(--we-card-width) + 20px), 1fr));
  gap: 16px 12px;
  padding: 4px 0 16px;
}
.search__merged-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.search__merged-sources {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.search__merged-sources .ant-tag {
  cursor: pointer;
  margin: 0;
  font-size: 11px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.search__row {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 8px;
}
.search__card {
  width: var(--we-card-width);
  flex-shrink: 0;
}
</style>
