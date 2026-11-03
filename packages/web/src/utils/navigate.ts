import { useRouter } from 'vue-router';
import type { ResourceItem } from '@/api';

/** 打开资源详情（章节 / 剧集列表） */
export function useOpenResource() {
  const router = useRouter();
  return (item: ResourceItem, ruleId = item.ruleId) => {
    router.push({
      path: '/chapter',
      query: {
        ruleId,
        filePath: item.url,
        name: item.name,
        cover: item.cover || '',
        author: item.author || '',
        chapter: item.chapter || '',
        description: (item.description || '').slice(0, 500)
      }
    });
  };
}
