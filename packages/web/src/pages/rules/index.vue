<template>
  <div class="we-page rules" @drop.prevent="onDrop" @dragover.prevent @dragenter.prevent>
    <div class="we-page-header">
      <a-dropdown>
        <a-button type="primary"><PlusOutlined /> 添加规则 <DownOutlined /></a-button>
        <template #overlay>
          <a-menu>
            <a-menu-item @click="importOpen = true">从文本 / URL 导入</a-menu-item>
            <a-menu-item @click="fileRef?.click()">从文件导入</a-menu-item>
            <a-menu-divider />
            <a-menu-item @click="cmsOpen = true">从资源站添加（苹果CMS）</a-menu-item>
            <a-menu-item @click="openSubscriptions">管理规则订阅</a-menu-item>
            <a-menu-item @click="openMarket">规则市场</a-menu-item>
            <a-menu-item @click="openBackups">备份与恢复</a-menu-item>
            <a-menu-divider />
            <a-menu-item @click="editRule('')">新建规则</a-menu-item>
          </a-menu>
        </template>
      </a-dropdown>
      <a-button :loading="loading" @click="refresh"><ReloadOutlined /></a-button>
      <a-input-search v-model:value="filterText" placeholder="搜索名称 / 域名" allow-clear style="width: 200px" />
      <a-checkbox-group v-model:value="types" :options="CONTENT_TYPES" />
      <div style="flex: 1"></div>
      <a-dropdown>
        <a-button :loading="pinging">测速 <DownOutlined /></a-button>
        <template #overlay>
          <a-menu>
            <a-menu-item @click="pingAll">全部测速</a-menu-item>
            <a-menu-item danger @click="delTimeout">删除超时规则</a-menu-item>
          </a-menu>
        </template>
      </a-dropdown>
      <a-dropdown :disabled="!selected.length">
        <a-button type="primary" :disabled="!selected.length">批量操作({{ selected.length }}) <DownOutlined /></a-button>
        <template #overlay>
          <a-menu>
            <a-menu-item @click="batch({ enableSearch: true })">启用搜索</a-menu-item>
            <a-menu-item @click="batch({ enableSearch: false })">禁用搜索</a-menu-item>
            <a-menu-divider />
            <a-menu-item @click="batch({ enableDiscover: true })">启用发现</a-menu-item>
            <a-menu-item @click="batch({ enableDiscover: false })">禁用发现</a-menu-item>
            <a-menu-divider />
            <a-menu-item @click="exportSelected">导出 JSON</a-menu-item>
            <a-menu-item @click="copySelected">复制 JSON</a-menu-item>
            <a-menu-divider />
            <a-menu-item danger @click="del(selected)">删除选中</a-menu-item>
          </a-menu>
        </template>
      </a-dropdown>
    </div>

    <input ref="fileRef" type="file" accept=".json,.txt,application/json" multiple hidden @change="onFileChange" />

    <a-table
      row-key="id"
      size="middle"
      :loading="loading"
      :columns="columns"
      :data-source="tableData"
      :row-selection="{ selectedRowKeys: selected, onChange: (keys: any[]) => (selected = keys as string[]) }"
      :pagination="{ defaultPageSize: 20, showSizeChanger: true, showTotal: (t: number) => `共 ${t} 条` }"
      :scroll="{ x: 1000 }"
    >
      <template #emptyText>
        <div style="padding: 30px 0">还没有规则，可以把规则 JSON 文件拖拽到这里导入</div>
      </template>
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'name'">
          <a @click="editRule(record.id)">{{ record.name || '(未命名)' }}</a>
          <a-tag v-if="record.group" style="margin-left: 6px">{{ record.group }}</a-tag>
        </template>
        <template v-else-if="column.key === 'contentType'">{{ contentTypeLabel(record.contentType) }}</template>
        <template v-else-if="column.key === 'host'">
          <a :href="record.host" target="_blank" rel="noopener" class="we-ellipsis" style="display: block">{{ record.host }}</a>
        </template>
        <template v-else-if="column.key === 'enableSearch'">
          <a-switch :checked="record.enableSearch" size="small" @change="(v: any) => rules.updateRuleById(record.id, { enableSearch: !!v })" />
        </template>
        <template v-else-if="column.key === 'enableDiscover'">
          <a-switch :checked="record.enableDiscover" size="small" @change="(v: any) => rules.updateRuleById(record.id, { enableDiscover: !!v })" />
        </template>
        <template v-else-if="column.key === 'pin'">
          <a-switch :checked="rules.pinned.includes(record.id)" size="small" @change="rules.pinRule(record)" />
        </template>
        <template v-else-if="column.key === 'ping'">
          <a-button type="text" size="small" :class="{ timeout: record.extra?.ping === -1 }" @click="ping(record)">
            <a-spin v-if="pingIds.includes(record.id)" size="small" />
            <template v-else>{{ pingText(record.extra?.ping) }}</template>
          </a-button>
        </template>
        <template v-else-if="column.key === 'action'">
          <a-space>
            <a-button type="primary" shape="circle" size="small" @click="editRule(record.id)"><EditOutlined /></a-button>
            <a-button danger shape="circle" size="small" @click="del([record.id])"><DeleteOutlined /></a-button>
          </a-space>
        </template>
      </template>
    </a-table>

    <!-- 文本 / URL 导入 -->
    <a-modal v-model:open="importOpen" title="导入规则" :confirm-loading="importing" ok-text="导入" @ok="doImport">
      <a-textarea
        v-model:value="importText"
        :auto-size="{ minRows: 6, maxRows: 14 }"
        placeholder="支持：&#10;1. 规则 JSON（单个对象或数组）&#10;2. eso:// 开头的压缩规则&#10;3. 返回上述内容的网络地址（订阅地址）"
      />
    </a-modal>

    <!-- 资源站 -->
    <a-modal v-model:open="cmsOpen" title="从资源站添加" :confirm-loading="importing" ok-text="添加" @ok="doImportCMS">
      <a-form layout="vertical">
        <a-form-item label="名称">
          <a-input v-model:value="cmsForm.name" placeholder="例如：某某资源" />
        </a-form-item>
        <a-form-item label="接口地址" extra="苹果 CMS v10 接口，一般形如 https://域名/api.php/provide/vod （JSON 或 XML 均可）">
          <a-input v-model:value="cmsForm.url" placeholder="https://example.com/api.php/provide/vod" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 规则市场 -->
    <a-drawer v-model:open="marketOpen" title="规则市场" placement="right" :width="560">
      <p class="we-muted" style="font-size: 12px">内置索引随程序发布，点「添加」即导入；已安装的会标出来。</p>
      <a-space style="margin-bottom: 10px" wrap>
        <a-checkbox-group v-model:value="marketTypes" :options="CONTENT_TYPES" />
        <a-input v-model:value="marketFilter" placeholder="搜索名称 / 描述" allow-clear style="width: 180px" />
      </a-space>
      <a-empty v-if="!marketList.length" description="暂无规则" />
      <div v-for="m in marketFiltered" :key="m.id" class="market-item">
        <div class="market-item__main">
          <div class="market-item__name">
            {{ m.name }}
            <a-tag v-if="m.installed" color="green" style="margin-left: 6px">已安装</a-tag>
          </div>
          <div class="market-item__desc we-muted">{{ m.description || m.host }}</div>
          <div class="market-item__tags">
            <a-tag v-for="t in m.tags || []" :key="t">{{ t }}</a-tag>
          </div>
        </div>
        <a-button size="small" :type="m.installed ? 'default' : 'primary'" :loading="installing === m.id" @click="installMarket(m)">
          {{ m.installed ? '更新' : '添加' }}
        </a-button>
      </div>
    </a-drawer>

    <!-- 规则订阅 -->
    <a-drawer v-model:open="subOpen" title="规则订阅" placement="right" :width="520">
      <a-form layout="vertical">
        <a-form-item label="订阅地址" extra="指向一份规则 JSON / eso:// 串，或返回它们的地址；保存后可一键检查">
          <a-input v-model:value="subForm.url" placeholder="https://example.com/rules.json" />
        </a-form-item>
        <a-form-item label="名称（可选）">
          <a-input v-model:value="subForm.name" placeholder="留空用域名" />
        </a-form-item>
        <a-space>
          <a-checkbox v-model:checked="subForm.autoUpdate">每小时自动检查</a-checkbox>
          <a-button type="primary" :loading="subSaving" @click="saveSubscription">添加</a-button>
          <a-button :loading="subChecking" @click="checkAllSubscriptions">全部检查</a-button>
        </a-space>
      </a-form>

      <a-divider>已有订阅</a-divider>
      <a-empty v-if="!subscriptions.length" description="还没有订阅" />
      <div v-for="s in subscriptions" :key="s.id" class="sub-item">
        <div class="sub-item__main">
          <div class="sub-item__name we-ellipsis">{{ s.name }}</div>
          <div class="sub-item__url we-muted we-ellipsis">{{ s.url }}</div>
          <div class="sub-item__meta we-muted">
            {{ s.lastCheck ? '上次检查 ' + dayjs(s.lastCheck).format('MM-DD HH:mm') : '未检查' }}
            <span v-if="s.lastCount"> · {{ s.lastCount }} 条规则</span>
            <span v-if="s.lastError" class="sub-item__err"> · {{ s.lastError }}</span>
          </div>
        </div>
        <a-space>
          <a-button size="small" :loading="subCheckingId === s.id" @click="checkSubscription(s.id)">检查</a-button>
          <a-button size="small" danger @click="removeSubscription(s.id)">删除</a-button>
        </a-space>
      </div>
    </a-drawer>

    <!-- 备份与恢复 -->
    <a-drawer v-model:open="backupOpen" title="规则备份" placement="right" :width="520">
      <p class="we-muted" style="font-size: 12px">
        每次导入规则前会自动备份一份；恢复前也会把当前规则再存一份，避免误操作。
      </p>
      <a-empty v-if="!backups.length" description="还没有备份（导入时会自动生成）" />
      <div v-for="b in backups" :key="b.file" class="sub-item">
        <div class="sub-item__main">
          <div class="sub-item__name">{{ dayjs(b.time).format('MM-DD HH:mm:ss') }}</div>
          <div class="sub-item__meta we-muted">{{ b.count }} 条规则 · {{ (b.size / 1024).toFixed(1) }} KB</div>
        </div>
        <a-popconfirm title="用这份备份覆盖当前规则？" ok-text="恢复" @confirm="restore(b.file)">
          <a-button size="small" :loading="restoring === b.file">恢复</a-button>
        </a-popconfirm>
      </div>
    </a-drawer>

    <!-- 编辑 -->
    <a-drawer v-model:open="editOpen" :title="editId ? '编辑规则' : '新建规则'" placement="right" width="min(960px, 100%)" destroy-on-close>
      <RuleInfo v-if="editOpen" :rule-id="editId" @close="onEditClose" />
    </a-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { message, Modal } from 'ant-design-vue';
