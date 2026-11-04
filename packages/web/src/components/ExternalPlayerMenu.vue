<template>
  <a-dropdown :disabled="!url" :trigger="['click']">
    <a-button size="small" :disabled="!url" title="用外部播放器打开">
      <template #icon><ExportOutlined /></template>
      外部播放
    </a-button>
    <template #overlay>
      <a-menu @click="onClick">
        <a-menu-item v-for="p in EXTERNAL_PLAYERS" :key="p.key">
          {{ p.name }} <span class="ext-menu__platform">{{ p.platform }}</span>
        </a-menu-item>
        <a-menu-divider />
        <a-menu-item key="__copy">复制播放地址</a-menu-item>
        <a-menu-item key="__open">在浏览器新标签打开</a-menu-item>
      </a-menu>
    </template>
  </a-dropdown>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
import { ExportOutlined } from '@ant-design/icons-vue';
import { EXTERNAL_PLAYERS, absoluteUrl, isLocalOnly, openExternal } from '@/utils/external-player';

const props = defineProps<{ url: string; title?: string }>();

async function onClick({ key }: { key: string | number }) {
  const url = absoluteUrl(props.url);
  if (key === '__copy') {
    try {
      await navigator.clipboard.writeText(url);
      message.success(isLocalOnly(url) ? '已复制（地址是 localhost，只能在本机播放）' : '已复制');
    } catch {
      message.error('复制失败');
    }
    return;
  }
  if (key === '__open') {
    window.open(url, '_blank', 'noopener');
    return;
  }
  const player = EXTERNAL_PLAYERS.find((p) => p.key === key);
  if (!player) return;
  openExternal(player, url, props.title || '');
  message.info(`正在唤起 ${player.name}，没有反应说明还没安装或未注册链接协议`);
}
</script>

<style scoped>
.ext-menu__platform {
  margin-left: 8px;
  font-size: 12px;
  opacity: 0.55;
}
</style>
