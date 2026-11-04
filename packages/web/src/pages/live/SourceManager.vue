<template>
  <div class="src-mgr">
    <!-- 已有直播源 -->
    <div v-if="sources.length" class="src-mgr__list">
      <div v-for="s in sources" :key="s.id" :class="['src-mgr__item', { editing: form.id === s.id }]">
        <div class="src-mgr__main">
          <div class="src-mgr__name">
            {{ s.name }}
            <a-tag v-if="s.builtin" color="purple">内置</a-tag>
            <a-tag v-if="s.proxy" color="green">转发</a-tag>
            <a-tag v-if="s.channelCount !== undefined">{{ s.channelCount }} 个频道</a-tag>
          </div>
          <div class="src-mgr__url we-ellipsis we-muted" :title="s.url">{{ s.url }}</div>
          <div v-if="s.lastError" class="src-mgr__err we-ellipsis" :title="s.lastError">{{ s.lastError }}</div>
        </div>
        <a-space>
          <a-button v-if="s.builtin && iptv?.state === 'running'" size="small" type="link" :href="iptvAdminUrl(iptv)" target="_blank">
            频道管理
          </a-button>
          <a-button size="small" @click="edit(s)">编辑</a-button>
          <a-popconfirm v-if="!s.builtin" title="删除这个直播源？" @confirm="remove(s.id)">
            <a-button size="small" danger>删除</a-button>
          </a-popconfirm>
        </a-space>
      </div>
    </div>

    <!-- 内置 iPTV 状态 -->
    <a-alert v-if="iptv && iptv.enabled" :type="iptvAlert.type" show-icon class="src-mgr__iptv" :message="iptvAlert.title">
      <template #description>
        <div>{{ iptvAlert.desc }}</div>
        <div v-if="iptv.state === 'error' && !iptv.installed">
          在项目目录执行 <code>npm run iptv:update</code> 安装后，重新启动 watchEverywhere。
        </div>
      </template>
    </a-alert>

    <a-divider style="margin: 12px 0">{{ form.id ? '编辑直播源' : '添加直播源' }}</a-divider>

    <div class="src-mgr__quick">
      <span class="we-muted">快速填写：</span>
      <a-button size="small" @click="fillIptv('interface.m3u')">本机 iPTV（M3U）</a-button>
      <a-button size="small" @click="fillIptv('txt')">本机 iPTV（TXT）</a-button>
    </div>

    <a-form layout="vertical">
      <a-form-item label="名称">
        <a-input v-model:value="form.name" placeholder="例如：我的 iPTV" />
      </a-form-item>
      <a-form-item label="订阅地址（M3U / M3U8 / TXT）" required :extra="editingBuiltin ? '内置 iPTV 的地址由程序自动维护' : ''">
        <a-input v-model:value="form.url" :disabled="editingBuiltin" placeholder="http://localhost:1905/interface.m3u" />
      </a-form-item>
      <a-form-item label="节目单地址（XMLTV，可选）" extra="留空则自动使用 M3U 文件头里的 x-tvg-url（iPTV 会自动提供）">
        <a-input v-model:value="form.epgUrl" placeholder="http://localhost:1905/playback.xml" />
      </a-form-item>
      <a-form-item label="通过 watchEverywhere 服务转发播放" extra="开启后可解决跨域、防盗链导致的无法播放；关闭则浏览器直连，直连失败时也会自动改用转发">
        <a-switch v-model:checked="form.proxy" />
      </a-form-item>
    </a-form>
    <a-space>
      <a-button type="primary" :loading="saving" @click="save">{{ form.id ? '保存' : '添加' }}</a-button>
      <a-button v-if="form.id" @click="reset">取消编辑</a-button>
    </a-space>

    <a-collapse ghost class="src-mgr__help">
      <a-collapse-panel key="1" header="关于内置 iPTV">
        <p>
          watchEverywhere 内置了
          <a href="https://github.com/akiralereal/iptv" target="_blank" rel="noopener">iPTV</a>
          （直播源聚合服务），启动 watchEverywhere 时会自动运行它，并添加「内置 iPTV」直播源，不需要再单独部署。
        </p>
        <ul>
          <li>频道模块的开关、分组、排序在 iPTV 后台里管理（上方「频道管理」按钮）</li>
          <li>更新 iPTV：<code>npm run iptv:update</code>；不想用：以 <code>WE_IPTV=0</code> 启动</li>
          <li>iPTV 数据保存在 <code>~/.watch-everywhere/iptv</code></li>
          <li>如果已经用 Docker 部署了 iPTV（占用同一端口），会直接使用它而不再重复启动</li>
          <li>也可以在下面添加任意其它 M3U / TXT 订阅地址，例如 NAS 上的 iPTV：<code>http://NAS的IP:1905/interface.m3u</code></li>
        </ul>
        <p class="we-muted">请只观看你有权收看的频道内容。</p>
      </a-collapse-panel>
    </a-collapse>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { message } from 'ant-design-vue';
