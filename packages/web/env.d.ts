/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, any>;
  export default component;
}

/** ASS 特效字幕渲染器（按 any 使用） */
declare module 'assjs';
