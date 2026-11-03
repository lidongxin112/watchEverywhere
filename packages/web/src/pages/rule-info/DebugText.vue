<template>
  <div class="dbg">
    <a-form layout="vertical">
      <a-form-item label="输入文本（HTML / JSON / 任意文本）">
        <a-textarea v-model:value="inputText" :auto-size="{ minRows: 6, maxRows: 14 }" class="dbg__code" />
      </a-form-item>
      <a-form-item label="规则">
        <a-input v-model:value="ruleText" class="dbg__code" placeholder="例如：.list li@text  /  $.data[*].name  /  //a/@href  /  @js:result.length" />
      </a-form-item>
      <a-form-item>
        <a-space>
          <a-switch v-model:checked="isArray" />
          <span>按列表取元素（getElements）</span>
        </a-space>
      </a-form-item>
    </a-form>
    <a-button type="primary" :loading="loading" @click="run">执行</a-button>
    <div v-if="output" class="dbg__block">
      <div class="dbg__title">结果 <span v-if="count >= 0" class="we-muted">（{{ count }} 项）</span></div>
      <pre class="dbg__pre">{{ output }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { analyzerText } from '@/api';

const inputText = ref('');
const ruleText = ref('');
const isArray = ref(false);
const loading = ref(false);
const output = ref('');
const count = ref(-1);

async function run() {
  loading.value = true;
  output.value = '';
  count.value = -1;
  const res = await analyzerText({ inputText: inputText.value, ruleText: ruleText.value, isArray: isArray.value });
  loading.value = false;
  if (res.code !== 0) {
    output.value = res.msg;
    return;
  }
  if (Array.isArray(res.data)) count.value = res.data.length;
  output.value = typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);
}

defineExpose({
  setRule(rule: string, arr: boolean) {
    ruleText.value = rule;
    isArray.value = arr;
  },
  setInput(text: string) {
    inputText.value = text;
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
  max-height: 50vh;
  overflow: auto;
}
</style>
