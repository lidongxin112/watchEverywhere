export class FetchException extends Error {
  name = 'FetchException';
}

export class JsVmException extends Error {
  name = 'JsVmException';
}

export class AnalyzerException extends Error {
  name = 'AnalyzerException';
}

/** 把内部异常转成给用户看的提示 */
export function friendlyMessage(err: unknown): string {
  if (err instanceof FetchException) return `网络请求异常: ${err.message}`;
  if (err instanceof JsVmException) return `执行脚本异常: ${err.message}`;
  if (err instanceof AnalyzerException) return `规则解析异常: ${err.message}`;
  return (err as Error)?.message || String(err);
}
