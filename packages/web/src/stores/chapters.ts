import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { getChapter, type ChapterItem } from '@/api';

/** 当前打开资源的章节 / 剧集列表（阅读器与播放器共享） */
export const useChaptersStore = defineStore('chapters', () => {
  const chapters = ref<ChapterItem[]>([]);
  const key = ref('');
  const loading = ref(false);
  /** 当前正在阅读/播放的章节 */
  const currentPath = ref('');
  const title = ref('');

  async function load(ruleId: string, filePath: string, force = false) {
    const k = `${ruleId}@${filePath}`;
    if (!force && k === key.value && chapters.value.length) return chapters.value;
    loading.value = true;
    const res = await getChapter(ruleId, filePath, force);
    loading.value = false;
    chapters.value = res.code === 0 ? res.data || [] : [];
    key.value = k;
    return chapters.value;
  }

  /** 线路列表 */
  const roads = computed(() => {
    const names: string[] = [];
    for (const c of chapters.value) {
      const n = c.road || '';
      if (!names.includes(n)) names.push(n);
    }
    return names;
  });

  function current() {
    return chapters.value.find((c) => c.chapterPath === currentPath.value);
  }

  /** 同一线路内的上一个 / 下一个 */
  function sibling(offset: 1 | -1) {
    const cur = current();
    if (!cur) return undefined;
    const sameRoad = chapters.value.filter((c) => (c.road || '') === (cur.road || ''));
    const idx = sameRoad.findIndex((c) => c.chapterPath === cur.chapterPath);
    return sameRoad[idx + offset];
  }

  return { chapters, roads, loading, currentPath, title, load, current, sibling };
});
