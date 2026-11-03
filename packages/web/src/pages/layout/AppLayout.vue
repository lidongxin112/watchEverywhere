<template>
  <div class="layout">
    <!-- 顶部栏 -->
    <header class="topbar">
      <div class="topbar__brand" @click="router.push('/home')">
        <img src="/favicon.svg" alt="" />
        <span class="topbar__brand-text">watchEverywhere</span>
      </div>
      <div class="topbar__center">
        <span class="topbar__icon" title="后退" @click="router.back()"><ArrowLeftOutlined /></span>
        <span class="topbar__icon" title="前进" @click="router.forward()"><ArrowRightOutlined /></span>
        <div v-if="showTitle" class="topbar__cmd" :title="chapters.title" @click="openChapters.emit()">
          <UnorderedListOutlined />
          <span class="we-ellipsis">{{ chapters.title || '目录' }}</span>
        </div>
        <div v-else class="topbar__cmd topbar__cmd--input">
          <SearchOutlined />
          <input v-model="keyword" placeholder="搜索全部规则，回车确认" @keyup.enter="doSearch" />
        </div>
      </div>
      <div class="topbar__right">
        <span class="topbar__icon" title="设置" @click="settingOpen = true"><SettingOutlined /></span>
      </div>
    </header>

    <!-- 公告 / 更新提示 -->
    <div v-if="tips.length" class="tips">
      <div class="tips__body">
        <span v-for="t in tips" :key="t.key" class="tips__item">
          <span class="tips__tag">{{ t.tag }}</span>
          <span>{{ t.text }}</span>
          <a v-if="t.url" :href="t.url" target="_blank" rel="noreferrer">查看</a>
        </span>
      </div>
      <span class="tips__close" @click="tipsDismissed = true">×</span>
    </div>

    <div class="layout__body">
      <!-- 侧边栏 -->
      <nav class="sidebar">
        <div
          v-for="nav in navs"
          :key="nav.path"
          :class="['sidebar__item', { active: isActive(nav.path) }]"
          :title="nav.title"
          @click="router.push(nav.path)"
        >
          <component :is="nav.icon" class="sidebar__icon" />
          <span class="sidebar__text">{{ nav.title }}</span>
        </div>
        <div class="sidebar__spacer"></div>
        <div class="sidebar__item sidebar__item--setting" title="设置" @click="settingOpen = true">
          <SettingOutlined class="sidebar__icon" />
          <span class="sidebar__text">设置</span>
        </div>
      </nav>

      <!-- 路由内容 -->
      <main class="layout__main">
        <RouterView v-slot="{ Component, route: r }">
          <KeepAlive>
            <component :is="Component" v-if="r.meta.keepAlive" :key="r.path" />
          </KeepAlive>
          <component :is="Component" v-if="!r.meta.keepAlive" :key="r.fullPath" />
        </RouterView>
      </main>
    </div>

    <a-drawer v-model:open="settingOpen" title="设置" placement="right" :width="420">
      <SettingPanel />
    </a-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  HomeOutlined,
  SearchOutlined,
  PlaySquareOutlined,
  DesktopOutlined,
  ReadOutlined,
  PictureOutlined,
  CustomerServiceOutlined,
  AppstoreAddOutlined,
  SettingOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  UnorderedListOutlined
} from '@ant-design/icons-vue';
import SettingPanel from '@/components/SettingPanel.vue';
import { checkAppUpdate, getAppNotices } from '@/api';
import { useRulesStore } from '@/stores/rules';
import { useFavoritesStore } from '@/stores/favorites';
import { useChaptersStore } from '@/stores/chapters';
import { useBus, EVENT_CHAPTERS_BOX } from '@/utils/bus';

const tipsDismissed = ref(sessionStorage.getItem('we-tips-dismissed') === '1');
const tips = ref<{ key: string; tag: string; text: string; url?: string }[]>([]);

/** 启动时拉一次公告 + 更新，做成顶部条 */
async function loadTips() {
  if (tipsDismissed.value) return;
  const [n, u] = await Promise.all([getAppNotices(), checkAppUpdate(false)]);
  const list: { key: string; tag: string; text: string; url?: string }[] = [];
  if (u.code === 0 && u.data?.hasUpdate) {
    list.push({ key: 'update', tag: '新版本', text: `v${u.data.latest} 已发布${u.data.notes ? '：' + u.data.notes : ''}`, url: u.data.url });
  }
  if (n.code === 0 && Array.isArray(n.data)) {
    for (const item of n.data.slice(0, 2)) list.push({ key: 'n-' + item.id, tag: '公告', text: item.title + (item.content ? '：' + item.content : ''), url: item.url });
  }
  tips.value = list;
}

watch(tipsDismissed, (v) => sessionStorage.setItem('we-tips-dismissed', v ? '1' : '0'));

const route = useRoute();
const router = useRouter();
const rules = useRulesStore();
const favorites = useFavoritesStore();
const chapters = useChaptersStore();
const openChapters = useBus(EVENT_CHAPTERS_BOX);

