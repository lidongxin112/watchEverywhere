import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { addWatch, checkWatch, clearWatchNew, getWatchList, removeWatch, type WatchItem } from '@/api';

export const useWatchStore = defineStore('watch', () => {
  const list = ref<WatchItem[]>([]);
  const loading = ref(false);

  const updates = computed(() => list.value.filter((w) => w.newCount > 0));

  async function sync() {
    const res = await getWatchList();
    list.value = res.code === 0 ? res.data || [] : [];
  }

  function has(ruleId: string, url: string) {
    return list.value.some((w) => w.ruleId === ruleId && w.url === url);
  }

  async function add(item: { ruleId: string; url: string; name: string; cover?: string; contentType?: number }) {
    const res = await addWatch(item);
    await sync();
    return res;
  }

  async function remove(id: string) {
    const res = await removeWatch(id);
    await sync();
    return res;
  }

  async function check(id?: string) {
    loading.value = true;
    const res = await checkWatch(id);
    loading.value = false;
    await sync();
    return res;
  }

  async function clearNew(id: string) {
    await clearWatchNew(id);
    await sync();
  }

  return { list, loading, updates, sync, has, add, remove, check, clearNew };
});
