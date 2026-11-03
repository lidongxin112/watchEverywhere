<template>
  <div class="rule-info" :class="{ 'rule-info--page': !props.ruleId && !inDrawer }">
    <div v-if="loading" class="we-center"><a-spin /></div>
    <template v-else>
      <div class="rule-info__head">
        <a-radio-group v-model:value="mode" button-style="solid" size="small">
          <a-radio-button value="form">表单</a-radio-button>
          <a-radio-button value="json">JSON</a-radio-button>
        </a-radio-group>
        <div style="flex: 1"></div>
        <a-radio-group v-model:value="mode" size="small">
          <a-radio-button value="search">搜索测试</a-radio-button>
          <a-radio-button value="url">URL 测试</a-radio-button>
          <a-radio-button value="text">取文本测试</a-radio-button>
        </a-radio-group>
      </div>

      <div class="rule-info__body">
        <!-- 表单 -->
        <div v-show="mode === 'form'" class="rule-info__form">
          <a-radio-group v-model:value="step" size="small" class="rule-info__steps">
            <a-radio-button v-for="s in FORM_STEPS" :key="s.value" :value="s.value">{{ s.label }}</a-radio-button>
          </a-radio-group>
          <a-form layout="vertical">
            <a-form-item v-for="item in stepItems" :key="item.prop">
              <template #label>
                <div class="rule-info__label">
                  <span>{{ item.label }}</span>
                  <span class="we-muted rule-info__prop">{{ item.prop }}</span>
                  <BugOutlined v-if="item.debug" class="rule-info__bug" title="调试此字段" @click="debugField(item)" />
                </div>
              </template>
              <a-select v-if="item.type === 'select'" v-model:value="form[item.prop]" :options="item.options" />
              <a-input-number v-else-if="item.type === 'number'" v-model:value="form[item.prop]" />
              <a-switch v-else-if="item.type === 'switch'" v-model:checked="form[item.prop]" />
              <a-textarea
                v-else-if="item.type === 'textarea'"
                v-model:value="form[item.prop]"
                :placeholder="item.placeholder"
                :auto-size="{ minRows: 2, maxRows: 10 }"
                class="rule-info__code"
              />
              <a-input v-else v-model:value="form[item.prop]" :placeholder="item.placeholder" class="rule-info__code" />
            </a-form-item>
          </a-form>
          <RuleSyntaxHelp />
        </div>

        <!-- JSON -->
        <div v-show="mode === 'json'" class="rule-info__json">
          <a-alert v-if="jsonError" type="error" :message="jsonError" show-icon style="margin-bottom: 8px" />
          <a-textarea v-model:value="jsonText" class="rule-info__code rule-info__json-editor" spellcheck="false" @blur="applyJson" />
        </div>

        <DebugSearch v-show="mode === 'search'" :rule="form" />
        <DebugUrl v-show="mode === 'url'" ref="urlRef" :rule="form" @use-body="useBody" />
        <DebugText v-show="mode === 'text'" ref="textRef" />
      </div>

      <div class="rule-info__foot">
        <a-button @click="close">返回</a-button>
        <a-button type="primary" :loading="saving" @click="submit">保存</a-button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { BugOutlined } from '@ant-design/icons-vue';
import { FORM_ITEMS, FORM_STEPS, defaultRule, type FormItem, type Rule } from '@/constants';
import { getRuleById, saveRule } from '@/api';
import DebugSearch from './DebugSearch.vue';
import DebugUrl from './DebugUrl.vue';
import DebugText from './DebugText.vue';
import RuleSyntaxHelp from './RuleSyntaxHelp.vue';

const props = defineProps<{ ruleId?: string }>();
const emit = defineEmits<{ close: [] }>();
const route = useRoute();
const router = useRouter();

/** 作为抽屉组件使用（传了 ruleId 属性，哪怕是空字符串） */
const inDrawer = props.ruleId !== undefined;
const id = computed(() => (inDrawer ? props.ruleId : (route.query.id as string)) || '');

type Mode = 'form' | 'json' | 'search' | 'url' | 'text';
const mode = ref<Mode>('form');
const step = ref(1);
const loading = ref(false);
const saving = ref(false);
const form = reactive<Rule>(defaultRule());
const jsonText = ref('');
const jsonError = ref('');
const urlRef = ref<InstanceType<typeof DebugUrl>>();
const textRef = ref<InstanceType<typeof DebugText>>();

const stepItems = computed(() => FORM_ITEMS.filter((i) => i.step === step.value));

function ruleToJson() {
  const { extra: _extra, ...rest } = form;
  return JSON.stringify(rest, null, 2);
}

watch(mode, (m, old) => {
  if (old === 'json') applyJson();
  if (m === 'json') {
    jsonText.value = ruleToJson();
    jsonError.value = '';
  }
});

function applyJson() {
  try {
    const json = JSON.parse(jsonText.value);
    if (typeof json !== 'object' || Array.isArray(json)) throw new Error('需要是一个规则对象');
    Object.assign(form, defaultRule(), { id: form.id }, json);
    jsonError.value = '';
  } catch (e: any) {
    jsonError.value = `JSON 格式错误：${e.message}`;
  }
}

function debugField(item: FormItem) {
  const value = String(form[item.prop] ?? '');
  if (/url$/i.test(item.prop) || item.prop === 'searchUrl') {
    mode.value = 'url';
    urlRef.value?.setUrl(value);
  } else {
    mode.value = 'text';
    textRef.value?.setRule(value, /list|roads/i.test(item.prop));
  }
}

function useBody(body: string) {
  mode.value = 'text';
  textRef.value?.setInput(body);
}

function close() {
  if (inDrawer) emit('close');
  else router.back();
}

async function submit() {
  if (mode.value === 'json') {
    applyJson();
    if (jsonError.value) return;
  }
  if (!form.name || !form.host) {
    message.warning('请填写名称和域名');
    mode.value = 'form';
    step.value = 1;
    return;
  }
  saving.value = true;
  const { extra: _extra, ...data } = form;
  const res = await saveRule(data.id ? data : { ...data, id: undefined as any });
  saving.value = false;
  if (res.code === 0) {
    message.success('已保存');
    close();
  }
}

onMounted(async () => {
  if (!id.value) return;
  loading.value = true;
  const res = await getRuleById(id.value);
  loading.value = false;
  if (res.code === 0) Object.assign(form, defaultRule(), res.data);
});
</script>

<style scoped>
.rule-info {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.rule-info--page {
  padding: 12px 16px;
}
.rule-info__head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.rule-info__body {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
.rule-info__steps {
  margin-bottom: 14px;
  display: flex;
  flex-wrap: wrap;
}
.rule-info__label {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rule-info__prop {
  font-size: 12px;
  font-family: ui-monospace, Menlo, monospace;
}
.rule-info__bug {
  cursor: pointer;
  color: var(--we-color-primary);
}
.rule-info__code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12.5px;
}
.rule-info__json {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.rule-info__json-editor {
  flex: 1;
  min-height: 400px;
  resize: none;
}
.rule-info__foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--we-top-bar-border);
  margin-top: 10px;
}
</style>
