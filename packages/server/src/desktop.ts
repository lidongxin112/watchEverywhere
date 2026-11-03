import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';

/**
 * 桌面版入口
 *
 * 和 `npm start` 一样起本地服务，区别是：
 *  - 前端产物用「内置资源目录 public」，不是开发目录
 *  - 启动后自动打开默认浏览器
 *  - Ctrl+C / 关闭窗口时顺手收掉 puppeteer 拉起的 Chrome
 *
 * 打包由 scripts/build-desktop.mjs 完成（esbuild 打成一个 CJS 文件，再用 pkg 生成可执行文件）。
 */

const HERE = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
const bundled = path.join(HERE, 'public');
if (!process.env.WE_PUBLIC_DIR && fs.existsSync(bundled)) process.env.WE_PUBLIC_DIR = bundled;

const PORT = Number(process.env.PORT) || 8898;
const URL_ = `http://127.0.0.1:${PORT}`;

function openBrowser(url: string) {
  const cmd =
    process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {
    /* 打不开就算了，终端里有地址 */
  });
}

async function main() {
  const { start } = await import('./index');
  const { closeBrowser } = await import('./browser');
  start(PORT);
  if (!process.env.WE_NO_OPEN) setTimeout(() => openBrowser(URL_), 800);

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
      await closeBrowser().catch(() => {});
      process.exit(0);
    });
  }
}

main();
