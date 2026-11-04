import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  assignFavoriteGroups,
  bulkUnstar,
  getFavoriteGroups,
  getFavorites,
  removeFavoriteGroup,
  saveFavoriteGroup,
  star as apiStar,
  unstar as apiUnstar,
  type FavoriteGroup,
  type ResourceItem
} from '@/api';

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

  const groups = ref<FavoriteGroup[]>([]);

  async function syncGroups() {
    const res = await getFavoriteGroups();
    groups.value = res.code === 0 ? res.data || [] : [];
  }

  async function saveGroup(name: string, id?: string) {
    const res = await saveFavoriteGroup({ id, name });
    if (res.code === 0 && res.data) groups.value = res.data;
    return res;
  }

  async function removeGroup(id: string) {
    const res = await removeFavoriteGroup(id);
    if (res.code === 0 && res.data) groups.value = res.data;
    await sync();
    return res;
  }

  async function assignGroups(items: { ruleId: string; url: string }[], groupIds: string[], mode: 'add' | 'set' = 'add') {
    const res = await assignFavoriteGroups({ items, groups: groupIds, mode });
    await sync();
    return res;
  }

  async function bulkRemove(items: { ruleId: string; url: string }[]) {
    const res = await bulkUnstar(items);
    await sync();
    return res;
  }

  return { list, groups, sync, syncGroups, starred, toggle, unstar, saveGroup, removeGroup, assignGroups, bulkRemove };
});
