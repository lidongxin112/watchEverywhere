<template>
  <a-config-provider :locale="zhCN" :theme="antdTheme">
    <a-app class="we-app">
      <RouterView />
    </a-app>
  </a-config-provider>
</template>

<script setup lang="ts">
import { computed, watchEffect } from 'vue';
import { theme as antTheme } from 'ant-design-vue';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { useSettingStore } from '@/stores/setting';

dayjs.locale('zh-cn');

const settingStore = useSettingStore();

const antdTheme = computed(() => {
  const t = settingStore.theme;
  return {
    algorithm: t.dark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
    token: {
      colorPrimary: t.tokens.colorPrimary,
      borderRadius: 6,
      colorBgContainer: t.tokens.cardBg,
      colorBgElevated: t.tokens.cardBg
    }
  };
});

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

// 主题色写入 CSS 变量 --we-xxx，页面样式统一使用变量
watchEffect(() => {
  const root = document.documentElement;
  const t = settingStore.theme;
  for (const [k, v] of Object.entries(t.tokens)) root.style.setProperty(`--we-${kebab(k)}`, v);
  root.dataset.theme = t.dark ? 'dark' : 'light';
  root.style.colorScheme = t.dark ? 'dark' : 'light';
});
</script>