import { PlusOutlined, DownOutlined, ReloadOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons-vue';
import { CONTENT_TYPES, contentTypeLabel, type Rule } from '@/constants';
import dayjs from 'dayjs';
import {
  batchUpdateRules,
  checkAllSubscriptions as apiCheckAll,
  checkSubscription as apiCheckSubscription,
  delRules,
  deleteSubscription,
  getMarket,
  getRuleBackups,
  installMarketRule,
  getSubscriptions,
  importCMS,
  importRules,
  pingRule,
  restoreRuleBackup,
  saveSubscription as apiSaveSubscription,
  type MarketItem,
  type RuleSubscription
} from '@/api';
import { useRulesStore } from '@/stores/rules';
import RuleInfo from '@/pages/rule-info/index.vue';

const rules = useRulesStore();

const loading = ref(false);
const filterText = ref('');
const types = ref<number[]>(CONTENT_TYPES.map((e) => e.value));
const selected = ref<string[]>([]);
const pingIds = ref<string[]>([]);
const pinging = ref(false);
const fileRef = ref<HTMLInputElement>();

const importOpen = ref(false);

// ---------------- 规则订阅 ----------------
const subOpen = ref(false);
const subSaving = ref(false);
const subChecking = ref(false);
const subCheckingId = ref('');
const subscriptions = ref<RuleSubscription[]>([]);
const subForm = ref({ url: '', name: '', autoUpdate: true });

// ---------------- 规则市场 ----------------
const marketOpen = ref(false);
const marketList = ref<MarketItem[]>([]);
const marketTypes = ref<number[]>([]);
const marketFilter = ref('');
const installing = ref('');

const marketFiltered = computed(() =>
  marketList.value.filter(
    (m) =>
      (!marketTypes.value.length || marketTypes.value.includes(m.contentType)) &&
      (!marketFilter.value ||
        m.name.includes(marketFilter.value) ||
        String(m.description || '').includes(marketFilter.value))
  )
);

async function openMarket() {
  marketOpen.value = true;
  const res = await getMarket();
  if (res.code === 0) marketList.value = res.data || [];
}

async function installMarket(m: MarketItem) {
  installing.value = m.id;
  const res = await installMarketRule(m.id);
  installing.value = '';
  if (res.code !== 0) return message.error(res.msg || '添加失败');
  message.success(`${m.name} 已${m.installed ? '更新' : '添加'}`);
  await openMarket();
  await refresh();
}

// ---------------- 备份 ----------------
const backupOpen = ref(false);
const backups = ref<{ file: string; size: number; time: number; count: number }[]>([]);
const restoring = ref('');

async function openBackups() {
  backupOpen.value = true;
  const res = await getRuleBackups();
  if (res.code === 0) backups.value = res.data || [];
}

async function restore(file: string) {
  restoring.value = file;
  const res = await restoreRuleBackup(file);
  restoring.value = '';
  if (res.code !== 0) return message.error(res.msg || '恢复失败');
  message.success(`已恢复 ${res.data} 条规则`);
  await refresh();
}

async function loadSubscriptions() {
  const res = await getSubscriptions();
  if (res.code === 0) subscriptions.value = res.data || [];
}
function openSubscriptions() {
  subOpen.value = true;
  loadSubscriptions();
}
async function saveSubscription() {
  if (!subForm.value.url.trim()) return message.warning('先填订阅地址');
  subSaving.value = true;
  const res = await apiSaveSubscription({ url: subForm.value.url.trim(), name: subForm.value.name.trim(), autoUpdate: subForm.value.autoUpdate });
  subSaving.value = false;
  if (res.code !== 0) return message.error(res.msg || '保存失败');
  subForm.value.url = '';
  subForm.value.name = '';
  await loadSubscriptions();
  if (res.data?.id) await checkSubscription(res.data.id);
}
async function checkSubscription(id: string) {
  subCheckingId.value = id;
  const res = await apiCheckSubscription(id);
  subCheckingId.value = '';
  if (res.code !== 0) return message.error(res.msg || '检查失败');
  if (res.data?.error) message.error(res.data.error);
  else message.success(`新增 ${res.data?.added || 0} 条，更新 ${res.data?.updated || 0} 条`);
  await loadSubscriptions();
  await refresh();
}
async function checkAllSubscriptions() {
  subChecking.value = true;
  const res = await apiCheckAll();
  subChecking.value = false;
  if (res.code !== 0) return message.error(res.msg || '检查失败');
  const added = (res.data || []).reduce((n, r) => n + (r.added || 0), 0);
  const updated = (res.data || []).reduce((n, r) => n + (r.updated || 0), 0);
  message.success(`检查 ${res.data?.length || 0} 个订阅，新增 ${added} 条，更新 ${updated} 条`);
  await loadSubscriptions();
  await refresh();
}
async function removeSubscription(id: string) {
  const res = await deleteSubscription(id);
  if (res.code === 0) {
    await loadSubscriptions();
    message.success('已删除');
  }
}
const importText = ref('');
const importing = ref(false);
const cmsOpen = ref(false);
const cmsForm = ref({ name: '', url: '' });
const editOpen = ref(false);
const editId = ref('');

const columns = [
  { title: '名称', key: 'name', dataIndex: 'name', width: 200, fixed: 'left', ellipsis: true, sorter: (a: Rule, b: Rule) => a.name.localeCompare(b.name) },
  { title: '类型', key: 'contentType', width: 70, align: 'center' },
  { title: '域名', key: 'host', dataIndex: 'host', ellipsis: true },
  {
    title: '搜索',
    key: 'enableSearch',
    width: 80,
    align: 'center',
    filters: [
      { text: '启用', value: true },
      { text: '禁用', value: false }
    ],
    filterMultiple: false,
    onFilter: (v: any, r: Rule) => r.enableSearch === v
  },
  {
    title: '发现',
    key: 'enableDiscover',
    width: 80,
    align: 'center',
    filters: [
      { text: '启用', value: true },
      { text: '禁用', value: false }
    ],
    filterMultiple: false,
    onFilter: (v: any, r: Rule) => r.enableDiscover === v
  },
  { title: '置顶', key: 'pin', width: 70, align: 'center' },
  { title: '作者', dataIndex: 'author', width: 100, ellipsis: true, align: 'center' },
  {
    title: '延迟',
    key: 'ping',
    width: 90,
    align: 'center',
    sorter: (a: Rule, b: Rule) => pingSortValue(a) - pingSortValue(b)
  },
  { title: '操作', key: 'action', width: 100, align: 'center', fixed: 'right' }
] as any[];

const tableData = computed(() => {
  const k = filterText.value.trim().toLowerCase();
  return rules.list.filter(
    (r) => types.value.includes(r.contentType) && (!k || r.name?.toLowerCase().includes(k) || r.host?.toLowerCase().includes(k))
  );
});

function pingSortValue(r: Rule) {
  const p = r.extra?.ping;
  return p === undefined || p === -1 ? Number.MAX_SAFE_INTEGER : p;
}

function pingText(p?: number) {
  if (p === undefined) return '测速';
  if (p === -1) return '超时';
  return `${p}ms`;
}

async function refresh() {
  loading.value = true;
  await rules.sync();
  loading.value = false;
}

function editRule(id: string) {
  editId.value = id;
  editOpen.value = true;
}

function onEditClose() {
  editOpen.value = false;
  refresh();
}

async function doImport() {
  if (!importText.value.trim()) return;
  importing.value = true;
  const res = await importRules(importText.value);
  importing.value = false;
  if (res.code === 0) {
    message.success(`成功导入 ${res.data} 条规则`);
    importOpen.value = false;
    importText.value = '';
    refresh();
  }
}

async function doImportCMS() {
  importing.value = true;
  const res = await importCMS(cmsForm.value.url.trim(), cmsForm.value.name.trim());
  importing.value = false;
  if (res.code === 0) {
    message.success('已添加资源站规则');
    cmsOpen.value = false;
    cmsForm.value.name = '';
    cmsForm.value.url = '';
    refresh();
  }
}

async function importFiles(files: FileList | File[]) {
  let count = 0;
  loading.value = true;
  for (const file of Array.from(files)) {
    const text = await file.text();
    const res = await importRules(text);
    if (res.code === 0) count += res.data || 0;
  }
  loading.value = false;
  message.success(`成功导入 ${count} 条规则`);
  refresh();
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.length) importFiles(input.files);
  input.value = '';
}

