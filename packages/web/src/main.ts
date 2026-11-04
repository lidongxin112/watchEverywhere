import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Antd from 'ant-design-vue';
import 'ant-design-vue/dist/reset.css';
import './assets/main.css';
import App from './App.vue';
import router from './router';

createApp(App).use(createPinia()).use(router).use(Antd).mount('#app');

// PWA：注册离线外壳（生产构建才有 sw.js）
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[pwa] 注册失败', e?.message || e));
  });
}
