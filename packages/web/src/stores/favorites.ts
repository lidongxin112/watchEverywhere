import { defineStore } from 'pinia';
import { ref } from 'vue';
import { getFavorites, star as apiStar, unstar as apiUnstar, type ResourceItem } from '@/api';

export const useFavoritesStore = defineStore('favorites', () => {
  const list = ref<ResourceItem[]>([]);

  async function sync() {
    const res = await getFavorites();
    list.value = res.code === 0 ? res.data || [] : [];
  }

  function starred(item: Pick<ResourceItem, 'ruleId' | 'url'>) {
    return list.value.some((e) => e.ruleId === item.ruleId && e.url === item.url);
  }

  /** 收藏 / 取消收藏 */
  async function toggle(item: ResourceItem) {
    if (starred(item)) await apiUnstar({ ruleId: item.ruleId, url: item.url });
    else
      await apiStar({
        ruleId: item.ruleId,
        url: item.url,
        name: item.name,
        cover: item.cover,
        author: item.author,
        chapter: item.chapter,
        description: item.description,
        contentType: item.contentType
      });
    await sync();
  }

  async function unstar(item: Pick<ResourceItem, 'ruleId' | 'url'>) {
    await apiUnstar(item);
    await sync();
  }

  return { list, sync, starred, toggle, unstar };
});
