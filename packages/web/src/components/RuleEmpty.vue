<template>
  <div class="rule-empty">
    <a-empty :description="description">
      <a-space>
        <a-button type="primary" @click="router.push('/rules')">去添加规则</a-button>
      </a-space>
      <div class="rule-empty__tip we-muted">支持导入 any-reader / ESO 规则（JSON、eso:// 或订阅地址），也可以直接填写苹果 CMS 资源站接口生成视频规则。</div>
    </a-empty>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';

withDefaults(defineProps<{ description?: string }>(), { description: '还没有可用的规则' });
const router = useRouter();
</script>

<style scoped>
.rule-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.rule-empty__tip {
  margin-top: 14px;
  max-width: 420px;
  font-size: 12px;
}
</style>