function onDrop(e: DragEvent) {
  const files = e.dataTransfer?.files;
  if (files?.length) importFiles(files);
}

async function ping(r: Rule) {
  pingIds.value.push(r.id);
  const res = await pingRule(r.id);
  pingIds.value = pingIds.value.filter((id) => id !== r.id);
  if (res.code === 0) r.extra = { ...(r.extra || {}), ping: res.data.ping };
}

async function pingAll() {
  pinging.value = true;
  const list = [...tableData.value];
  for (let i = 0; i < list.length; i += 6) await Promise.all(list.slice(i, i + 6).map(ping));
  pinging.value = false;
}

function del(ids: string[]) {
  if (!ids.length) return;
  Modal.confirm({
    title: `删除 ${ids.length} 条规则？`,
    content: '删除后不可恢复',
    okType: 'danger',
    onOk: async () => {
      await delRules(ids);
      selected.value = selected.value.filter((id) => !ids.includes(id));
      refresh();
    }
  });
}

function delTimeout() {
  const ids = rules.list.filter((r) => r.extra?.ping === -1).map((r) => r.id);
  if (!ids.length) return message.info('没有超时的规则（请先测速）');
  del(ids);
}

async function batch(data: Partial<Rule>) {
  await batchUpdateRules([...selected.value], data);
  message.success('已更新');
  refresh();
}

