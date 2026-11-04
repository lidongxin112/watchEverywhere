<template>
  <div class="ai">
    <header class="ai__head">
      <div class="ai__title">
        <RobotOutlined />
        <span>AI 问片</span>
        <span v-if="config?.model" class="we-muted ai__model">{{ config.model }}</span>
      </div>
      <a-space>
        <a-button size="small" :disabled="!messages.length || busy" @click="clearChat">清空对话</a-button>
        <a-button size="small" @click="settingOpen = true"><SettingOutlined /> 设置</a-button>
      </a-space>
    </header>

    <div ref="listRef" class="ai__list">
      <!-- 未配置 -->
      <div v-if="loaded && !ready" class="ai__empty">
        <a-result title="先配置一个 AI 接口" sub-title="支持 DeepSeek、通义千问、Kimi、智谱、OpenAI 以及本地 Ollama 等 OpenAI 兼容接口">
          <template #icon><RobotOutlined /></template>
          <template #extra><a-button type="primary" @click="settingOpen = true">去配置</a-button></template>
        </a-result>
      </div>

      <!-- 欢迎 -->
      <div v-else-if="!messages.length" class="ai__empty">
        <div class="ai__welcome">
          <div class="ai__welcome-title">想看点什么？</div>
          <div class="we-muted">可以让我推荐片子、介绍剧情和演员，或者直接帮你在已添加的资源里找能看的。</div>
          <div class="ai__suggests">
            <div v-for="s in SUGGESTS" :key="s" class="we-chip ai__suggest" @click="send(s)">{{ s }}</div>
          </div>
        </div>
      </div>

      <template v-else>
        <div v-for="(m, i) in messages" :key="i" :class="['ai__msg', `ai__msg--${m.role}`]">
          <div class="ai__bubble">
            <div v-if="m.content" class="ai__text">{{ m.content }}</div>
            <div v-else-if="busy && i === messages.length - 1 && !m.tools?.length" class="ai__typing"><a-spin size="small" /> 思考中…</div>

            <!-- 搜索结果卡片 -->
            <div v-for="(t, ti) in m.tools || []" :key="ti" class="ai__tool">
              <div class="ai__tool-head we-muted">
                <SearchOutlined /> 在你的资源里搜索「{{ t.keyword }}」：{{ t.results.length ? `找到 ${t.results.length} 个` : '没有找到' }}
              </div>
              <div v-if="t.results.length" class="ai__cards">
                <MediaCard
                  v-for="(r, ri) in t.results.slice(0, 8)"
                  :key="ri"
                  class="ai__card"
                  :item="{ ruleId: r.ruleId, url: r.url, name: r.name, cover: r.cover, author: r.rule, chapter: r.chapter, contentType: r.contentType }"
                  @open="(item) => open({ ...item, author: r.author, description: r.description })"
                />
              </div>
            </div>

            <div v-if="m.error" class="ai__error"><WarningOutlined /> {{ m.error }}</div>
          </div>
        </div>
      </template>
    </div>

    <footer class="ai__input">
      <a-textarea
        v-model:value="input"
        :auto-size="{ minRows: 1, maxRows: 5 }"
        :disabled="!ready"
        placeholder="问点什么，比如：推荐几部类似《漫长的季节》的悬疑剧（Enter 发送，Shift+Enter 换行）"
        @keydown.enter.exact.prevent="send()"
      />
      <a-button v-if="busy" danger @click="stop"><StopOutlined /> 停止</a-button>
      <a-button v-else type="primary" :disabled="!ready || !input.trim()" @click="send()"><SendOutlined /> 发送</a-button>
    </footer>

    <a-modal v-model:open="settingOpen" title="AI 设置" :footer="null" width="560px" destroy-on-close>
      <AiSettings @saved="onSaved" />
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { RobotOutlined, SettingOutlined, SendOutlined, StopOutlined, SearchOutlined, WarningOutlined } from '@ant-design/icons-vue';
import { getAiConfig, streamAiChat, type AiConfigView, type AiMediaHit } from '@/api';
import MediaCard from '@/components/MediaCard.vue';
import AiSettings from '@/components/AiSettings.vue';
import { useOpenResource } from '@/utils/navigate';
import { readStorage, writeStorage } from '@/utils/storage';

interface ToolBlock {
  keyword: string;
  results: AiMediaHit[];
}
interface Msg {
  role: 'user' | 'assistant';
  content: string;
  tools?: ToolBlock[];
  error?: string;
}

const SUGGESTS = [
  '最近有什么好看的科幻电影？',
  '推荐几部类似《漫长的季节》的国产悬疑剧',
  '帮我找《三体》能看的资源',
  '周末适合全家一起看的动画电影',
  '《葬送的芙莉莲》讲的是什么，值得追吗？'
];

