import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:8898'
    }
  },
  build: {
    // 构建到 server/public，由服务端直接托管
    outDir: fileURLToPath(new URL('../server/public', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000
  }
});
