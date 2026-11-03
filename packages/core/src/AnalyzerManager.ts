import { JSEngine } from './JSEngine';
import { AnalyzerException, JsVmException } from './exception';
import {
  Analyzer,
  AnalyzerHtml,
  AnalyzerJS,
  AnalyzerJSONPath,
  AnalyzerRegExp,
  AnalyzerReplace,
  AnalyzerXPath,
  replaceSmart
} from './analyzers';

type AnalyzerCtor = new (engine: JSEngine) => Analyzer;

interface AnalyzerDef {
  /** 规则前缀匹配 */
  pattern: RegExp;
  /** 需要从规则中去除的前缀 */
  strip: RegExp;
  Analyzer: AnalyzerCtor;
}

/** 解析器顺序决定默认值：未写前缀时按 CSS 处理 */
const ANALYZERS: AnalyzerDef[] = [
  { pattern: /^@css:/i, strip: /^@css:/i, Analyzer: AnalyzerHtml },
  { pattern: /^@json:|^\$/i, strip: /^@json:/i, Analyzer: AnalyzerJSONPath },
  { pattern: /^@xpath:|^\//i, strip: /^@xpath:/i, Analyzer: AnalyzerXPath },
  { pattern: /^@js:/i, strip: /^@js:/i, Analyzer: AnalyzerJS },
  { pattern: /^@regexp?:|^@match:|^:/i, strip: /^@regexp?:|^@match:|^:/i, Analyzer: AnalyzerRegExp },
  { pattern: /^@replace:/i, strip: /^@replace:/i, Analyzer: AnalyzerReplace }
];

const RULE_TYPE_PATTERN = /@css:|@json:|@xpath:|@match:|@regexp?:|@replace:/gi;

class SingleRule {
  constructor(
    public analyzer: Analyzer,
    public rule: string,
    public replace = ''
  ) {}
}

function joinValues(val: any): string {
  if (val === null || val === undefined) return '';
  if (Array.isArray(val))
    return val
      .map((s) => (s === undefined || s === null ? '' : typeof s === 'object' ? JSON.stringify(s) : String(s).trim()))
      .filter((s) => s)
      .join('  ');
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val).trim();
}

/**
 * 规则解析管理器
 * - 规则可以串联：`@css:.list@json:$.a`，从左到右依次处理
 * - `##` 后面是正则替换：`选择器@text##正则##替换为`
 * - `&&` 合并多个规则结果，`||` 取第一个有值的结果
 * - `{{规则}}` 模板拼接
 * - `@js:` 之后的内容整体作为 JS 执行
 */
export class AnalyzerManager {
  constructor(public engine: JSEngine = new JSEngine()) {}

  private getAnalyzer(rule: string) {
    return ANALYZERS.find((a) => a.pattern.test(rule)) || ANALYZERS[0];
  }

  private createSingle(r: string): SingleRule {
    const def = this.getAnalyzer(r);
    const body = r.replace(def.strip, '');
    const analyzer = new def.Analyzer(this.engine);
    if (def.Analyzer === AnalyzerJS) return new SingleRule(analyzer, body, '');
    const pos = body.indexOf('##');
    if (pos > -1) return new SingleRule(analyzer, body.substring(0, pos), body.substring(pos + 2));
    return new SingleRule(analyzer, body, '');
  }

