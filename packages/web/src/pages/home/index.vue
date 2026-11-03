<template>
  <div class="home">
    <aside class="home__nav">
      <div v-for="(nav, idx) in navs" :key="nav" :class="['home__nav-item', { active: active === idx }]" @click="active = idx">
        {{ nav }}
        <span class="home__count">{{ idx === 0 ? favorites.list.length : history.list.length }}</span>
      </div>
    </aside>

    <section class="we-page home__main">
      <template v-if="active === 0">
        <div v-if="!favorites.list.length" class="we-center">
          <a-empty description="还没有收藏，去搜索或发现页看看吧">
            <a-button type="primary" @click="router.push('/search')">去搜索</a-button>
          </a-empty>
        </div>
        <div v-else class="we-card-grid">
          <MediaCard
            v-for="item in favorites.list"
            :key="item.ruleId + item.url"
            :item="item"
            show-rule
            @open="open"
          />
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
  </div>
</template>

<script setup lang="ts">
import { onActivated, ref } from 'vue';
import { useRouter } from 'vue-router';
import MediaCard from '@/components/MediaCard.vue';
import { useFavoritesStore } from '@/stores/favorites';
import { useHistoryStore } from '@/stores/history';
import { useOpenResource } from '@/utils/navigate';

const router = useRouter();
const favorites = useFavoritesStore();
const history = useHistoryStore();
const open = useOpenResource();

const navs = ['收藏', '历史'];
const active = ref(0);

onActivated(() => {
  favorites.sync();
  history.sync();
});
</script>

<style scoped>
.home {
  height: 100%;
  display: flex;
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
