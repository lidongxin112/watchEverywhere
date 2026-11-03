export * from './rule';
export * from './exception';
export * from './request';
export * from './JSEngine';
export * from './analyzers';
export * from './AnalyzerManager';
export * from './RuleManager';
export { xpath } from './xpath';

import type { Rule } from './rule';
import { RuleManager } from './RuleManager';

export function createRuleManager(rule: Rule) {
  return new RuleManager(rule);
}