  /** 把串联规则拆成多个单规则 */
  splitRule(rule: string): SingleRule[] {
    let head = rule;
    let jsPart = '';
    const jsIdx = rule.search(/@js:/i);
    if (jsIdx > -1) {
      head = rule.substring(0, jsIdx);
      jsPart = rule.substring(jsIdx);
    }
    const list: SingleRule[] = [];
    if (head) {
      const starts = [0];
      for (const m of head.matchAll(RULE_TYPE_PATTERN)) if (m.index! > 0) starts.push(m.index!);
      starts.push(head.length);
      for (let i = 0; i < starts.length - 1; i++) {
        const part = head.substring(starts[i], starts[i + 1]);
        if (part) list.push(this.createSingle(part));
      }
    }
    if (jsPart) list.push(this.createSingle(jsPart));
    return list;
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      if (error instanceof JsVmException) throw error;
      throw new AnalyzerException(error?.message || String(error));
    }
  }

  // ---------------- 元素列表 ----------------

  private async _getElements(r: SingleRule, rule = r.rule): Promise<any> {
    if (r.analyzer instanceof AnalyzerJS) return this.run(() => r.analyzer.getElements(rule));
    if (rule.includes('&&')) {
      const result: any[] = [];
      for (const sub of rule.split('&&')) {
        const temp = await this._getElements(r, sub);
        if (Array.isArray(temp)) result.push(...temp);
        else if (temp) result.push(temp);
      }
      return result;
    }
    if (rule.includes('||')) {
      for (const sub of rule.split('||')) {
        const temp = await this._getElements(r, sub);
        if (Array.isArray(temp) ? temp.length : temp) return temp;
      }
      return [];
    }
    return this.run(() => r.analyzer.getElements(rule));
  }

  async getElements(rule: string, body: any): Promise<any[]> {
    if (!rule) return [];
    let temp: any = body;
    for (const r of this.splitRule(rule)) {
      r.analyzer.parse(temp);
      temp = await this._getElements(r);
    }
    if (temp === undefined || temp === null || temp === '') return [];
    return Array.isArray(temp) ? temp : [temp];
  }

  // ---------------- 字符串 ----------------

  private async _getString(r: SingleRule, rule = r.rule): Promise<string> {
    if (r.analyzer instanceof AnalyzerJS) return joinValues(await this.run(() => r.analyzer.getString(rule)));
    if (rule.includes('&&')) {
      const rs: string[] = [];
      for (const sub of rule.split('&&')) {
        const temp = await this._getString(r, sub);
        if (temp) rs.push(temp);
      }
      return rs.join('  ');
    }
    if (rule.includes('||')) {
      for (const sub of rule.split('||')) {
        const temp = await this._getString(r, sub);
        if (temp) return temp;
      }
      return '';
    }
    const val = joinValues(await this.run(() => r.analyzer.getString(rule)));
    // ## 替换作用在每个 && / || 分支的结果上
    return r.replace && val ? replaceSmart(r.replace)(val).trim() : val;
  }

  async getString(rule: string, body: any): Promise<string> {
    if (!rule) return '';
    if (/\{\{[\s\S]*?\}\}/.test(rule) && !/^@js:/i.test(rule)) {
      const rs: string[] = [];
      let pos = 0;
      for (const m of rule.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
        rs.push(rule.substring(pos, m.index));
        pos = m.index! + m[0].length;
        rs.push(await this.getString(m[1], body));
      }
      rs.push(rule.substring(pos));
      return rs.join('');
    }
    let temp: any = body;
    for (const r of this.splitRule(rule)) {
      r.analyzer.parse(temp);
      temp = await this._getString(r);
    }
    return typeof temp === 'string' ? temp : joinValues(temp);
  }

  // ---------------- 字符串列表 ----------------

  private async _getStringList(r: SingleRule, rule = r.rule): Promise<any[]> {
    const norm = (v: any) =>
      (Array.isArray(v) ? v : [v]).map((s) => (typeof s === 'string' ? s.trim() : s)).filter((s) => s !== '' && s !== undefined && s !== null);
    if (r.analyzer instanceof AnalyzerJS) return norm(await this.run(() => r.analyzer.getStringList(rule)));
    if (rule.includes('&&')) {
      const result: any[] = [];
      for (const sub of rule.split('&&')) result.push(...(await this._getStringList(r, sub)));
      return result;
    }
    if (rule.includes('||')) {
      for (const sub of rule.split('||')) {
        const temp = await this._getStringList(r, sub);
        if (temp.length) return temp;
      }
      return [];
    }
    const list = norm(await this.run(() => r.analyzer.getStringList(rule)));
    return r.replace ? list.map((s) => replaceSmart(r.replace)(typeof s === 'string' ? s : JSON.stringify(s))) : list;
  }

  async getStringList(rule: string, body: any): Promise<string[]> {
    if (!rule) return [];
    let temp: any = body;
    for (const r of this.splitRule(rule)) {
      r.analyzer.parse(temp);
      temp = await this._getStringList(r);
    }
    return (Array.isArray(temp) ? temp : [temp]).map((s) => (typeof s === 'string' ? s : JSON.stringify(s)));
  }

  // ---------------- 地址 ----------------

  async parseJsUrl(url: string): Promise<any> {
    if (typeof url === 'string' && /^@js:/i.test(url.trim())) return this.engine.evaluate(url.trim().substring(4));
    return url;
  }

  async getUrl(rule: string, host = '', body: any = ''): Promise<string> {
    let url = await this.getString(rule, body);
    if (typeof url !== 'string') return url;
    host = host.replace(/\/$/, '');
    if (url.startsWith('//')) url = (host.startsWith('https') ? 'https:' : 'http:') + url;
    else if (url.startsWith('/')) url = host + url;
    return url;
  }
}
