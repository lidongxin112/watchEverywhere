<template>
  <div class="setting">
    <div class="setting__group">
      <div class="setting__label">主题</div>
      <div class="setting__themes">
        <div
          v-for="(t, i) in THEMES"
          :key="t.label"
          :class="['setting__theme', { active: setting.data.theme === i }]"
          @click="setting.data.theme = i"
        >
          <span class="setting__swatch" :style="{ background: t.swatch, borderColor: t.tokens.colorPrimary }"></span>
          {{ t.label }}
        </div>
      </div>
    </div>

    <div class="setting__group">
      <div class="setting__label">
        阅读样式
        <a-button size="small" type="link" @click="setting.resetReadStyle()">恢复默认</a-button>
      </div>
      <div class="setting__row">
        <span>字号</span>
        <a-slider v-model:value="setting.data.readStyle.fontSize" :min="12" :max="36" class="setting__slider" />
        <span class="setting__val">{{ setting.data.readStyle.fontSize }}px</span>
      </div>
      <div class="setting__row">
        <span>行高</span>
        <a-slider v-model:value="setting.data.readStyle.lineHeight" :min="1" :max="3" :step="0.1" class="setting__slider" />
        <span class="setting__val">{{ setting.data.readStyle.lineHeight }}</span>
      </div>
      <div class="setting__row">
        <span>字间距</span>
        <a-slider v-model:value="setting.data.readStyle.letterSpacing" :min="0" :max="10" class="setting__slider" />
        <span class="setting__val">{{ setting.data.readStyle.letterSpacing }}px</span>
      </div>
      <div class="setting__row">
        <span>段间距</span>
        <a-slider v-model:value="setting.data.readStyle.sectionSpacing" :min="0" :max="40" class="setting__slider" />
        <span class="setting__val">{{ setting.data.readStyle.sectionSpacing }}px</span>
      </div>
      <div class="setting__row">
        <span>版心宽度</span>
        <a-slider v-model:value="setting.data.readStyle.maxWidth" :min="480" :max="1600" :step="20" class="setting__slider" />
        <span class="setting__val">{{ setting.data.readStyle.maxWidth }}</span>
      </div>
      <div class="setting__row">
        <span>文字颜色</span>
        <input v-model="setting.data.readStyle.textColor" type="color" class="setting__color" />
        <a-button size="small" type="link" @click="setting.data.readStyle.textColor = ''">跟随主题</a-button>
      </div>
      <div class="setting__row">
        <span>背景颜色</span>
        <input v-model="setting.data.readStyle.backgroundColor" type="color" class="setting__color" />
        <a-button size="small" type="link" @click="setting.data.readStyle.backgroundColor = ''">跟随主题</a-button>
      </div>
    </div>

    <div class="setting__group">
      <div class="setting__label">播放</div>
      <div class="setting__row">
        <span>自动播放下一集</span>
        <a-switch v-model:checked="setting.data.player.autoNext" />
      </div>
      <div class="setting__row">
        <span>记住播放进度</span>
        <a-switch v-model:checked="setting.data.player.resume" />
      </div>
    </div>

    <div class="setting__group">
      <div class="setting__label">
        版本
        <a-button size="small" type="link" :loading="checking" @click="onCheckUpdate">检查更新</a-button>
      </div>
      <div class="setting__row">
        <span>当前版本</span>
        <span class="setting__val">v{{ info?.version || VERSION }}{{ info?.standalone ? ' · 桌面版' : '' }}</span>
      </div>
      <div v-if="updateMsg" class="setting__update">
        <div>{{ updateMsg }}</div>
        <a v-if="update?.url" :href="update.url" target="_blank" rel="noreferrer">下载 {{ update.latest }}</a>
        <div v-if="update?.notes" class="we-muted setting__notes">{{ update.notes }}</div>
      </div>
      <div v-if="notices.length" class="setting__notice">
        <div v-for="n in notices" :key="n.id" class="setting__notice-item">
          <span class="setting__notice-title">{{ n.title }}</span>
          <span v-if="n.content" class="we-muted"> · {{ n.content }}</span>
          <a v-if="n.url" :href="n.url" target="_blank" rel="noreferrer">详情</a>
        </div>
      </div>
    </div>

    <div class="setting__group">
      <div class="setting__label">数据</div>
      <a-button @click="onClearCache">清除解析缓存</a-button>
    </div>

    <div class="setting__about we-muted">watchEverywhere v{{ VERSION }} · 参考 any-reader 实现</div>
  </div>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
import { THEMES } from '@/constants/theme';
import { VERSION } from '@/constants';
import { onMounted, ref } from 'vue';
import { useSettingStore } from '@/stores/setting';
import { checkAppUpdate, clearCache, getAppInfo, getAppNotices, type AppInfo, type AppNotice, type UpdateInfo } from '@/api';

const setting = useSettingStore();
const info = ref<AppInfo>();
const update = ref<UpdateInfo>();
const notices = ref<AppNotice[]>([]);
const checking = ref(false);
const updateMsg = ref('');

async function onCheckUpdate() {
  checking.value = true;
  const res = await checkAppUpdate(true);
  checking.value = false;
  if (res.code !== 0 || !res.data) {
    updateMsg.value = res.msg || '检查失败';
    return;
  }
  update.value = res.data;
  if (res.data.error) updateMsg.value = `检查失败：${res.data.error}`;
  else if (res.data.hasUpdate) updateMsg.value = `发现新版本 v${res.data.latest}`;
  else updateMsg.value = '已是最新版本';
}

onMounted(async () => {
  const [a, n] = await Promise.all([getAppInfo(), getAppNotices()]);
  if (a.code === 0) info.value = a.data;
  if (n.code === 0 && Array.isArray(n.data)) notices.value = n.data;
});

async function onClearCache() {
  const res = await clearCache();
  if (res.code === 0) message.success('已清除');
}
</script>

<style scoped>
.setting__group {
  margin-bottom: 22px;
}
.setting__update {
  margin-top: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--we-color-primary-bg);
  font-size: 13px;
}
.setting__notes {
  margin-top: 4px;
  font-size: 12px;
  white-space: pre-wrap;
}
.setting__notice {
  margin-top: 6px;
  font-size: 12px;
}
.setting__notice-item {
  padding: 4px 0;
  border-top: 1px dashed var(--we-border-color, rgba(128, 128, 128, 0.25));
}
.setting__notice-title {
  font-weight: 600;
}
.setting__label {
  font-weight: 600;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.setting__themes {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.setting__theme {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
  background: var(--we-color-primary-bg);
}
.setting__theme.active {
  border-color: var(--we-color-primary);
}
.setting__swatch {
  width: 18px;
  height: 18px;
  border-radius: 9px;
  border: 2px solid;
}
.setting__row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
}
.setting__row > span:first-child {
  width: 96px;
  flex-shrink: 0;
}
.setting__slider {
  flex: 1;
}
.setting__val {
  width: 48px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.setting__color {
  width: 36px;
  height: 24px;
  border: none;
  padding: 0;
  background: none;
  cursor: pointer;
}
.setting__about {
  font-size: 12px;
  text-align: center;
}
</style>
