<template>
  <div v-if="list.length" class="cat-row">
    <div class="cat-row__arrow" @click="scrollBy(-240)"><LeftOutlined /></div>
    <div ref="navRef" class="cat-row__items" @wheel.prevent="onWheel">
      <div v-for="item in list" :key="item.name" :class="['we-chip', { active: value === item.name }]" @click="select(item.name)">
        {{ item.name }}
      </div>
    </div>
    <div class="cat-row__arrow" @click="scrollBy(240)"><RightOutlined /></div>
  </div>
  <!-- 二级分类（递归） -->
  <CategoryTabs v-if="children.length > 1" :list="children" @change="(row: any) => emit('change', row)" />
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { LeftOutlined, RightOutlined } from '@ant-design/icons-vue';

defineOptions({ name: 'CategoryTabs' });

interface Item {
  name: string;
  value?: string;
  pairs?: Item[];
}

const props = defineProps<{ list: Item[] }>();
const emit = defineEmits<{ change: [Item] }>();

const value = ref('');
const children = ref<Item[]>([]);
const navRef = ref<HTMLElement>();

function select(name: string) {
  if (!name) return;
  value.value = name;
  const row = props.list.find((e) => e.name === name);
  if (!row) return;
  children.value = row.pairs || [];
  // 没有子分类：加载自身；只有一个子分类：直接加载该子分类
  if (children.value.length === 0) emit('change', row);
  else if (children.value.length === 1) emit('change', children.value[0]);
}

function scrollBy(x: number) {
  navRef.value?.scrollBy({ left: x, behavior: 'smooth' });
}

function onWheel(e: WheelEvent) {
  navRef.value?.scrollBy({ left: e.deltaY || e.deltaX });
}

watch(
  () => props.list,
  (v) => select(v?.[0]?.name || ''),
  { immediate: true }
);
</script>

<style scoped>
.cat-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
  user-select: none;
}
.cat-row__arrow {
  cursor: pointer;
  padding: 0 4px;
  color: var(--we-color-text-secondary);
}
.cat-row__arrow:hover {
  color: var(--we-color-primary);
}
.cat-row__items {
  flex: 1;
  display: flex;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;
}
.cat-row__items::-webkit-scrollbar {
  display: none;
}
</style>
