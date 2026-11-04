import fs from 'node:fs';
import path from 'node:path';
import { text2rules } from '@watch-everywhere/core';
import { rulesStore } from './db';
import { pushLog } from './logs';

/**
 * 启动自愈
 *
 * 规则文件被清空 / 损坏时，自动用仓库自带的 rules/aggregate.json 恢复一次，
 * 避免“源全没了”这种需要手动救的情况。
 */

const PACK_CANDIDATES = [
  path.resolve(process.cwd(), 'rules/aggregate.json'),
  path.resolve(process.cwd(), '../../rules/aggregate.json'),
  path.resolve(typeof __dirname !== 'undefined' ? __dirname : process.cwd(), '../../rules/aggregate.json')
];

export async function selfHealRules(): Promise<number> {
  const current = rulesStore.value;
  if (current.length > 0) return 0;

  const pack = PACK_CANDIDATES.find((p) => fs.existsSync(p));
  if (!pack) {
    pushLog('warn', 'self-heal', '规则为空，且找不到内置规则包');
    return 0;
  }
  try {
    const rules = await text2rules(fs.readFileSync(pack, 'utf8'));
    if (!rules.length) return 0;
    rulesStore.set(rules);
    pushLog('warn', 'self-heal', `规则为空，已从内置规则包恢复 ${rules.length} 条`, { pack });
    console.warn(`[self-heal] 规则为空，已从 ${pack} 恢复 ${rules.length} 条`);
    return rules.length;
  } catch (e: any) {
    pushLog('error', 'self-heal', `恢复失败：${e?.message || e}`);
    return 0;
  }
}
