import { load } from 'cheerio';
import { JSONPath } from 'jsonpath-plus';
import type { JSEngine } from './JSEngine';
import { xpath } from './xpath';

export abstract class Analyzer {
  constructor(protected engine: JSEngine) {}
  abstract parse(content: any): void;
  abstract getString(rule: string): Promise<any>;
  abstract getStringList(rule: string): Promise<any[] | any>;
  abstract getElements(rule: string): Promise<any[] | any>;
}

function toText(content: any): string {
  if (Array.isArray(content)) return content.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n');
  if (content && typeof content === 'object') return JSON.stringify(content);
  return content == null ? '' : String(content);
}

// ---------------- CSS (cheerio) ----------------

function htmlDecode(str: string) {
  return str
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/** html -> 带换行的纯文本 */
function htmlToText(html: string) {
  return htmlDecode(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<\/?(?:div|p|br|hr|h\d|article|dd|dl|li)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  );
}

export class AnalyzerHtml extends Analyzer {
  private content = '';

  parse(content: any) {
    this.content = toText(content);
  }

  private result(lastRule: string, html: string): string {
    const $ = load(html, null, false);
    switch (lastRule) {
      case 'text':
        return $.root().text().trim();
      case 'textNodes':
        return $.root()
          .children()
          .map((_, el) => $(el).text())
          .get()
          .join('\n')
          .trim();
      case 'outerHtml':
        return $.html();
      case 'innerHtml':
        return $.root().children().first().html() || '';
      case 'html':
        return htmlToText($.root().children().first().html() || $.html());
      case '':
        return $.html();
    }
    return $.root().children().first().attr(lastRule)?.trim() || '';
  }

  async getStringList(rule: string): Promise<string[]> {
    const at = rule.lastIndexOf('@');
    // 没有 @：与 any-reader 一致，表示对当前元素取值，如 text / href / src
    if (at === -1) return [this.result(rule.trim(), this.content)];
    const selector = rule.substring(0, at).trim();
    const lastRule = rule.substring(at + 1).trim();
    if (!selector) return [this.result(lastRule, this.content)];
    const $ = load(this.content, null, false);
    return $(selector)
      .map((_, el) => this.result(lastRule, $.html(el)))
      .get();
  }

  async getString(rule: string): Promise<string> {
    return (await this.getStringList(rule)).join('  ');
  }

  async getElements(rule: string): Promise<string[]> {
    const $ = load(this.content, null, false);
    return $(rule.trim())
      .map((_, el) => $.html(el))
      .get();
  }
}

// ---------------- JSONPath ----------------

export class AnalyzerJSONPath extends Analyzer {
  private content: any;

  parse(content: any) {
    if (typeof content === 'string') {
      try {
        this.content = JSON.parse(content);
      } catch {
        this.content = {};
      }
    } else this.content = content;
  }

  async getElements(rule: string) {
    const rows = JSONPath({ path: rule.trim(), json: this.content, wrap: true }) as any[];
    if (Array.isArray(rows) && rows.length === 1) return rows[0];
    return rows;
  }

  async getString(rule: string) {
    const val = await this.getElements(rule);
    if (Array.isArray(val)) return val.join('  ');
    if (val && typeof val === 'object') return JSON.stringify(val);
    return val ?? '';
  }

  async getStringList(rule: string) {
    const val = await this.getElements(rule);
    return Array.isArray(val) ? val : [val];
  }
}

// ---------------- XPath ----------------

export class AnalyzerXPath extends Analyzer {
  private content = '';

  parse(content: any) {
    this.content = toText(content);
  }

  async getElements(rule: string) {
    return xpath(this.content, rule.trim());
  }

  async getString(rule: string) {
    return (await this.getElements(rule)).join('  ');
  }

  async getStringList(rule: string) {
    return this.getElements(rule);
  }
}

// ---------------- JavaScript ----------------

export class AnalyzerJS extends Analyzer {
  private content: any;

  parse(content: any) {
    this.content = content;
  }

  async getElements(rule: string) {
    return this.engine.evaluate(rule, { result: this.content });
  }

  async getString(rule: string) {
    const val = await this.getElements(rule);
    return Array.isArray(val) ? val.join('  ') : val;
  }

  async getStringList(rule: string) {
    return this.getElements(rule);
  }
}

// ---------------- 正则 ----------------
// 规则：@regex:表达式  取第一个捕获组(没有分组则取整个匹配)

export class AnalyzerRegExp extends Analyzer {
  private content = '';

  parse(content: any) {
    this.content = toText(content);
  }

  async getElements(rule: string) {
    const re = new RegExp(rule, 'g');
    return Array.from(this.content.matchAll(re)).map((m) => (m.length > 1 ? m[1] : m[0]));
  }

  async getString(rule: string) {
    return (await this.getElements(rule)).join('  ');
  }

  async getStringList(rule: string) {
    return this.getElements(rule);
  }
}

// ---------------- 替换 ----------------

export function replaceSmart(replace: string) {
  if (!replace) return (s: string) => s;
  const r = replace.split('##');
  let match: RegExp;
  try {
    match = new RegExp(r[0], 'g');
  } catch {
    return (s: string) => s;
  }
  if (r.length === 1) return (s: string) => s.replace(match, '');
  const pattern = r[1];
  const onlyFirst = r.length > 2;
  const re = onlyFirst ? new RegExp(r[0]) : match;
  return (s: string) => s.replace(re, pattern);
}

export class AnalyzerReplace extends Analyzer {
  private content = '';

  parse(content: any) {
    this.content = toText(content);
  }

  async getString(rule: string) {
    return replaceSmart(rule)(this.content);
  }

  async getStringList(rule: string) {
    return [await this.getString(rule)];
  }

  async getElements(rule: string) {
    return [await this.getString(rule)];
  }
}
