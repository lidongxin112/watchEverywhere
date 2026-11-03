<template>
  <div class="reader" :style="readerVars">
    <div ref="scrollRef" class="reader__scroll" tabindex="0" @scroll="onScroll">
      <div class="reader__body">
        <h2 class="reader__title">{{ chapters.title }}</h2>

        <div v-if="loading" class="we-center"><a-spin /></div>
        <div v-else-if="errMsg" class="we-center">
          <a-result status="warning" :title="errMsg">
            <template #extra><a-button type="primary" @click="init(true)">重试</a-button></template>
          </a-result>
        </div>
        <!-- 漫画 -->
        <div v-else-if="contentType === ContentType.MANGA" class="reader__manga">
          <!-- 有些站点只能在其页面内阅读（正文接口需登录），这时直接内嵌原站章节页 -->
          <template v-if="webPage">
            <div class="reader__fallback">
              <p class="reader__tip">
                这个来源的正文要登录后才能取到图片，页面被站点禁止内嵌时下方会是空白。
              </p>
              <p class="reader__tip">
                解决：在「规则」里给该源填上账号 Cookie，就能直接在应用内看；或者
                <a :href="webPage" target="_blank" rel="noreferrer">在原站打开</a>。
              </p>
            </div>
            <iframe class="reader__web" :src="webPage" referrerpolicy="no-referrer" allowfullscreen></iframe>
          </template>
          <template v-else>
            <img v-for="(src, idx) in content" :key="idx" :src="src" loading="lazy" referrerpolicy="no-referrer" alt="" />
          </template>
        </div>
        <!-- 小说 -->
        <template v-else>
          <template v-for="(row, idx) in content" :key="idx">
            <img v-if="imgSrc(row)" class="reader__img" :src="imgSrc(row)" loading="lazy" referrerpolicy="no-referrer" alt="" />
            <p v-else class="reader__p">{{ row }}</p>
          </template>
        </template>

        <div class="reader__nav">
          <a-button :disabled="!prev" @click="go(prev)"><LeftOutlined /> 上一章</a-button>
          <a-button @click="tocOpen = true"><UnorderedListOutlined /> 目录</a-button>
          <a-button @click="init(true)"><ReloadOutlined /> 重载</a-button>
          <a-button :disabled="!next" @click="go(next)">下一章 <RightOutlined /></a-button>
        </div>
      </div>
    </div>

    <a-drawer v-model:open="tocOpen" :title="name" placement="left" :width="340" @after-open-change="scrollTocToCurrent">
      <div ref="tocRef">
        <div
          v-for="c in roadChapters"
          :key="c.chapterPath"
          :data-path="c.chapterPath"
          :class="['reader__toc-item we-ellipsis', { active: c.chapterPath === chapters.currentPath }]"
          :title="c.name"
          @click="go(c)"
        >
          {{ c.name }}
        </div>
      </div>
    </a-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { LeftOutlined, RightOutlined, ReloadOutlined, UnorderedListOutlined } from '@ant-design/icons-vue';
import { ContentType } from '@/constants';
import { contentDecoder, getContent, saveChapterHistory, type ChapterItem } from '@/api';
import { useChaptersStore } from '@/stores/chapters';
import { useSettingStore } from '@/stores/setting';
import { useBus, EVENT_CHAPTERS_BOX } from '@/utils/bus';

const route = useRoute();
const router = useRouter();
const chapters = useChaptersStore();
const setting = useSettingStore();

const q = route.query as Record<string, string>;
const { ruleId, filePath, chapterPath, name } = q;

const content = ref<string[]>([]);
const contentType = ref<number>(ContentType.NOVEL);
const loading = ref(false);
const errMsg = ref('');
const tocOpen = ref(false);
const scrollRef = ref<HTMLElement>();
const tocRef = ref<HTMLElement>();

const readerVars = computed(() => {
  const s = setting.data.readStyle;
  return {
    '--read-font-size': `${s.fontSize}px`,
    '--read-line-height': String(s.lineHeight),
    '--read-letter-spacing': `${s.letterSpacing}px`,
    '--read-section-spacing': `${s.sectionSpacing}px`,
    '--read-max-width': `${s.maxWidth}px`,
    '--read-text': s.textColor || 'var(--we-read-text)',
    '--read-bg': s.backgroundColor || 'var(--we-read-bg)'
  };
});

