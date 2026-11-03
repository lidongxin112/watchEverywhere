import vm from 'node:vm';
import CryptoJS from 'crypto-js';
import * as cheerio from 'cheerio';
import type { Rule } from './rule';
import { httpText } from './request';
import { JsVmException } from './exception';
import { xpath } from './xpath';

/**
 * 规则 JS 沙箱。
 * 与原项目的全局静态引擎不同，这里每个规则实例一个引擎，并发搜索时变量互不干扰。
 */
export class JSEngine {
  private environment: Record<string, any> = {};
  private ctx: vm.Context;
  private rule?: Rule;

  constructor(rule?: Rule) {
    this.rule = rule;
    const http = (url: string) => httpText(url, rule as Rule);
    http.get = (url: string) => http(url);
    this.ctx = vm.createContext({
      console,
      CryptoJS,
      cheerio,
      xpath,
      http,
      __http__: http,
      fetch: globalThis.fetch?.bind(globalThis),
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      atob: globalThis.atob,
      btoa: globalThis.btoa,
      setTimeout,
      clearTimeout,
      window: {}
    });
  }

  setEnvironment(env: Record<string, any>) {
    Object.assign(this.environment, env);
  }

  getEnvironment(key: string) {
    return this.environment[key];
  }

  async evaluate(code: string, context: Record<string, any> = {}): Promise<any> {
    let script = '';
    if (this.rule?.loadJs) script += this.rule.loadJs + ';\n';
    script += code;
    try {
      Object.assign(this.ctx, this.environment, context);
      const r = vm.runInContext(script, this.ctx, { timeout: 10000 });
      return r && typeof r.then === 'function' ? await r : r;
    } catch (error: any) {
      throw new JsVmException(error?.message || String(error));
    }
  }
}
