<template>
  <div class="dbg">
    <a-form layout="vertical">
      <a-form-item label="请求地址（支持 $keyword / $page / $host / @js: / JSON 请求配置）">
        <a-textarea v-model:value="url" :auto-size="{ minRows: 2, maxRows: 6 }" class="dbg__code" />
      </a-form-item>
      <a-form-item label="关键词 $keyword">
        <a-input v-model:value="keyword" style="max-width: 300px" />
      </a-form-item>
    </a-form>
    <a-space>
      <a-button type="primary" :loading="loading" @click="run">发送请求</a-button>
      <a-button :disabled="!body" @click="emit('useBody', body)">用响应测试取文本</a-button>
    </a-space>
    <div v-if="params" class="dbg__block">
      <div class="dbg__title">请求参数</div>
      <pre class="dbg__pre">{{ params }}</pre>
    </div>
    <div v-if="body" class="dbg__block">
      <div class="dbg__title">响应内容（{{ body.length }} 字符）</div>
      <pre class="dbg__pre dbg__pre--body">{{ body }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { Rule } from '@/constants';
import { analyzerUrl } from '@/api';

const props = defineProps<{ rule: Rule }>();
const emit = defineEmits<{ useBody: [string] }>();

const url = ref('');
const keyword = ref('');
const loading = ref(false);
const body = ref('');
const params = ref('');

async function run() {
  loading.value = true;
  body.value = '';
  params.value = '';
  const res = await analyzerUrl({ rule: JSON.parse(JSON.stringify(props.rule)), url: url.value, keyword: keyword.value });
  loading.value = false;
  if (res.code === 0) {
    const { responseType: _r, ...p } = res.data.params || {};
    params.value = JSON.stringify(p, null, 2);
    body.value = res.data.body;
  }
}

defineExpose({
  setUrl(v: string) {
    url.value = v;
  }
});
</script>

<style scoped>
.dbg__code {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 12.5px;
}
.dbg__block {
  margin-top: 12px;
}
.dbg__title {
  font-weight: 600;
  margin-bottom: 4px;
}
.dbg__pre {
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 12px;
  padding: 8px;
  margin: 0;
  border-radius: 6px;
  border: 1px solid var(--we-top-bar-border);
}
.dbg__pre--body {
  max-height: 50vh;
  overflow: auto;
}
</style>