import { getIptvStatus, getLiveSources, iptvAdminUrl, removeLiveSource, saveLiveSource, type IptvStatus, type LiveSource } from '@/api';

const emit = defineEmits<{ changed: [string?] }>();

const sources = ref<LiveSource[]>([]);
const iptv = ref<IptvStatus | null>(null);
const editingBuiltin = computed(() => !!sources.value.find((s) => s.id === form.value.id)?.builtin);

const iptvAlert = computed(() => {
  const s = iptv.value!;
  const where = s.mode === 'external' ? `使用端口 ${s.port} 上已运行的 iPTV` : `端口 ${s.port}`;
  switch (s.state) {
    case 'running':
      return { type: 'success' as const, title: '内置 iPTV 运行中', desc: `${where}。频道模块、分组可点「频道管理」在 iPTV 后台中调整。` };
    case 'starting':
      return { type: 'info' as const, title: '内置 iPTV 正在启动', desc: '首次启动需要抓取频道，大约 1~2 分钟。' };
    case 'error':
      return { type: 'warning' as const, title: '内置 iPTV 未运行', desc: s.error || '启动失败' };
    default:
      return { type: 'info' as const, title: '内置 iPTV 已停止', desc: '' };
  }
});
const saving = ref(false);
const empty = () => ({ id: '', name: '', url: '', epgUrl: '', proxy: true });
const form = ref<{ id: string; name: string; url: string; epgUrl: string; proxy: boolean }>(empty());

async function load() {
  const [res, st] = await Promise.all([getLiveSources(), getIptvStatus()]);
  sources.value = res.data || [];
  iptv.value = st.code === 0 ? st.data : null;
}

function reset() {
  Object.assign(form, empty());
}

function edit(s: LiveSource) {
  Object.assign(form, { id: s.id, name: s.name, url: s.url, epgUrl: s.epgUrl || '', proxy: s.proxy });
}

function fillIptv(path: string) {
  form.value.url = `http://localhost:1905/${path}`;
  if (!form.value.name) form.value.name = 'iPTV';
}

async function save() {
  if (!form.value.url.trim()) return message.warning('请填写订阅地址');
  saving.value = true;
  const res = await saveLiveSource({ ...form, id: form.value.id || undefined });
  saving.value = false;
  if (res.code === 0) {
    message.success('已保存');
    reset();
    await load();
    emit('changed', res.data.id);
  }
}

async function remove(id: string) {
  await removeLiveSource(id);
  if (form.value.id === id) reset();
  await load();
  emit('changed');
}

onMounted(load);
</script>

<style scoped>
.src-mgr__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.src-mgr__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--we-top-bar-border);
}
.src-mgr__item.editing {
  border-color: var(--we-color-primary);
}
.src-mgr__main {
  flex: 1;
  min-width: 0;
}
.src-mgr__name {
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}
.src-mgr__url {
  font-size: 12px;
}
.src-mgr__err {
  font-size: 12px;
  color: #ff4d4f;
}
.src-mgr__iptv {
  margin-top: 10px;
}
.src-mgr__quick {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}
.src-mgr__help {
  margin-top: 12px;
}
.src-mgr__code {
  font-size: 12px;
  padding: 8px;
  border-radius: 6px;
  background: var(--we-color-primary-bg);
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
