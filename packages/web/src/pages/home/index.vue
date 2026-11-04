<template>
  <div class="home">
    <aside class="home__nav">
      <div v-for="(nav, idx) in navs" :key="nav" :class="['home__nav-item', { active: active === idx }]" @click="active = idx">
        {{ nav }}
        <span class="home__count">{{ idx === 0 ? favorites.list.length : idx === 1 ? watch.list.length : history.list.length }}</span>
      </div>
    </aside>

    <section class="we-page home__main">
      <template v-if="active === 0">
        <div class="we-page-header" style="margin-bottom: 8px">
          <a-space wrap>
            <a-tag :color="favGroup === '' ? 'blue' : ''" style="cursor: pointer" @click="favGroup = ''">
              全部 {{ favorites.list.length }}
            </a-tag>
            <a-tag
              v-for="g in favorites.groups"
              :key="g.id"
              :color="favGroup === g.id ? 'blue' : ''"
              style="cursor: pointer"
              closable
              @close="onRemoveGroup(g.id, g.name)"
              @click="favGroup = g.id"
            >
              {{ g.name }} {{ countInGroup(g.id) }}
            </a-tag>
            <a-tag style="cursor: pointer" @click="newGroupOpen = true">+ 分组</a-tag>
          </a-space>
          <div style="flex: 1"></div>
          <a-space>
            <a-button size="small" @click="selectMode = !selectMode">{{ selectMode ? '退出多选' : '多选' }}</a-button>
          </a-space>
        </div>

        <div v-if="!favorites.list.length" class="we-center">
          <a-empty description="还没有收藏，去搜索或发现页看看吧">
            <a-button type="primary" @click="router.push('/search')">去搜索</a-button>
          </a-empty>
        </div>

        <template v-else>
          <div v-if="!favVisible.length" class="we-center"><a-empty description="这个分组还没有内容" /></div>
          <div v-else class="we-card-grid">
            <div v-for="item in favVisible" :key="item.ruleId + item.url" class="fav-cell">
              <MediaCard :item="item" show-rule @open="onCardOpen(item)" />
              <a-checkbox
                v-if="selectMode"
                class="fav-cell__check"
                :checked="isSelected(item)"
                @change="(e: any) => toggleSelect(item, e)"
              />
            </div>
          </div>
        </template>
      </template>

      <template v-else-if="active === 1">
        <div class="we-page-header" style="margin-bottom: 8px">
          <div class="we-muted">
            共 {{ watch.list.length }} 部，{{ watch.updates.length }} 部有新集
          </div>
          <div style="flex: 1"></div>
          <a-button size="small" :loading="watch.loading" @click="checkAllWatch">检查更新</a-button>
        </div>
        <div v-if="!watch.list.length" class="we-center">
          <a-empty description="还没有追更，在作品目录页点「追更」即可" />
        </div>
        <div v-else class="we-card-grid">
          <div v-for="w in watch.list" :key="w.id" class="watch-cell">
            <MediaCard
              :item="{ ruleId: w.ruleId, url: w.url, name: w.name, cover: w.cover, contentType: w.contentType }"
              show-rule
              @open="openWatch(w)"
            />
            <a-tag v-if="w.newCount" color="red" class="watch-cell__badge">+{{ w.newCount }}</a-tag>
            <div class="watch-cell__meta we-muted">
              <span>{{ w.lastCount }} 集</span>
              <a v-if="w.newCount" @click.stop="watch.clearNew(w.id)">标记已读</a>
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="we-page-header">
          <div class="we-muted">共 {{ history.list.length }} 条</div>
          <div style="flex: 1"></div>
          <a-popconfirm title="确定清空全部历史？" @confirm="history.clear()">
            <a-button size="small" :disabled="!history.list.length">清空历史</a-button>
          </a-popconfirm>
        </div>
        <div v-if="!history.list.length" class="we-center"><a-empty description="暂无浏览历史" /></div>
        <div v-else class="we-card-grid">
          <MediaCard
            v-for="item in history.list"
            :key="item.ruleId + item.url"
            :item="item"
            show-rule
            removable
            @open="open"
            @remove="history.remove"
          />
        </div>
      </template>
    </section>

    <!-- 批量操作条 -->
    <div v-if="active === 0 && selectMode && selected.length" class="fav-bar">
      <span>已选 {{ selected.length }} 项</span>
      <a-select
        v-model:value="targetGroups"
        mode="multiple"
        size="small"
        placeholder="选择分组"
        style="min-width: 200px"
        :options="favorites.groups.map((g) => ({ value: g.id, label: g.name }))"
      />
      <a-button size="small" type="primary" @click="assignSelected">加入分组</a-button>
      <a-button size="small" @click="assignSelected('set')">仅保留所选分组</a-button>
      <a-popconfirm title="批量取消收藏？" ok-text="取消收藏" @confirm="removeSelected">
        <a-button size="small" danger>取消收藏</a-button>
      </a-popconfirm>
      <a-button size="small" type="text" @click="selected = []">清空选择</a-button>
    </div>

    <a-modal v-model:open="newGroupOpen" title="新建收藏分组" ok-text="创建" @ok="createGroup">
      <a-input v-model:value="newGroupName" placeholder="例如：在看 / 想补 / 神作" @press-enter="createGroup" />
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, ref } from 'vue';
import { useRouter } from 'vue-router';
import MediaCard from '@/components/MediaCard.vue';
import { useFavoritesStore } from '@/stores/favorites';
import { useHistoryStore } from '@/stores/history';
import { useWatchStore } from '@/stores/watch';
import { useOpenResource } from '@/utils/navigate';
import { message } from 'ant-design-vue';

