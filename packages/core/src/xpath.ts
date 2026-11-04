import { DOMParser } from '@xmldom/xmldom';
import * as xpathLib from 'xpath';

/**
 * 执行 XPath，返回字符串数组。
 * 元素节点返回 outerHTML，属性/文本节点返回其值。
 */
export function xpath(html: string, path: string): string[] {
  const doc = new DOMParser({ onError: () => {} }).parseFromString(html || '<html></html>', 'text/html');
  // isHtml: 让不带前缀的标签名匹配 xhtml 命名空间下的元素
  // xpath 的类型声明里没有 parse（运行时才有），这里绕开类型
  const parse = (xpathLib as any).parse as (p: string) => { select: (ctx: any) => any };
  const nodes: any = parse(path).select({ node: doc as any, isHtml: true });
  if (!Array.isArray(nodes)) return [String(nodes)];
  return nodes.map((n: any) => {
    switch (n.nodeType) {
      case 2: // attribute
        return n.value;
      case 3: // text
      case 4: // cdata
        return n.data;
      default:
        return n.toString();
    }
  });
}
