export enum ContentType {
  MANGA = 0,
  NOVEL = 1,
  VIDEO = 2,
  AUDIO = 3
}

export const CONTENT_TYPES = [
  { value: ContentType.VIDEO, label: '视频' },
  { value: ContentType.NOVEL, label: '小说' },
  { value: ContentType.MANGA, label: '漫画' },
  { value: ContentType.AUDIO, label: '音频' }
];

export function contentTypeLabel(v?: number) {
  return CONTENT_TYPES.find((e) => e.value === v)?.label || '未知';
}

declare const __APP_VERSION__: string;
export const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

export interface Rule {
  id: string;
  name: string;
  host: string;
  sort: number;
  contentType: ContentType;
  loadJs: string;
  author: string;
  userAgent: string;
  group?: string;
  enableSearch: boolean;
  searchUrl: string;
  searchList: string;
  searchCover: string;
  searchName: string;
  searchAuthor: string;
  searchChapter: string;
  searchDescription: string;
  searchResult: string;
  chapterUrl: string;
  chapterList: string;
  chapterName: string;
  chapterCover: string;
  chapterTime: string;
  chapterResult: string;
  enableMultiRoads: boolean;
  chapterRoads: string;
  chapterRoadName?: string;
  enableDiscover: boolean;
  discoverUrl: string;
  discoverList: string;
  discoverName: string;
  discoverCover: string;
  discoverAuthor: string;
  discoverDescription: string;
  discoverResult: string;
  discoverTags: string;
  discoverChapter: string;
  discoverNextUrl: string;
  contentUrl: string;
  contentNextUrl: string;
  contentItems: string;
  contentDecoder: string;
  extra?: { ping?: number; [k: string]: any };
  [k: string]: any;
}

/** 新规则默认值（id 由服务端生成） */
export function defaultRule(): Rule {
  return {
    id: '',
    name: '',
    host: '',
    sort: 0,
    contentType: ContentType.VIDEO,
    loadJs: '',
    author: '',
    userAgent: '',
    group: '',
    enableSearch: true,
    searchUrl: '',
    searchList: '',
    searchCover: '',
    searchName: '',
    searchAuthor: '',
    searchChapter: '',
    searchDescription: '',
    searchResult: '',
    chapterUrl: '',
    chapterList: '',
    chapterName: '',
    chapterCover: '',
    chapterTime: '',
    chapterResult: '',
    enableMultiRoads: false,
    chapterRoads: '',
    chapterRoadName: '',
    enableDiscover: false,
    discoverUrl: '',
    discoverList: '',
    discoverName: '',
    discoverCover: '',
    discoverAuthor: '',
    discoverDescription: '',
    discoverResult: '',
    discoverTags: '',
    discoverChapter: '',
    discoverNextUrl: '',
    contentUrl: '',
    contentNextUrl: '',
    contentItems: '',
    contentDecoder: ''
  };
}

export interface FormItem {
  prop: keyof Rule;
  label: string;
  step: number;
  type?: 'input' | 'textarea' | 'select' | 'number' | 'switch';
  options?: { value: any; label: string }[];
  /** 可以点击调试 */
  debug?: boolean;
  placeholder?: string;
}

export const FORM_STEPS = [
  { value: 1, label: '基础信息' },
  { value: 2, label: '搜索' },
  { value: 3, label: '章节/剧集' },
  { value: 4, label: '正文/播放' },
  { value: 5, label: '发现页' }
];

export const FORM_ITEMS: FormItem[] = [
  { prop: 'name', label: '名称', step: 1 },
  { prop: 'contentType', label: '类型', step: 1, type: 'select', options: CONTENT_TYPES },
  { prop: 'host', label: '域名', step: 1, placeholder: 'https://example.com' },
  { prop: 'group', label: '分组', step: 1 },
  { prop: 'author', label: '作者', step: 1 },
  { prop: 'sort', label: '排序(越大越靠前)', step: 1, type: 'number' },
  { prop: 'loadJs', label: '全局 JS 脚本', step: 1, type: 'textarea' },
  { prop: 'userAgent', label: 'User-Agent / Headers JSON', step: 1, type: 'textarea' },

  { prop: 'enableSearch', label: '启用搜索', step: 2, type: 'switch' },
  { prop: 'searchUrl', label: '搜索地址', step: 2, type: 'textarea', debug: true, placeholder: '/search?wd=$keyword&page=$page' },
  { prop: 'searchList', label: '搜索列表', step: 2, debug: true },
  { prop: 'searchName', label: '标题', step: 2, debug: true },
  { prop: 'searchCover', label: '封面', step: 2, debug: true },
  { prop: 'searchAuthor', label: '作者', step: 2, debug: true },
  { prop: 'searchChapter', label: '最新章节/备注', step: 2, debug: true },
  { prop: 'searchDescription', label: '描述', step: 2, debug: true },
  { prop: 'searchResult', label: '结果(详情地址)', step: 2, debug: true },

  { prop: 'chapterUrl', label: '章节地址', step: 3, type: 'textarea', debug: true, placeholder: '留空则使用搜索结果地址' },
  { prop: 'enableMultiRoads', label: '多线路', step: 3, type: 'switch' },
  { prop: 'chapterRoads', label: '线路列表', step: 3, type: 'textarea', debug: true },
  { prop: 'chapterRoadName', label: '线路名称', step: 3, debug: true },
  { prop: 'chapterList', label: '章节列表', step: 3, debug: true },
  { prop: 'chapterName', label: '章节标题', step: 3, debug: true },
  { prop: 'chapterCover', label: '章节封面', step: 3, debug: true },
  { prop: 'chapterTime', label: '章节时间', step: 3, debug: true },
  { prop: 'chapterResult', label: '章节结果', step: 3, debug: true },

  { prop: 'contentUrl', label: '正文地址', step: 4, debug: true, placeholder: '留空则使用章节结果地址；null 表示不请求' },
  { prop: 'contentNextUrl', label: '正文下一页', step: 4, debug: true },
  { prop: 'contentItems', label: '正文内容 / 播放地址', step: 4, debug: true },
  { prop: 'contentDecoder', label: '正文解密', step: 4, debug: true },

  { prop: 'enableDiscover', label: '启用发现', step: 5, type: 'switch' },
  { prop: 'discoverUrl', label: '发现地址', step: 5, type: 'textarea', placeholder: '分组::分类::地址，一行一个' },
  { prop: 'discoverNextUrl', label: '下一页地址', step: 5, debug: true },
  { prop: 'discoverList', label: '列表', step: 5, debug: true },
  { prop: 'discoverName', label: '标题', step: 5, debug: true },
  { prop: 'discoverCover', label: '封面', step: 5, debug: true },
  { prop: 'discoverAuthor', label: '作者', step: 5, debug: true },
  { prop: 'discoverChapter', label: '最新章节/备注', step: 5, debug: true },
  { prop: 'discoverDescription', label: '描述', step: 5, debug: true },
  { prop: 'discoverTags', label: '标签', step: 5, debug: true },
  { prop: 'discoverResult', label: '结果(详情地址)', step: 5, debug: true }
];
