#!/usr/bin/env node
/**
 * 生成更新清单 latest.json
 *
 *   node scripts/make-manifest.mjs                       # 用 package.json 的版本号
 *   node scripts/make-manifest.mjs 0.2.0 "修复播放器"     # 指定版本和更新说明
 *
 * 会扫描 dist/ 下的可执行文件，生成带 size + sha256 的 latest.json，
 * 配合 WE_UPDATE_URL 使用（客户端「检查更新」读的就是这个文件）。
 *
 * 发布（GitHub Releases 为例）：
 *   gh release create v0.2.0 dist/watchEverywhere-* dist/latest.json \
 *     --title "v0.2.0" --notes "更新说明"
 *   然后把 latest.json 里的 url 换成 Release 的下载地址（或用下面 BASE_URL 自动拼接）
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const distDir = path.join(root, 'dist');
const pkgVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

const version = process.argv[2] || pkgVersion;
const notes = process.argv[3] || process.env.WE_RELEASE_NOTES || '';
/** 资源前缀：默认读环境变量，方便 CI 里指到 Release 地址 */
const baseUrl = (process.env.WE_RELEASE_BASE || 'https://example.com/watchEverywhere').replace(/\/$/, '');

const FILES = {
  'watchEverywhere-mac-arm64': 'mac-arm64',
  'watchEverywhere-mac-x64': 'mac-x64',
  'watchEverywhere-win-x64.exe': 'win-x64',
  'watchEverywhere-linux-x64': 'linux-x64'
};

const platforms = {};
for (const [file, key] of Object.entries(FILES)) {
  const abs = path.join(distDir, file);
  if (!fs.existsSync(abs)) continue;
  const buf = fs.readFileSync(abs);
  platforms[key] = {
    url: `${baseUrl}/${file}`,
    size: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex')
  };
}

if (!Object.keys(platforms).length) {
  console.error('dist/ 里没有可执行文件，先跑 node scripts/build-desktop.mjs');
  process.exit(1);
}

const manifest = { version, publishedAt: new Date().toISOString().slice(0, 10), notes, platforms };
const out = path.join(distDir, 'latest.json');
fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
console.log(`已生成 ${path.relative(root, out)}`);
console.log(JSON.stringify(manifest, null, 2));
