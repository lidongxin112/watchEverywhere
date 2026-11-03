#!/usr/bin/env node
/**
 * 打包桌面版（单文件可执行程序，Node SEA）
 *
 *   node scripts/build-desktop.mjs                 # 当前平台
 *   node scripts/build-desktop.mjs all             # mac-arm64 / mac-x64 / win-x64
 *   node scripts/build-desktop.mjs mac-arm64 win-x64
 *
 * 产物：dist/watchEverywhere-<platform>[.exe]
 *
 * 做法：
 *  1. 构建前端（packages/server/public）
 *  2. esbuild 把服务端打成一个 CJS（dist/app/entry.cjs）
 *  3. 把前端产物转成 base64 塞进 JS（dist/app/public-assets.json），运行时从内存托管
 *  4. node --experimental-sea-config 生成 blob，注入 Node 二进制（postject）
 *  5. macOS 重新 ad-hoc 签名
 *
 * 其它平台的 Node 二进制会从 nodejs.org 下载并缓存到 ~/.watch-everywhere/node-runtime
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const distDir = path.join(root, 'dist');
const appDir = path.join(distDir, 'app');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const NODE_VERSION = process.version.replace(/^v/, '');
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const PLATFORMS = {
  'mac-arm64': { nodeDir: `node-v${NODE_VERSION}-darwin-arm64`, bin: 'bin/node', ext: '' },
  'mac-x64': { nodeDir: `node-v${NODE_VERSION}-darwin-x64`, bin: 'bin/node', ext: '' },
  'win-x64': { nodeDir: `node-v${NODE_VERSION}-win-x64`, bin: 'node.exe', ext: '.exe' },
  'linux-x64': { nodeDir: `node-v${NODE_VERSION}-linux-x64`, bin: 'bin/node', ext: '' }
};

const args = process.argv.slice(2);
const current = `mac-${process.arch === 'x64' ? 'x64' : 'arm64'}`;
const wanted = args.includes('all')
  ? ['mac-arm64', 'mac-x64', 'win-x64']
  : args.length
    ? args
    : [process.platform === 'darwin' ? current : process.platform === 'win32' ? 'win-x64' : 'linux-x64'];

const sh = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { cwd: root, stdio: 'inherit', ...opts });

async function download(url, file) {
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  console.log(`  下载 ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

/** 取得目标平台的原版 node 可执行文件 */
async function nodeBinaryFor(platform) {
  const cfg = PLATFORMS[platform];
  const local = path.join(process.execPath);
  const hostMatches =
    (platform === 'mac-arm64' && process.platform === 'darwin' && process.arch === 'arm64') ||
    (platform === 'mac-x64' && process.platform === 'darwin' && process.arch === 'x64') ||
    (platform === 'linux-x64' && process.platform === 'linux' && process.arch === 'x64');

  if (hostMatches) return local;

  const cacheRoot = path.join(os.homedir(), '.watch-everywhere', 'node-runtime');
  const binPath = path.join(cacheRoot, cfg.nodeDir, cfg.bin);
  if (fs.existsSync(binPath)) return binPath;

  const ext = platform.startsWith('win') ? 'zip' : 'tar.xz';
  const archive = path.join(cacheRoot, `${cfg.nodeDir}.${ext}`);
  await download(`https://nodejs.org/dist/v${NODE_VERSION}/${cfg.nodeDir}.${ext}`, archive);
  fs.mkdirSync(path.join(cacheRoot, cfg.nodeDir), { recursive: true });
  if (ext === 'zip') sh('unzip', ['-qo', archive, '-d', cacheRoot]);
  else sh('tar', ['-xJf', archive, '-C', cacheRoot]);
  if (!fs.existsSync(binPath)) throw new Error(`解压后没找到 ${binPath}`);
  return binPath;
}

async function buildOne(platform) {
  const cfg = PLATFORMS[platform];
  if (!cfg) throw new Error(`未知平台 ${platform}`);
  console.log(`\n=== ${platform} ===`);

  const nodeBin = await nodeBinaryFor(platform);
  const out = path.join(distDir, `watchEverywhere-${platform}${cfg.ext}`);
  fs.copyFileSync(nodeBin, out);
  fs.chmodSync(out, 0o755);

  if (platform.startsWith('mac')) {
    try {
      sh('codesign', ['--remove-signature', out], { stdio: 'ignore' });
    } catch {
      /* 未签名的副本会报错，忽略 */
    }
  }

  const postjectArgs = [
    'postject',
    out,
    'NODE_SEA_BLOB',
    path.join(appDir, 'sea-prep.blob'),
    '--sentinel-fuse',
    SEA_FUSE,
    ...(platform.startsWith('mac') ? ['--macho-segment-name', 'NODE_SEA'] : [])
  ];
  sh('npx', ['--yes', ...postjectArgs], { stdio: 'inherit' });

  if (platform.startsWith('mac')) sh('codesign', ['--sign', '-', '--force', out], { stdio: 'ignore' });

  const size = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
  console.log(`  ✓ ${path.relative(root, out)}  ${size} MB`);
}

async function main() {
  console.log(`[1/4] 构建前端 v${version}`);
  sh('npm', ['run', 'build']);

  console.log('[2/4] 打包服务端');
  fs.mkdirSync(appDir, { recursive: true });
  sh('npx', [
    'esbuild',
    'packages/server/src/desktop.ts',
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node20',
    `--outfile=${path.join(appDir, 'entry.cjs')}`,
    '--log-level=error'
  ]);

  console.log('[3/4] 内联前端资源 + 生成 SEA blob');
  const assets = {};
  const walk = (dir, prefix = '') => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (fs.statSync(abs).isDirectory()) walk(abs, `${prefix}/${name}`);
      else assets[`${prefix}/${name}`] = fs.readFileSync(abs).toString('base64');
    }
  };
  walk(path.join(root, 'packages/server/public'));
  fs.writeFileSync(path.join(appDir, 'public-assets.json'), JSON.stringify(assets));
  console.log(`  ${Object.keys(assets).length} 个静态文件已内联`);

  fs.writeFileSync(
    path.join(appDir, 'sea-entry.cjs'),
    "globalThis.__WE_ASSETS__ = require('./public-assets.json');\nrequire('./entry.cjs');\n"
  );
  sh('npx', [
    'esbuild',
    path.join(appDir, 'sea-entry.cjs'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node20',
    `--outfile=${path.join(appDir, 'sea.cjs')}`,
    '--log-level=error'
  ]);
  fs.writeFileSync(
    path.join(appDir, 'sea-config.json'),
    JSON.stringify({ main: 'dist/app/sea.cjs', output: 'dist/app/sea-prep.blob', disableExperimentalSEAWarning: true }, null, 2)
  );
  sh(process.execPath, ['--experimental-sea-config', path.join(appDir, 'sea-config.json')], { stdio: 'inherit' });

  console.log('[4/4] 生成可执行文件');
  for (const p of wanted) await buildOne(p);

  console.log('\n完成。运行时环境变量：');
  console.log('  PORT=8898           监听端口（也会自动打开浏览器）');
  console.log('  WE_NO_OPEN=1        不自动开浏览器');
  console.log('  WE_DATA_DIR=...     数据目录（默认 ~/.watch-everywhere）');
  console.log('  WE_UPDATE_URL=...   更新清单地址');
  console.log('  WE_NOTICE_URL=...   公告地址');
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
