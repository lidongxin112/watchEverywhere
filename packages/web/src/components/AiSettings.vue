<template>
  <div class="ai-set">
    <a-alert
      type="info"
      show-icon
      style="margin-bottom: 12px"
      message="支持任意 OpenAI 兼容接口。API Key 只保存在本机的 watchEverywhere 服务里，不会返回给页面。"
    />
    <a-form layout="vertical">
      <a-form-item label="服务商">
        <a-select :value="preset" :options="PRESETS.map((p) => ({ value: p.key, label: p.name }))" @change="applyPreset" />
      </a-form-item>
      <a-form-item label="接口地址（Base URL）" required>
        <a-input v-model:value="form.baseUrl" placeholder="https://api.openai.com/v1" />
      </a-form-item>
      <a-form-item label="API Key" :extra="keyExtra">
        <a-input-password v-model:value="form.apiKey" :placeholder="current?.hasKey ? `已保存 ${current.keyPreview}，留空表示不修改` : 'sk-...'" />
      </a-form-item>
      <a-form-item label="模型" required>
        <a-input v-model:value="form.model" placeholder="例如 deepseek-chat / qwen-plus / gpt-4o-mini" />
      </a-form-item>
    </a-form>
    <div class="ai-set__foot">
      <a-button v-if="current?.hasKey" danger type="text" @click="clearKey">清除已保存的 Key</a-button>
      <div style="flex: 1"></div>
      <a-button :loading="testing" @click="test">测试连接</a-button>
      <a-button type="primary" :loading="saving" @click="save">保存</a-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { message } from 'ant-design-vue';
import { getAiConfig, saveAiConfig, testAi, type AiConfigView } from '@/api';

const emit = defineEmits<{ saved: [AiConfigView] }>();

/** 默认值仅供参考，模型名以各服务商控制台为准 */
const PRESETS = [
  { key: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { key: 'qwen', name: '通义千问（阿里云百炼）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { key: 'moonshot', name: 'Kimi（Moonshot）', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { key: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { key: 'siliconflow', name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
  { key: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { key: 'ollama', name: '本地 Ollama（无需 Key）', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5' },
  { key: 'custom', name: '自定义', baseUrl: '', model: '' }
];

const current = ref<AiConfigView | null>(null);
const form = reactive({ baseUrl: '', apiKey: '', model: '' });
const saving = ref(false);
const testing = ref(false);

const preset = computed(() => PRESETS.find((p) => p.baseUrl && p.baseUrl === form.baseUrl.replace(/\/+$/, ''))?.key || 'custom');
const keyExtra = computed(() => (preset.value === 'ollama' ? '本地 Ollama 不需要 Key' : ''));

function applyPreset(key: any) {
  const p = PRESETS.find((x) => x.key === key);
  if (!p || p.key === 'custom') return;
  form.baseUrl = p.baseUrl;
  form.model = p.model;
}

async function save(quiet = false) {
  if (!form.baseUrl.trim() || !form.model.trim()) {
    message.warning('请填写接口地址和模型');
    return false;
  }
  saving.value = true;
  const res = await saveAiConfig({ baseUrl: form.baseUrl, model: form.model, apiKey: form.apiKey || undefined });
  saving.value = false;
  if (res.code !== 0) return false;
  current.value = res.data;
  form.apiKey = '';
  if (quiet !== true) {
    message.success('已保存');
    emit('saved', res.data);
  }
  return true;
}

async function test() {
  // 先保存再测，测的就是当前填写的配置
  if (!(await save(true))) return;
  testing.value = true;
  const res = await testAi();
  testing.value = false;
  if (res.code === 0) message.success(`连接成功（${res.data.model}）：${res.data.reply}`);
}

async function clearKey() {
  const res = await saveAiConfig({ baseUrl: form.baseUrl, model: form.model, clearKey: true });
  if (res.code === 0) {
    current.value = res.data;
    message.success('已清除');
  }
}

onMounted(async () => {
  const res = await getAiConfig();
  if (res.code === 0) {
    current.value = res.data;
    form.baseUrl = res.data.baseUrl;
    form.model = res.data.model;
  }
  if (!form.baseUrl) applyPreset('deepseek');
});
</script>

<style scoped>
.ai-set__foot {
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
