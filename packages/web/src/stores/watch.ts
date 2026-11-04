import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  addWatch,
  checkWatch,
  clearWatchNew,
  getWatchList,
  removeWatch,
  updateWatch,
  type WatchItem
} from '@/api';
import { readStorage, writeStorage } from '@/utils/storage';

const BROWSER_NOTIFY_KEY = 'we-watch-browser-notify';
const NOTIFIED_KEY = 'we-watch-notified';

export function browserNotifyEnabled() {
  return readStorage(BROWSER_NOTIFY_KEY, false) && typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

export function setBrowserNotify(on: boolean) {
  writeStorage(BROWSER_NOTIFY_KEY, on);
}

/** 追更的最新进度标记（有集数用集数，否则用条目数） */
const progressMark = (w: WatchItem) => w.lastEpisode || w.lastCount || 0;

export const useWatchStore = defineStore('watch', () => {
  const list = ref<WatchItem[]>([]);
  const loading = ref(false);

  const updates = computed(() => list.value.filter((w) => w.newCount > 0));

  /** 发现有作品比上次提醒时更新了，就弹一条浏览器通知（页面开着时生效） */
  function browserNotify(rows: WatchItem[]) {
    const notified = readStorage<Record<string, number>>(NOTIFIED_KEY, {});
    const fresh: WatchItem[] = [];
    for (const w of rows) {
      const mark = progressMark(w);
      if (notified[w.id] !== undefined && mark > notified[w.id] && w.newCount > 0 && w.notify !== false) fresh.push(w);
      notified[w.id] = mark;
    }
    writeStorage(NOTIFIED_KEY, notified);
    if (!fresh.length || !browserNotifyEnabled()) return;
    try {
      const n = new Notification(fresh.length === 1 ? `${fresh[0].name} 更新了` : `${fresh.length} 部追更有更新`, {
        body: fresh
          .map((w) => `${w.name}：${w.lastEpisode ? `第 ${w.lastEpisode} 集` : `共 ${w.lastCount} 集`}${w.trackingGroup ? `（${w.trackingGroup}）` : ''}`)
          .join('\n'),
        icon: '/favicon.svg',
        tag: 'we-watch'
      });
      n.onclick = () => {
        window.focus();
        location.hash = '#/home?tab=watch';
        n.close();
      };
    } catch {
      /* 部分浏览器（如 iOS Safari 非 PWA）不支持 */
    }
  }

  async function sync() {
    const res = await getWatchList();
    list.value = res.code === 0 ? res.data || [] : [];
    if (res.code === 0) browserNotify(list.value);
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

  /** 指定追的线路（null / '' 表示自动） */
  async function setRoad(id: string, road: string | null) {
    const res = await updateWatch({ id, road });
    if (res.code === 0) await check(id);
    return res;
  }

  async function setNotify(id: string, notify: boolean) {
    const res = await updateWatch({ id, notify });
    await sync();
    return res;
  }

  return { list, loading, updates, sync, has, add, remove, check, clearNew, setRoad, setNotify };
});
