import { onUnmounted } from 'vue';

type Fn = (...args: any[]) => void;
const events = new Map<string, Set<Fn>>();

export const EVENT_CHAPTERS_BOX = 'chapters-box';

/** 简易事件总线，组件卸载时自动解绑 */
export function useBus(name: string) {
  const own = new Set<Fn>();
  onUnmounted(() => {
    own.forEach((fn) => events.get(name)?.delete(fn));
  });
  return {
    on(fn: Fn) {
      if (!events.has(name)) events.set(name, new Set());
      events.get(name)!.add(fn);
      own.add(fn);
    },
    emit(...args: any[]) {
      events.get(name)?.forEach((fn) => fn(...args));
    }
  };
}
