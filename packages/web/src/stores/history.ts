import { defineStore } from 'pinia';
import { ref } from 'vue';
import { addHistory, clearHistory, getHistory, removeHistory, type ResourceItem } from '@/api';

export const useHistoryStore = defineStore('history', () => {
  const list = ref<ResourceItem[]>([]);

  async function sync() {
    const res = await getHistory();
    list.value = res.code === 0 ? res.data || [] : [];
  }

  async function add(item: ResourceItem) {
    await addHistory(item);
  }

  async function remove(item: Pick<ResourceItem, 'ruleId' | 'url'>) {
    await removeHistory(item);
    await sync();
  }

  async function clear() {
    await clearHistory();
    await sync();
  }

  return { list, sync, add, remove, clear };
});
