#!/usr/bin/env node
/**
 * 一键停掉 watchEverywhere 相关的一切：
 *   - 本项目 node_modules 下的 tsx / vite / concurrently / esbuild
 *   - 占用 8898（服务）、5173~5190（前端 dev）、1905（内置 iPTV）、8990~8999（测试实例）的进程
 *   - 打包版可执行文件（dist/watchEverywhere-*）
 *
 * 用法：npm run stop   或   node scripts/stop.mjs [--hard]
 */
import { execSync } from 'node:child_process';

const HARD = process.argv.includes('--hard');
const SELF = process.pid;
const PORT_RE = /:(8898|1905|8899|899\d|51[7-9]\d)$/;

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8' });
  } catch {
    return '';
  }
}

function collect() {
  const pids = new Set();

  // 1) 按命令行匹配：只杀本项目 node_modules 下的进程，避免误伤别的 node
  const ps = run('ps ax -o pid=,stat=,command=');
  for (const line of ps.split('\n')) {
    const m = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const [, pid, stat, cmd] = m;
    if (Number(pid) === SELF) continue;
    if (/\bgrep\b|scripts\/stop\.mjs/.test(cmd)) continue;
    if (
      cmd.includes('/Users/tom/XWLZ/code/watchEverywhere/node_modules') ||
      /dist\/watchEverywhere-(mac|win|linux)/.test(cmd) ||
      /packages\/server\/src\/run\.ts/.test(cmd)
    ) {
      pids.add(Number(pid));
      void stat;
    }
  }

  // 2) 按端口匹配：抓本项目常用端口上的监听进程
  const lsof = run('lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null');
  for (const line of lsof.split('\n')) {
    const cols = line.split(/\s+/);
    if (cols.length < 9) continue;
    const pid = Number(cols[1]);
    const addr = cols[8];
    if (!pid || pid === SELF) continue;
    if (PORT_RE.test(addr)) pids.add(pid);
  }
  return [...pids];
}

const pids = collect();
if (!pids.length) {
  console.log('没有正在运行的 watchEverywhere 进程');
  process.exit(0);
}

console.log(`要停止的进程：${pids.join(' ')}`);
for (const pid of pids) {
  try {
    process.kill(pid, HARD ? 'SIGKILL' : 'SIGTERM');
  } catch {
    /* 已经没了 */
  }
}

// 给 3 秒优雅退出，然后补刀
await new Promise((r) => setTimeout(r, HARD ? 300 : 3000));
const left = collect();
for (const pid of left) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* ignore */
  }
}

const stillListening = run('lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null')
  .split('\n')
  .filter((l) => PORT_RE.test(l.split(/\s+/)[8] || ''));
console.log(stillListening.length ? `仍有端口在监听：\n${stillListening.join('\n')}` : '已全部停止（8898 / 5173-5190 / 1905 均已释放）');
