import { fileURLToPath, URL } from 'node:url';
import fs from 'node:fs';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'));

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
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
