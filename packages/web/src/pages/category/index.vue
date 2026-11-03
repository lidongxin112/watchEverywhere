<template>
  <RuleEmpty v-if="rules.loaded && !ruleList.length && !filterText" :description="`没有启用发现页的${typeLabel}规则`" />
  <div v-else class="category">
    <!-- 规则列表 -->
    <aside class="category__rules">
      <a-select v-if="!fixedType" v-model:value="contentType" :options="CONTENT_TYPES" size="small" class="category__type" />
      <a-input v-model:value="filterText" size="small" placeholder="过滤规则" allow-clear class="category__filter" />
      <div class="category__rule-list">
        <div
          v-for="r in displayRules"
          :key="r.id"
          :class="['category__rule', { active: r.id === ruleId }]"
          :title="r.name"
          @click="changeRule(r.id)"
        >
          <span class="we-ellipsis">{{ r.name }}</span>
          <PushpinFilled v-if="rules.pinned.includes(r.id)" class="category__pin on" @click.stop="rules.pinRule(r)" />
          <PushpinOutlined v-else class="category__pin" @click.stop="rules.pinRule(r)" />
        </div>
      </div>
    </aside>

    <!-- 分类 + 列表 -->
    <section class="category__main">
      <div class="category__tabs">
        <CategoryTabs :list="categoryList" @change="changeCategory" />
      </div>
      <div ref="listRef" class="category__list" @scroll="onScroll">
        <div v-if="loading && !list.length" class="we-center"><a-spin /></div>
        <div v-else-if="!list.length" class="we-center"><a-empty :description="errMsg || '暂无内容'" /></div>
        <template v-else>
          <div class="we-card-grid">
            <MediaCard
              v-for="(row, idx) in list"
              :key="idx"
              :item="{ ...row, ruleId, contentType }"
              @open="(item) => open(item, ruleId)"
            />
          </div>
          <div class="category__more">
            <a-spin v-if="loading" size="small" />
            <span v-else-if="noMore" class="we-muted">没有更多了</span>
            <a-button v-else size="small" @click="loadMore">加载更多</a-button>
          </div>
        </template>
      </div>

      <a-float-button-group trigger="click" type="primary" :style="{ right: '24px', bottom: '72px' }">
        <template #icon><SettingOutlined /></template>
        <a-float-button tooltip="编辑规则" @click="ruleInfoOpen = true">
          <template #icon><EditOutlined /></template>
        </a-float-button>
        <a-float-button tooltip="关闭此规则的发现页" @click="disableRule">
          <template #icon><StopOutlined /></template>
        </a-float-button>
        <a-float-button tooltip="刷新" @click="changeRule(ruleId, true)">
          <template #icon><ReloadOutlined /></template>
        </a-float-button>
      </a-float-button-group>
    </section>

    <a-drawer v-model:open="ruleInfoOpen" title="编辑规则" placement="right" width="min(960px, 100%)" destroy-on-close>
      <RuleInfo v-if="ruleInfoOpen" :rule-id="ruleId" @close="onRuleSaved" />
    </a-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onDeactivated, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { message } from 'ant-design-vue';
import { PushpinOutlined, PushpinFilled, SettingOutlined, EditOutlined, StopOutlined, ReloadOutlined } from '@ant-design/icons-vue';
import { CONTENT_TYPES, ContentType, contentTypeLabel } from '@/constants';
import { clearCache, discover, discoverMap, updateRule, type DiscoverGroup, type ResourceItem } from '@/api';
import { useRulesStore } from '@/stores/rules';
import MediaCard from '@/components/MediaCard.vue';
import CategoryTabs from '@/components/CategoryTabs.vue';
import RuleEmpty from '@/components/RuleEmpty.vue';
import RuleInfo from '@/pages/rule-info/index.vue';
import { useOpenResource } from '@/utils/navigate';

const route = useRoute();
const rules = useRulesStore();
const open = useOpenResource();

const fixedType = typeof route.params.contentType === 'string' && route.params.contentType !== '';
const contentType = ref<number>(fixedType ? Number(route.params.contentType) : ContentType.VIDEO);
const typeLabel = computed(() => contentTypeLabel(contentType.value));

const filterText = ref('');
const ruleId = ref('');
const categoryList = ref<DiscoverGroup[]>([]);
const current = ref<{ name: string; value: string } | null>(null);
const list = ref<ResourceItem[]>([]);
const page = ref(1);
const noMore = ref(false);
const loading = ref(false);
const errMsg = ref('');
const listRef = ref<HTMLElement>();
const ruleInfoOpen = ref(false);
let active = true;
let reqId = 0;

