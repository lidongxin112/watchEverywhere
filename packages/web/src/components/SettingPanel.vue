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
      <div class="setting__row">
        <span>跳过片头</span>
        <a-input-number v-model:value="setting.data.player.skipIntro" :min="0" :max="600" size="small" style="width: 96px" addon-after="秒" />
      </div>
      <div class="setting__row">
        <span>跳过片尾</span>
        <a-input-number v-model:value="setting.data.player.skipOutro" :min="0" :max="600" size="small" style="width: 96px" addon-after="秒" />
      </div>
      <div class="setting__row">
        <span>智能去广告</span>
        <a-switch v-model:checked="setting.data.player.adFilter" />
      </div>
      <div v-if="setting.data.player.adFilter" class="setting__ad">
        <div class="we-muted setting__ad-tip">
          自动识别并跳过 m3u8 视频中插播的广告片段。还有漏网的广告，可以在下面补充规则：分片地址的正则，每行一条，# 开头为注释。
        </div>
        <a-textarea
          v-model:value="setting.data.player.adPatterns"
          :auto-size="{ minRows: 2, maxRows: 6 }"
          placeholder="例如：&#10;/ad_\d+\.ts&#10;promo"
          class="setting__ad-input"
        />
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
        <div v-if="update?.notes" class="we-muted setting__notes">{{ update.notes }}</div>
        <a-space v-if="update?.hasUpdate" style="margin-top: 6px" wrap>
          <a-button size="small" type="primary" :loading="downloading" @click="onDownload">下载安装包</a-button>
          <a v-if="update.url" :href="update.url" target="_blank" rel="noreferrer">手动下载</a>
        </a-space>
        <div v-if="pending" class="setting__pending">
          已下载 v{{ pending.version }}（{{ pending.verified ? 'sha256 校验通过' : '校验失败' }}）
          <a-button v-if="pending.verified" size="small" type="primary" danger :loading="applying" @click="onApply">
            立即重启并更新
          </a-button>
        </div>
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
      <a-space wrap>
        <a-button @click="onClearCache">清除解析缓存</a-button>
        <a-button :loading="exporting" @click="onExportLogs">导出诊断日志</a-button>
      </a-space>
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
import {
  applyAppUpdate,
  checkAppUpdate,
  clearCache,
  downloadAppUpdate,
  getAppInfo,
  getAppNotices,
  getAppLogs,
  getPendingUpdate,
  type AppInfo,
  type AppNotice,
  type PendingUpdate,
  type UpdateInfo
} from '@/api';

const setting = useSettingStore();
const info = ref<AppInfo>();
const update = ref<UpdateInfo>();
const notices = ref<AppNotice[]>([]);
const checking = ref(false);
const updateMsg = ref('');
const downloading = ref(false);
const exporting = ref(false);
const applying = ref(false);
const pending = ref<PendingUpdate | null>(null);

async function onExportLogs() {
  exporting.value = true;
  const res = await getAppLogs();
  exporting.value = false;
  if (res.code !== 0 || !res.data) {
    message.error(res.msg || '导出失败');
    return;
  }
  const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `watchEverywhere-diag-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  message.success('已导出');
}

async function onDownload() {
  downloading.value = true;
  const res = await downloadAppUpdate();
  downloading.value = false;
  if (res.code !== 0 || !res.data) {
    updateMsg.value = `下载失败：${res.msg || '未知错误'}`;
    return;
  }
  pending.value = res.data;
  updateMsg.value = res.data.verified ? '安装包已下载并通过校验' : '安装包已下载，但 sha256 不匹配，已禁止安装';
}

async function onApply() {
  applying.value = true;
  const res = await applyAppUpdate();
  if (res.code !== 0) {
    applying.value = false;
    updateMsg.value = `重启失败：${res.msg || '未知错误'}`;
  }
  // 成功后服务端会退出，页面自然断开
}

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
  const [a, n, p] = await Promise.all([getAppInfo(), getAppNotices(), getPendingUpdate()]);
  if (a.code === 0) info.value = a.data;
  if (n.code === 0 && Array.isArray(n.data)) notices.value = n.data;
  if (p.code === 0 && p.data) pending.value = p.data;
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
.setting__pending {
  margin-top: 8px;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
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
.setting__ad {
  margin: 4px 0 8px;
}
.setting__ad-tip {
  font-size: 12px;
  margin-bottom: 6px;
}
.setting__ad-input {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 12px;
}
.setting__about {
  font-size: 12px;
  text-align: center;
}
</style>
