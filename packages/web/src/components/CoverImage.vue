<template>
  <div class="we-cover">
    <img v-if="src && !failed" :src="src" loading="lazy" referrerpolicy="no-referrer" alt="" @error="failed = true" />
    <div v-else class="we-cover__fallback">
      <span>{{ (name || '?').slice(0, 2) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{ src?: string; name?: string }>();
const failed = ref(false);
watch(
  () => props.src,
  () => (failed.value = false)
);
</script>

<style scoped>
.we-cover {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--we-color-primary-bg);
}
.we-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.3s ease;
}
.we-cover__fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 600;
  color: var(--we-color-primary);
  background: linear-gradient(135deg, var(--we-color-primary-bg), transparent);
}
</style>