function selectedJson() {
  const list = rules.list
    .filter((r) => selected.value.includes(r.id))
    .map(({ extra: _extra, ...rest }) => rest);
  return JSON.stringify(list, null, 2);
}

function exportSelected() {
  const blob = new Blob([selectedJson()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `watchEverywhere-rules-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function copySelected() {
  try {
    await navigator.clipboard.writeText(selectedJson());
    message.success('已复制到剪贴板');
  } catch {
    message.error('复制失败');
  }
}

onMounted(refresh);
</script>

<style scoped>
.rules :deep(.timeout) {
  color: #ff4d4f;
}

.market-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px dashed var(--we-border-color, rgba(128, 128, 128, 0.25));
}
.market-item__main {
  flex: 1;
  min-width: 0;
}
.market-item__name {
  font-weight: 600;
  font-size: 13px;
}
.market-item__desc {
  font-size: 12px;
  margin-top: 2px;
}
.market-item__tags {
  margin-top: 4px;
}
.market-item__tags .ant-tag {
  font-size: 11px;
  margin: 0 4px 0 0;
}
.sub-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px dashed var(--we-border-color, rgba(128, 128, 128, 0.25));
}
.sub-item__main {
  flex: 1;
  min-width: 0;
}
.sub-item__name {
  font-weight: 600;
  font-size: 13px;
}
.sub-item__url,
.sub-item__meta {
  font-size: 12px;
}
.sub-item__err {
  color: #ff4d4f;
}
</style>
