import fs from 'node:fs';
import puppeteer, { type Browser } from 'puppeteer-core';

/**
 * 用本机 Chrome 抓「必须跑 JS 才能过」的页面
 *
 * 有些站点（包子漫画的 gatekeeper）会给非浏览器请求发一个 JS 校验页，
 * 纯 HTTP 客户端解完 PoW 之后仍会被拒（服务端还会看 TLS/指纹），
 * 但真实 Chrome 打开就正常。这里用 puppeteer-core 驱动系统已装的 Chrome，
 * 不下载 Chromium，只在需要时启动一次，进程复用。
 */

const CHROME_PATHS =
  process.platform === 'win32'
    ? [
        `${process.env['PROGRAMFILES'] || 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env['LOCALAPPDATA'] || ''}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env['PROGRAMFILES'] || 'C:\\Program Files'}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `${process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'}\\Microsoft\\Edge\\Application\\msedge.exe`
      ]
    : [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium'
      ];

function findChrome(): string {
  for (const p of CHROME_PATHS) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return process.env.CHROME_PATH || '';
}

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const executablePath = findChrome();
    if (!executablePath) throw new Error('没找到本机 Chrome，可用 CHROME_PATH 指定');
    browserPromise = puppeteer
      .launch({
        executablePath,
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
          '--window-size=1280,900'
        ]
      })
      .catch((e) => {
        browserPromise = null;
        throw e;
      });
  }
  return browserPromise;
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface BrowserPage {
  url: string;
  status: number;
  html: string;
}

/** 打开一个页面，等 JS 跑完（校验页面会自动跳回），返回最终 HTML */
export async function browserFetch(url: string, opts: { waitMs?: number; waitFor?: string } = {}): Promise<BrowserPage> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9' });
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const status = res?.status() ?? 0;
    // gatekeeper 是「校验页 → location.replace(原地址)」，给它一点时间跑完
    await new Promise((r) => setTimeout(r, opts.waitMs ?? 2500));
    if (opts.waitFor) {
      await page.waitForSelector(opts.waitFor, { timeout: 8000 }).catch(() => {});
    }
    const html = await page.content();
    return { url: page.url(), status, html };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function closeBrowser() {
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  await b?.close().catch(() => {});
}
