/** 最近的接口错误，诊断导出用（内存环形缓冲，不落盘） */

export interface LogRow {
  time: number;
  level: 'warn' | 'error';
  scope: string;
  message: string;
}

const MAX = 300;
const rows: LogRow[] = [];

export function pushLog(level: LogRow['level'], scope: string, message: string) {
  rows.push({ time: Date.now(), level, scope, message: String(message).slice(0, 800) });
  if (rows.length > MAX) rows.splice(0, rows.length - MAX);
}

export function getLogs(): LogRow[] {
  return [...rows];
}

export function clearLogs() {
  rows.length = 0;
}
