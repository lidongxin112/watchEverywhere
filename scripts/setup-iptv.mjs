#!/usr/bin/env node
/**
 * 安装 / 更新内置 iPTV（https://github.com/akiralereal/iptv）到 vendor/iptv
 *
 *   node scripts/setup-iptv.mjs           没装就安装（npm install 时自动执行）
 *   node scripts/setup-iptv.mjs --update  拉取最新代码并更新依赖
 *
 * 环境变量：
 *   WE_IPTV=0          跳过（不使用内置 iPTV）
 *   WE_IPTV_REPO=...   自定义仓库地址（例如镜像站）
 *
 * 失败不会中断 watchEverywhere 本身的安装。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'vendor', 'iptv');
const repo = process.env.WE_IPTV_REPO || 'https://github.com/akiralereal/iptv.git';
const update = process.argv.includes('--update');
const isWin = process.platform === 'win32';

const log = (msg) => console.log(`\x1b[36m[iptv]\x1b[0m ${msg}`);
const warn = (msg) => console.warn(`\x1b[33m[iptv]\x1b[0m ${msg}`);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: isWin, ...opts });
  return r.status === 0;
}

/** 系统已安装的 Chrome / Chromium / Edge（iPTV 网页抓取需要浏览器，有就不用再下载一份） */
export function findChrome() {
  const list =
    process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
        ]
      : isWin
        ? [
            `${process.env['PROGRAMFILES'] || 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
            `${process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'}\\Microsoft\\Edge\\Application\\msedge.exe`
          ]
        : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
  return list.find((p) => fs.existsSync(p)) || '';
}

function main() {
  if (process.env.WE_IPTV === '0') {
    log('WE_IPTV=0，跳过内置 iPTV');
    return;
  }

  if (!fs.existsSync(path.join(dir, 'app.js'))) {
    log(`下载 iPTV 到 ${path.relative(root, dir)} ...`);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    if (!run('git', ['clone', '--depth', '1', repo, dir])) {
      warn('下载失败（需要安装 git 并能访问 GitHub）。可以稍后执行 npm run iptv:update 重试，');
      warn('或设置 WE_IPTV_REPO 使用镜像地址。watchEverywhere 其它功能不受影响。');
      return;
    }
  } else if (update) {
    log('拉取最新代码 ...');
    if (!run('git', ['-C', dir, 'pull', '--ff-only'])) warn('更新代码失败，继续使用当前版本');
  } else if (fs.existsSync(path.join(dir, 'node_modules'))) {
    log('已安装，跳过（更新请执行 npm run iptv:update）');
    return;
  }

  const env = { ...process.env };
  // 在根项目 postinstall 里执行时，别把工作区相关的 npm 配置带给 iPTV 自己的安装
  for (const k of Object.keys(env)) if (/^npm_config_(workspace|workspaces|include_workspace_root|prefix|global)$/i.test(k)) delete env[k];
  const chrome = findChrome();
  if (chrome) {
    // 用系统浏览器，省掉 puppeteer 自带的 ~150MB Chromium 下载
    env.PUPPETEER_SKIP_DOWNLOAD = 'true';
    log(`使用系统浏览器：${chrome}`);
  } else {
    log('没有找到系统 Chrome，将由 puppeteer 下载 Chromium（用于网页抓取类频道）');
  }

  log('安装 iPTV 依赖 ...');
  const hasLock = fs.existsSync(path.join(dir, 'package-lock.json'));
  const ok = run('npm', [hasLock ? 'ci' : 'install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: dir, env });
  if (!ok) {
    warn('iPTV 依赖安装失败，可以稍后执行 npm run iptv:update 重试。watchEverywhere 其它功能不受影响。');
    return;
  }
  log('完成 ✓ 启动 watchEverywhere 时会自动运行 iPTV');
}

main();
