import { start } from './index';
import { closeBrowser } from './browser';

start();

// 退出时收掉 puppeteer 拉起的 Chrome，避免残留进程
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await closeBrowser().catch(() => {});
    process.exit(0);
  });
}
