<template>
  <div class="watch-set">
    <div class="watch-set__row">
      <span class="watch-set__label">检查间隔</span>
      <a-select v-model:value="cfg.watchInterval" :options="intervals" style="width: 140px" />
    </div>

    <div class="watch-set__row">
      <span class="watch-set__label">浏览器通知</span>
      <a-switch :checked="browserOn" @change="onBrowserToggle" />
      <span class="we-muted watch-set__hint">{{ browserHint }}</span>
    </div>

    <a-divider style="margin: 12px 0" orientation="left" orientation-margin="0">推送渠道</a-divider>
    <div class="we-muted watch-set__hint" style="margin-bottom: 8px">
      页面关着也能收到提醒。支持 Bark、企业微信 / 飞书 / 钉钉群机器人，以及通用 Webhook（POST JSON）。
    </div>

    <div v-for="(c, i) in cfg.channels" :key="c.id || i" class="watch-set__channel">
      <a-select v-model:value="c.type" :options="types" style="width: 120px" />
      <a-input v-model:value="c.name" placeholder="备注" style="width: 110px" />
      <a-input v-model:value="c.url" :placeholder="placeholder(c.type)" class="watch-set__url" />
      <a-switch v-model:checked="c.enabled" size="small" />
      <a-button size="small" :loading="testing === i" @click="test(c, i)">测试</a-button>
      <a-button size="small" danger @click="cfg.channels.splice(i, 1)"><DeleteOutlined /></a-button>
    </div>
    <a-button size="small" type="dashed" @click="cfg.channels.push({ type: 'bark', name: '', url: '', enabled: true })">
      <PlusOutlined /> 添加推送渠道
    </a-button>

    <div class="watch-set__foot">
      <a-button type="primary" :loading="saving" @click="save">保存</a-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { message } from 'ant-design-vue';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons-vue';
import { getNotifyConfig, saveNotifyConfig, testNotify, type NotifyChannel, type NotifyChannelType } from '@/api';
import { browserNotifyEnabled, setBrowserNotify } from '@/stores/watch';

const emit = defineEmits<{ saved: [] }>();

const cfg = reactive<{ channels: NotifyChannel[]; watchInterval: number }>({ channels: [], watchInterval: 60 });
const saving = ref(false);
const testing = ref(-1);
const browserOn = ref(browserNotifyEnabled());

const intervals = [15, 30, 60, 120, 360, 720, 1440].map((m) => ({
  value: m,
  label: m < 60 ? `${m} 分钟` : m < 1440 ? `${m / 60} 小时` : '每天'
}));

const types: { value: NotifyChannelType; label: string }[] = [
  { value: 'bark', label: 'Bark' },
  { value: 'wecom', label: '企业微信' },
  { value: 'feishu', label: '飞书' },
  { value: 'dingtalk', label: '钉钉' },
  { value: 'webhook', label: 'Webhook' }
];

function placeholder(t: NotifyChannelType) {
  switch (t) {
    case 'bark':
      return 'https://api.day.app/你的Key';
    case 'wecom':
      return 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…';
    case 'feishu':
      return 'https://open.feishu.cn/open-apis/bot/v2/hook/…';
    case 'dingtalk':
      return 'https://oapi.dingtalk.com/robot/send?access_token=…';
    default:
      return 'https://your-server/hook';
  }
}

const browserHint = computed(() => {
  if (typeof Notification === 'undefined') return '当前浏览器不支持';
  if (Notification.permission === 'denied') return '已被浏览器拒绝，需要在地址栏左侧的网站设置里允许通知';
  return '页面开着时，追更有新集会弹出系统通知';
});

async function onBrowserToggle(v: any) {
  if (!v) {
    setBrowserNotify(false);
    browserOn.value = false;
    return;
  }
  if (typeof Notification === 'undefined') return message.warning('当前浏览器不支持通知');
  const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (p !== 'granted') return message.warning('没有获得通知权限');
  setBrowserNotify(true);
  browserOn.value = true;
  new Notification('watchEverywhere', { body: '追更提醒已开启', icon: '/favicon.svg' });
}

async function test(c: NotifyChannel, i: number) {
  testing.value = i;
  const res = await testNotify({ ...c });
  testing.value = -1;
  if (res.code === 0) message.success('已发送测试消息');
}

async function save() {
  saving.value = true;
  const res = await saveNotifyConfig({ ...cfg, channels: cfg.channels.map((c) => ({ ...c })) });
  saving.value = false;
  if (res.code === 0) {
    message.success('已保存');
    emit('saved');
  }
}

onMounted(async () => {
  const res = await getNotifyConfig();
  if (res.code === 0) Object.assign(cfg, res.data);
});
</script>

<style scoped>
.watch-set__row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
}
.watch-set__label {
  width: 80px;
  flex-shrink: 0;
}
.watch-set__hint {
  font-size: 12px;
}
.watch-set__channel {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.watch-set__url {
  flex: 1;
  min-width: 200px;
}
.watch-set__foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