const ruleList = computed(() => rules.list.filter((r) => r.enableDiscover && r.contentType === contentType.value));
const displayRules = computed(() =>
  filterText.value ? ruleList.value.filter((r) => r.name.includes(filterText.value)) : ruleList.value
);

async function changeRule(id: string, refresh = false) {
  if (!id) return;
  if (refresh) await clearCache();
  ruleId.value = id;
  categoryList.value = [];
  list.value = [];
  current.value = null;
  errMsg.value = '';
  loading.value = true;
  const my = ++reqId;
  const res = await discoverMap(id);
  if (my !== reqId) return;
  loading.value = false;
  categoryList.value = res.data || [];
  if (res.code !== 0) errMsg.value = res.msg;
}

async function load() {
  if (!current.value) return;
  const my = ++reqId;
  loading.value = true;
  const res = await discover(ruleId.value, current.value, page.value);
  if (my !== reqId) return;
  loading.value = false;
  const rows = res.data || [];
  if (res.code !== 0) errMsg.value = res.msg;
  // 去重：有的站点不支持分页会一直返回第一页
  const exists = new Set(list.value.map((e) => e.url));
  const fresh = rows.filter((e) => !exists.has(e.url));
  list.value.push(...fresh);
  noMore.value = !fresh.length;
}

function changeCategory(row: { name: string; value?: string }) {
  if (!row.value) return;
  current.value = { name: row.name, value: row.value };
  list.value = [];
  page.value = 1;
  noMore.value = false;
  errMsg.value = '';
  listRef.value?.scrollTo({ top: 0 });
  load();
}

function loadMore() {
  if (loading.value || noMore.value) return;
  page.value++;
  load();
}

function onScroll() {
  const el = listRef.value;
  if (el && el.scrollTop + el.clientHeight > el.scrollHeight - 200) loadMore();
}

async function disableRule() {
  const idx = displayRules.value.findIndex((r) => r.id === ruleId.value);
  await updateRule({ id: ruleId.value, enableDiscover: false });
  message.success('已关闭该规则的发现页');
  const next = displayRules.value[idx + 1] || displayRules.value[idx - 1];
  await rules.sync();
  ruleId.value = '';
  if (next && next.id !== ruleId.value) changeRule(next.id);
}

async function onRuleSaved() {
  ruleInfoOpen.value = false;
  await rules.sync();
  changeRule(ruleId.value, true);
}

// 规则列表变化时，自动选中第一个
watch(
  displayRules,
  (data) => {
    if (!active) return;
    if (data.length && !data.some((r) => r.id === ruleId.value)) changeRule(data[0].id);
  },
  { immediate: true }
);

watch(contentType, () => {
  ruleId.value = '';
  categoryList.value = [];
  list.value = [];
});

onActivated(() => (active = true));
onDeactivated(() => (active = false));
</script>

<style scoped>
.category {
  height: 100%;
  display: flex;
  position: relative;
  overflow: hidden;
}
.category__rules {
  width: 160px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: var(--we-left-bar-bg-secondary);
  border-right: 1px solid var(--we-top-bar-border);
}
.category__rule-list {
  flex: 1;
  overflow: auto;
}
.category__rule {
  height: 32px;
  padding: 0 8px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 13px;
}
.category__rule > span {
  flex: 1;
}
.category__rule:hover,
.category__rule.active {
  background: var(--we-left-bar-active-bg-secondary);
}
.category__rule.active {
  color: var(--we-color-primary);
  font-weight: 600;
}
.category__pin {
  visibility: hidden;
  font-size: 12px;
}
.category__pin.on {
  visibility: visible;
  color: var(--we-color-primary);
}
.category__rule:hover .category__pin {
  visibility: visible;
}
.category__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.category__tabs {
  padding: 10px 12px 0;
}
.category__list {
  flex: 1;
  overflow: auto;
  padding: 6px 16px 16px;
}
.category__more {
  display: flex;
  justify-content: center;
  padding: 16px 0;
}
@media (max-width: 640px) {
  .category {
    flex-direction: column;
  }
  .category__rules {
    width: 100%;
    flex-direction: row;
    flex-wrap: wrap;
    border-right: none;
    border-bottom: 1px solid var(--we-top-bar-border);
  }
  .category__filter {
    display: none;
  }
  .category__rule-list {
    display: flex;
    overflow-x: auto;
    gap: 4px;
  }
  .category__rule {
    flex-shrink: 0;
  }
  .category__pin {
    display: none;
  }
}
</style>
