import { createRouter, createWebHashHistory } from 'vue-router';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      component: () => import('@/pages/layout/AppLayout.vue'),
      redirect: '/home',
      children: [
        { path: 'home', name: 'home', component: () => import('@/pages/home/index.vue'), meta: { keepAlive: true, title: '首页' } },
        { path: 'search', name: 'search', component: () => import('@/pages/search/index.vue'), meta: { keepAlive: true, title: '搜索' } },
        {
          path: 'category/:contentType?',
          name: 'category',
          component: () => import('@/pages/category/index.vue'),
          meta: { keepAlive: true, title: '发现' }
        },
        { path: 'live', name: 'live', component: () => import('@/pages/live/index.vue'), meta: { title: '直播' } },
        { path: 'chapter', name: 'chapter', component: () => import('@/pages/chapter/index.vue'), meta: { title: '目录' } },
        { path: 'content', name: 'content', component: () => import('@/pages/content/index.vue'), meta: { title: '阅读' } },
        { path: 'player', name: 'player', component: () => import('@/pages/player/index.vue'), meta: { title: '播放' } },
        { path: 'rules', name: 'rules', component: () => import('@/pages/rules/index.vue'), meta: { title: '规则' } },
        { path: 'rule-info', name: 'ruleInfo', component: () => import('@/pages/rule-info/index.vue'), meta: { title: '编辑规则' } }
      ]
    },
    { path: '/:pathMatch(.*)*', redirect: '/home' }
  ]
});

router.afterEach((to) => {
  const t = to.meta.title as string | undefined;
  document.title = t ? `${t} - watchEverywhere` : 'watchEverywhere';
});

export default router;