/** 漫画源只给了一个原站章节页地址时，走内嵌网页阅读 */
const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif|bmp)(\?|#|$)/i;
const webPage = computed(() => {
  if (contentType.value !== ContentType.MANGA || content.value.length !== 1) return '';
  const only = content.value[0] || '';
  return /^https?:\/\//i.test(only) && !IMAGE_RE.test(only) ? only : '';
});

const current = computed(() => chapters.chapters.find((c) => c.chapterPath === chapterPath));
const roadChapters = computed(() => chapters.chapters.filter((c) => (c.road || '') === (current.value?.road || '')));
const prev = computed(() => {
  const i = roadChapters.value.findIndex((c) => c.chapterPath === chapterPath);
  return i > 0 ? roadChapters.value[i - 1] : undefined;
});
const next = computed(() => {
  const i = roadChapters.value.findIndex((c) => c.chapterPath === chapterPath);
  return i > -1 ? roadChapters.value[i + 1] : undefined;
});

async function init(noCache = false) {
  loading.value = true;
  errMsg.value = '';
  content.value = [];
  chapters.currentPath = chapterPath;
  chapters.load(ruleId, filePath).then(() => {
    chapters.title = current.value?.name || '';
  });

  const res = await getContent({ ruleId, filePath, chapterPath, noCache });
  if (res.code !== 0 || !res.data) {
    loading.value = false;
    errMsg.value = res.msg || '获取内容失败';
    return;
  }
  contentType.value = res.data.contentType;
  const rows = Array.isArray(res.data.content) ? res.data.content : [res.data.content];

  if (res.data.contentDecoder) {
    // 正文需要解密（常见于漫画图片），并发解密
    const out = new Array(rows.length).fill('');
    let i = 0;
    const worker = async () => {
      while (i < rows.length) {
        const idx = i++;
        const r = await contentDecoder(ruleId, rows[idx]);
        out[idx] = r.code === 0 ? r.data : rows[idx];
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    content.value = out;
  } else content.value = rows;
  loading.value = false;

  await nextTick();
  const pct = Number(q.percentage || 0);
  if (pct && scrollRef.value) scrollRef.value.scrollTop = scrollRef.value.scrollHeight * (pct / 100000);
  scrollRef.value?.focus();
  saveProgress();
  preload();
}

/** 预加载下一章（服务端会缓存） */
function preload() {
  setTimeout(() => {
    if (next.value) getContent({ ruleId, filePath, chapterPath: next.value.chapterPath });
  }, 1500);
}

let saveTimer: number | undefined;
function saveProgress() {
  const el = scrollRef.value;
  if (!el) return;
  saveChapterHistory({
    ruleId,
    filePath,
    chapterPath,
    chapterName: current.value?.name || chapters.title,
    percentage: el.scrollHeight ? Math.floor((el.scrollTop / el.scrollHeight) * 100000) : 0
  });
}
function onScroll() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveProgress, 500);
}

/** 正文按纯文本渲染（防止来源站点注入脚本），仅识别单独一行的图片 */
function imgSrc(row: string) {
  const m = /^\s*<img[^>]+src=["']([^"']+)["'][^>]*>\s*$/i.exec(row);
  return m ? m[1] : '';
}

function go(c?: ChapterItem) {
  if (!c) return;
  tocOpen.value = false;
  router.replace({ path: '/content', query: { ...q, chapterPath: c.chapterPath, percentage: '0' } });
}

function scrollTocToCurrent(open: boolean) {
  if (!open) return;
  tocRef.value?.querySelector(`[data-path="${CSS.escape(chapterPath)}"]`)?.scrollIntoView({ block: 'center' });
}

function pageScroll(dir: 1 | -1) {
  const el = scrollRef.value;
  if (el) el.scrollBy({ top: dir * (el.clientHeight - 40), behavior: 'smooth' });
}

function onKey(e: KeyboardEvent) {
  if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
  if (e.key === 'ArrowLeft') go(prev.value);
  else if (e.key === 'ArrowRight') go(next.value);
  else if (e.key === ' ' || e.key === 'PageDown') {
    e.preventDefault();
    pageScroll(e.shiftKey ? -1 : 1);
  } else if (e.key === 'PageUp') {
    e.preventDefault();
    pageScroll(-1);
  }
}

useBus(EVENT_CHAPTERS_BOX).on(() => (tocOpen.value = true));

onMounted(() => {
  init();
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  window.clearTimeout(saveTimer);
  saveProgress();
});
</script>

<style scoped>
.reader {
  height: 100%;
  background: var(--read-bg);
  color: var(--read-text);
}
.reader__scroll {
  height: 100%;
  overflow-y: auto;
  outline: none;
}
.reader__body {
  max-width: var(--read-max-width);
  margin: 0 auto;
  padding: 20px 32px 40px;
  font-size: var(--read-font-size);
  line-height: var(--read-line-height);
  letter-spacing: var(--read-letter-spacing);
}
.reader__title {
  font-size: 1.3em;
  margin: 0 0 1em;
  color: inherit;
}
.reader__p {
  margin: 0 0 var(--read-section-spacing);
  text-indent: 2em;
  word-break: break-word;
}
.reader__img {
  max-width: 100%;
  display: block;
  margin: 0 auto var(--read-section-spacing);
}
.reader__manga img {
  display: block;
  width: 100%;
  margin: 0 auto;
}
.reader__web {
  display: block;
  width: 100%;
  height: calc(100vh - 200px);
  min-height: 480px;
  border: 0;
  background: #fff;
}
.reader__fallback {
  margin: 0 auto 10px;
  max-width: 720px;
  padding: 10px 14px;
  border-radius: 8px;
  background: rgba(250, 173, 20, 0.12);
  border: 1px solid rgba(250, 173, 20, 0.35);
}
.reader__tip {
  margin: 4px 0;
  font-size: 12px;
  text-align: center;
  color: var(--we-read-text-muted, #999);
}
.reader__nav {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 30px;
}
.reader__toc-item {
  height: 34px;
  line-height: 34px;
  padding: 0 10px;
  border-radius: 6px;
  cursor: pointer;
}
.reader__toc-item:hover {
  background: var(--we-color-primary-bg);
}
.reader__toc-item.active {
  color: var(--we-color-primary);
  background: var(--we-color-primary-bg);
  font-weight: 600;
}
@media (max-width: 640px) {
  .reader__body {
    padding: 14px 16px 30px;
  }
  .reader__manga {
    margin: 0 -16px;
  }
}
</style>
