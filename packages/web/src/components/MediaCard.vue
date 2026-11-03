<template>
  <div class="media-card" :title="item.name" @click="emit('open', item)">
    <div class="media-card__cover">
      <CoverImage :src="item.cover" :name="item.name" />
      <span v-if="item.chapter" class="media-card__badge we-ellipsis">{{ item.chapter }}</span>
      <div v-if="showStar" class="media-card__star" :class="{ on: starred }" @click.stop="favorites.toggle(item)">
        <StarFilled v-if="starred" />
        <StarOutlined v-else />
      </div>
      <div v-if="removable" class="media-card__remove" title="移除" @click.stop="emit('remove', item)">
        <CloseOutlined />
      </div>
    </div>
    <div class="media-card__name we-ellipsis">{{ item.name }}</div>
    <div class="media-card__sub we-ellipsis we-muted">{{ subText }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { StarFilled, StarOutlined, CloseOutlined } from '@ant-design/icons-vue';
import type { ResourceItem } from '@/api';
import { useFavoritesStore } from '@/stores/favorites';
import { useRulesStore } from '@/stores/rules';
import CoverImage from './CoverImage.vue';

const props = withDefaults(defineProps<{ item: ResourceItem; showStar?: boolean; removable?: boolean; showRule?: boolean }>(), {
  showStar: true,
  removable: false,
  showRule: false
});
const emit = defineEmits<{ open: [ResourceItem]; remove: [ResourceItem] }>();

const favorites = useFavoritesStore();
const rules = useRulesStore();
const starred = computed(() => favorites.starred(props.item));
const subText = computed(() => {
  if (props.showRule) return rules.findById(props.item.ruleId)?.name || props.item.author || '';
  return props.item.author || props.item.tags?.join(' ') || '';
});
</script>

<style scoped>
.media-card {
  cursor: pointer;
  min-width: 0;
}
.media-card__cover {
  position: relative;
  height: var(--we-cover-height);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}
.media-card:hover :deep(img) {
  transform: scale(1.08);
}
.media-card__badge {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 14px 6px 4px;
  font-size: 11px;
  color: #fff;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.75));
}
.media-card__star,
.media-card__remove {
  position: absolute;
  top: 6px;
  width: 26px;
  height: 26px;
  border-radius: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  opacity: 0;
  transition: opacity 0.15s;
}
.media-card__star {
  right: 6px;
}
.media-card__remove {
  left: 6px;
}
.media-card__star.on {
  opacity: 1;
  color: #fadb14;
}
.media-card:hover .media-card__star,
.media-card:hover .media-card__remove {
  opacity: 1;
}
.media-card__name {
  font-size: 13px;
  line-height: 20px;
}
.media-card__sub {
  font-size: 12px;
  line-height: 18px;
  min-height: 18px;
}
@media (hover: none) {
  .media-card__star,
  .media-card__remove {
    opacity: 0.85;
  }
}
</style>