const STORE_KEY = 'we-ai-chat';
const open = useOpenResource();

const config = ref<AiConfigView | null>(null);
const loaded = ref(false);
const settingOpen = ref(false);
const messages = ref<Msg[]>(readStorage<Msg[]>(STORE_KEY, []));
const input = ref('');
const busy = ref(false);
const listRef = ref<HTMLElement>();
let controller: AbortController | null = null;

const ready = computed(() => !!config.value?.baseUrl && !!config.value?.model);

watch(messages, (v) => writeStorage(STORE_KEY, v.slice(-60)), { deep: true });

function scrollBottom() {
  nextTick(() => listRef.value?.scrollTo({ top: listRef.value.scrollHeight }));
}

async function send(text?: string) {
  const content = (text ?? input.value).trim();
  if (!content || busy.value || !ready.value) return;
  input.value = '';
  messages.value.push({ role: 'user', content });
  const reply: Msg = { role: 'assistant', content: '', tools: [] };
  messages.value.push(reply);
  const target = messages.value[messages.value.length - 1];
  busy.value = true;
  scrollBottom();

  controller = new AbortController();
  // 发给 AI 的历史只要文字部分；搜索结果用一句话概括，帮助它理解上下文
  const history = messages.value.slice(0, -1).map((m) => ({
    role: m.role,
    content:
      m.content +
      (m.tools?.length ? `\n（已在用户资源里搜索：${m.tools.map((t) => `${t.keyword} ${t.results.length} 个结果`).join('；')}）` : '')
  }));
  try {
    await streamAiChat(
      history,
      (e) => {
        if (e.type === 'delta') target.content += e.text;
        else if (e.type === 'tool') target.tools!.push({ keyword: e.keyword, results: e.results });
        else if (e.type === 'error') target.error = e.message;
        scrollBottom();
      },
      controller.signal
    );
  } catch (e: any) {
    if (e?.name !== 'AbortError') target.error = `请求失败：${e?.message || e}`;
  } finally {
    busy.value = false;
    controller = null;
    if (!target.content && !target.tools?.length && !target.error) target.error = '没有收到回复';
  }
}

function stop() {
  controller?.abort();
}

function clearChat() {
  messages.value = [];
}

function onSaved(c: AiConfigView) {
  config.value = c;
  settingOpen.value = false;
}

onMounted(async () => {
  const res = await getAiConfig();
  config.value = res.code === 0 ? res.data : null;
  loaded.value = true;
  scrollBottom();
});
</script>

<style scoped>
.ai {
  height: 100%;
  display: flex;
  flex-direction: column;
  max-width: 980px;
  margin: 0 auto;
  padding: 0 16px;
}
.ai__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0 8px;
}
.ai__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
}
.ai__model {
  font-size: 12px;
  font-weight: 400;
}
.ai__list {
  flex: 1;
  overflow: auto;
  padding: 8px 0 16px;
  min-height: 0;
}
.ai__empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ai__empty :deep(.ant-result-icon .anticon) {
  color: var(--we-color-primary);
}
.ai__welcome {
  text-align: center;
  max-width: 560px;
}
.ai__welcome-title {
  font-size: 22px;
  font-weight: 600;
  margin-bottom: 8px;
}
.ai__suggests {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 18px;
}
.ai__suggest {
  border: 1px solid var(--we-top-bar-border);
  height: auto;
  padding: 6px 12px;
  white-space: normal;
}
.ai__msg {
  display: flex;
  margin-bottom: 14px;
}
.ai__msg--user {
  justify-content: flex-end;
}
.ai__bubble {
  max-width: 88%;
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--we-card-bg);
  border: 1px solid var(--we-top-bar-border);
  min-width: 0;
}
.ai__msg--user .ai__bubble {
  background: var(--we-color-primary-bg);
  border-color: transparent;
}
.ai__text {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.7;
}
.ai__typing {
  display: flex;
  gap: 8px;
  align-items: center;
}
.ai__tool {
  margin-top: 10px;
}
.ai__tool-head {
  font-size: 12px;
  margin-bottom: 6px;
}
.ai__cards {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.ai__card {
  width: 104px;
  flex-shrink: 0;
  --we-cover-height: 146px;
}
.ai__error {
  margin-top: 6px;
  color: #ff4d4f;
  font-size: 13px;
}
.ai__input {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding: 10px 0 14px;
  border-top: 1px solid var(--we-top-bar-border);
}
@media (max-width: 640px) {
  .ai {
    padding: 0 10px;
  }
  .ai__bubble {
    max-width: 96%;
  }
}
</style>
