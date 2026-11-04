import type Hls from 'hls.js';
import { filterAds, parseAdPatterns, type AdFilterResult } from './adfilter';

/**
 * 给 hls.js 用的清单加载器：清单下载完后先过滤广告分片，再交给 hls.js 解析。
 * 直连和转发播放都会经过这里，所以两种方式都能去广告。
 */
export function createAdFilterLoader(HlsLib: typeof Hls, patterns: string, onFiltered: (r: AdFilterResult) => void) {
  const Base: any = HlsLib.DefaultConfig.loader;
  const extraPatterns = parseAdPatterns(patterns);

  return class AdFilterLoader extends Base {
    load(context: any, config: any, callbacks: any) {
      if (context?.type === 'manifest' || context?.type === 'level') {
        const onSuccess = callbacks.onSuccess;
        callbacks = {
          ...callbacks,
          onSuccess: (response: any, stats: any, ctx: any, details: any) => {
            if (typeof response?.data === 'string') {
              try {
                const r = filterAds(response.data, response.url || ctx?.url || location.href, { extraPatterns });
                if (r.removed) {
                  response.data = r.text;
                  onFiltered(r);
                }
              } catch {
                /* 过滤出错就用原清单 */
              }
            }
            onSuccess(response, stats, ctx, details);
          }
        };
      }
      super.load(context, config, callbacks);
    }
  };
}