const navs = [
  { icon: HomeOutlined, path: '/home', title: '首页' },
  { icon: SearchOutlined, path: '/search', title: '搜索' },
  { icon: PlaySquareOutlined, path: '/category/2', title: '视频' },
  { icon: DesktopOutlined, path: '/live', title: '直播' },
  { icon: ReadOutlined, path: '/category/1', title: '小说' },
  { icon: PictureOutlined, path: '/category/0', title: '漫画' },
  { icon: CustomerServiceOutlined, path: '/category/3', title: '音频' },
  { icon: AppstoreAddOutlined, path: '/rules', title: '规则' }
];

const settingOpen = ref(false);
const keyword = ref('');
const showTitle = computed(() => ['/content', '/player'].includes(route.path));

function isActive(path: string) {
  return route.path === path || (path === '/rules' && route.path === '/rule-info');
}

function doSearch() {
  const k = keyword.value.trim();
  if (!k) return;
  router.push({ path: '/search', query: { keyword: k, t: Date.now() } });
}

watch(
  () => route.query.keyword,
  (k) => {
    if (route.path === '/search' && typeof k === 'string') keyword.value = k;
  }
);

onMounted(() => {
  loadTips();
  rules.sync();
  favorites.sync();
});
</script>

<style scoped>
.layout {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--we-main-background);
  color: var(--we-color-text);
}

/* ---------- 顶部栏 ---------- */
.topbar {
  height: var(--we-topbar-height);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 10px;
  background: var(--we-top-bar-bg);
  color: var(--we-top-bar-text);
  border-bottom: 1px solid var(--we-top-bar-border);
  font-size: 13px;
  gap: 8px;
}
.topbar__brand {
  width: 20%;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-weight: 600;
  min-width: 0;
}
.topbar__brand img {
  width: 20px;
  height: 20px;
}
.topbar__center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
}
.topbar__right {
  width: 20%;
  display: flex;
  justify-content: flex-end;
}
.topbar__icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.topbar__icon:hover {
  background: rgba(127, 127, 127, 0.2);
}
.topbar__cmd {
  margin-left: 6px;
  height: 26px;
  width: 38vw;
  max-width: 600px;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--we-cmd-border);
  background: var(--we-cmd-bg);
  cursor: pointer;
}
.topbar__cmd--input {
  cursor: text;
}
.topbar__cmd input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font-size: 13px;
}
.topbar__cmd input::placeholder {
  color: inherit;
  opacity: 0.6;
}

/* ---------- 主体 ---------- */
.tips {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  font-size: 12px;
  background: var(--we-color-primary-bg);
  border-bottom: 1px solid var(--we-border-color, rgba(128, 128, 128, 0.2));
}
.tips__body {
  flex: 1;
  display: flex;
  gap: 14px;
  overflow: hidden;
}
.tips__item {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tips__tag {
  display: inline-block;
  margin-right: 6px;
  padding: 0 6px;
  border-radius: 4px;
  background: var(--we-color-primary);
  color: #fff;
  font-size: 11px;
}
.tips__close {
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  opacity: 0.6;
}
.layout__body {
  flex: 1;
  display: flex;
  overflow: hidden;
}
.layout__main {
  flex: 1;
  overflow: hidden;
  min-width: 0;
}

/* ---------- 侧边栏 ---------- */
.sidebar {
  width: var(--we-sidebar-width);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  gap: 2px;
  background: var(--we-left-bar-bg);
  color: var(--we-left-bar-text);
  border-right: 1px solid var(--we-top-bar-border);
}
.sidebar__item {
  width: 46px;
  height: 50px;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  gap: 2px;
}
.sidebar__item:hover,
.sidebar__item.active {
  color: var(--we-color-primary);
}
.sidebar__item.active {
  background: var(--we-color-primary-bg);
}
.sidebar__icon {
  font-size: 20px;
}
.sidebar__text {
  font-size: 11px;
}
.sidebar__spacer {
  flex: 1;
}

/* ---------- 移动端：侧边栏变底部导航 ---------- */
@media (max-width: 640px) {
  .topbar__brand-text,
  .topbar__right {
    display: none;
  }
  .topbar__brand {
    width: auto;
  }
  .topbar__cmd {
    width: auto;
    flex: 1;
  }
  .layout__body {
    flex-direction: column-reverse;
  }
  .sidebar {
    width: 100%;
    flex-direction: row;
    justify-content: space-around;
    padding: 2px 4px calc(2px + env(safe-area-inset-bottom, 0px));
    border-right: none;
    border-top: 1px solid var(--we-top-bar-border);
  }
  .tips {
    flex-wrap: wrap;
    row-gap: 2px;
    padding: 6px 10px;
  }
  .tips__body {
    flex-direction: column;
    gap: 2px;
  }
  .tips__item {
    white-space: normal;
  }
  .sidebar__spacer {
    display: none;
  }
  .sidebar__item {
    width: auto;
    flex: 1;
    height: 46px;
  }
}
</style>