const router = useRouter();
const favorites = useFavoritesStore();
const history = useHistoryStore();
const watch = useWatchStore();
const open = useOpenResource();

// ---------------- 收藏分组 / 多选 ----------------
const favGroup = ref('');
const selectMode = ref(false);
const selected = ref<{ ruleId: string; url: string }[]>([]);
const targetGroups = ref<string[]>([]);
const newGroupOpen = ref(false);
const newGroupName = ref('');

const favVisible = computed(() =>
  favGroup.value ? favorites.list.filter((i) => (i.groups || []).includes(favGroup.value)) : favorites.list
);

function countInGroup(id: string) {
  return favorites.list.filter((i) => (i.groups || []).includes(id)).length;
}

function isSelected(item: { ruleId: string; url: string }) {
  return selected.value.some((s) => s.ruleId === item.ruleId && s.url === item.url);
}

function toggleSelect(item: { ruleId: string; url: string }, e: any) {
  const checked = e?.target?.checked ?? !isSelected(item);
  if (checked) selected.value.push({ ruleId: item.ruleId, url: item.url });
  else selected.value = selected.value.filter((s) => !(s.ruleId === item.ruleId && s.url === item.url));
}

function onCardOpen(item: any) {
  if (selectMode.value) {
    toggleSelect(item, { target: { checked: !isSelected(item) } });
    return;
  }
  open(item);
}

async function createGroup() {
  const name = newGroupName.value.trim();
  if (!name) return;
  const res = await favorites.saveGroup(name);
  if (res.code !== 0) return message.error(res.msg || '创建失败');
  newGroupOpen.value = false;
  newGroupName.value = '';
  message.success('已创建');
}

async function onRemoveGroup(id: string, name: string) {
  const res = await favorites.removeGroup(id);
  if (res.code !== 0) return message.error(res.msg || '删除失败');
  if (favGroup.value === id) favGroup.value = '';
  message.success(`已删除分组「${name}」`);
}

async function assignSelected(mode: 'add' | 'set' = 'add') {
  if (!targetGroups.value.length) return message.warning('先选择分组');
  const res = await favorites.assignGroups(selected.value, targetGroups.value, mode);
  if (res.code !== 0) return message.error(res.msg || '操作失败');
  message.success(`已更新 ${res.data} 项`);
}

async function removeSelected() {
  const res = await favorites.bulkRemove(selected.value);
  if (res.code !== 0) return message.error(res.msg || '操作失败');
  message.success(`已取消收藏 ${res.data} 项`);
  selected.value = [];
}

const navs = ['收藏', '追更', '历史'];
const active = ref(0);

onActivated(() => {
  favorites.sync();
  favorites.syncGroups();
  watch.sync();
  history.sync();
});

function openWatch(w: { ruleId: string; url: string; name: string; cover?: string; contentType?: number }) {
  open({ ...w, chapter: '' } as any);
}

async function checkAllWatch() {
  const res = await watch.check();
  if (res.code !== 0) return message.error(res.msg || '检查失败');
  const updates = (res.data || []).filter((r) => r.newCount > 0);
  if (updates.length) message.success(updates.map((u) => `${u.name} +${u.newCount}`).join('，'));
  else message.info('暂无更新');
}
</script>

<style scoped>
.home {
  height: 100%;
  display: flex;
}
.watch-cell {
  position: relative;
}
.watch-cell__badge {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
}
.watch-cell__meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  padding: 2px 2px 0;
}
.fav-cell {
  position: relative;
}
.fav-cell__check {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 3;
  background: rgba(0, 0, 0, 0.45);
  border-radius: 4px;
  padding: 2px 4px;
}
.fav-bar {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--we-top-bar-bg, #222);
  border: 1px solid var(--we-top-bar-border, rgba(128, 128, 128, 0.3));
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
  z-index: 20;
  font-size: 12px;
}
@media (max-width: 640px) {
  .fav-bar {
    left: 8px;
    right: 8px;
    transform: none;
    flex-wrap: wrap;
  }
}
.home__nav {
  width: 120px;
  flex-shrink: 0;
  padding: 10px;
  background: var(--we-left-bar-bg-secondary);
  border-right: 1px solid var(--we-top-bar-border);
}
.home__nav-item {
  height: 34px;
  line-height: 34px;
  padding: 0 10px;
  border-radius: 8px;
  margin-bottom: 4px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
}
.home__nav-item:hover,
.home__nav-item.active {
  background: var(--we-left-bar-active-bg-secondary);
}
.home__nav-item.active {
  color: var(--we-color-primary);
  font-weight: 600;
}
.home__count {
  font-size: 12px;
  opacity: 0.6;
}
.home__main {
  flex: 1;
}
@media (max-width: 640px) {
  .home {
    flex-direction: column;
  }
  .watch-cell {
  position: relative;
}
.watch-cell__badge {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
}
.watch-cell__meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  padding: 2px 2px 0;
}
.fav-cell {
  position: relative;
}
.fav-cell__check {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 3;
  background: rgba(0, 0, 0, 0.45);
  border-radius: 4px;
  padding: 2px 4px;
}
.fav-bar {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--we-top-bar-bg, #222);
  border: 1px solid var(--we-top-bar-border, rgba(128, 128, 128, 0.3));
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
  z-index: 20;
  font-size: 12px;
}
@media (max-width: 640px) {
  .fav-bar {
    left: 8px;
    right: 8px;
    transform: none;
    flex-wrap: wrap;
  }
}
.home__nav {
    width: 100%;
    display: flex;
    gap: 6px;
    padding: 6px 10px;
    border-right: none;
    border-bottom: 1px solid var(--we-top-bar-border);
  }
  .home__nav-item {
    margin: 0;
    gap: 6px;
  }
}
</style>
