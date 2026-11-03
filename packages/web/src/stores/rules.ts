import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { Rule } from '@/constants';
import { getRules, updateRule } from '@/api';
import { readStorage, writeStorage } from '@/utils/storage';

export const useRulesStore = defineStore('rules', () => {
  const rows = ref<Rule[]>([]);
  const loaded = ref(false);

  /** 置顶的规则 id（仅本机） */
  const pinned = ref<string[]>(readStorage('we-rule-pinned', []));
  watch(pinned, (v) => writeStorage('we-rule-pinned', v), { deep: true });

  function pinRule(rule: Rule) {
    const idx = pinned.value.indexOf(rule.id);
    if (idx > -1) pinned.value.splice(idx, 1);
    else pinned.value.push(rule.id);
  }

  const list = computed(() =>
    [...rows.value].sort((a, b) => {
      const pa = pinned.value.includes(a.id) ? 1 : 0;
      const pb = pinned.value.includes(b.id) ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return (b.sort || 0) - (a.sort || 0);
    })
  );

  async function sync() {
    const res = await getRules();
    rows.value = res.code === 0 ? (res.data || []).map((r) => ({ ...r, extra: r.extra || {} })) : [];
    loaded.value = true;
  }

  function findById(id?: string) {
    return rows.value.find((e) => e.id === id);
  }

  async function updateRuleById(id: string, data: Partial<Rule>) {
    const res = await updateRule({ id, ...data });
    if (res.code === 0) {
      const row = rows.value.find((e) => e.id === id);
      if (row) Object.assign(row, data);
    }
  }

  return { rows, list, loaded, pinned, pinRule, sync, findById, updateRuleById };
});
