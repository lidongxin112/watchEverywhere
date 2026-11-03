# watchEverywhere

基于规则的多源聚合 **视频 / 小说 / 漫画 / 音频** 工具，参考 [any-reader](https://github.com/aooiuu/any-reader) 的架构与页面实现。

> 本项目不内置任何内容源，所有内容均由你自行添加的规则从第三方站点获取。

## 功能

| 页面 | 说明 |
| --- | --- |
| 首页 | 收藏 / 浏览历史 |
| 搜索 | 按内容类型并发搜索所有启用搜索的规则（8 并发，可取消），按规则分组展示 |
| 发现（视频 / 小说 / 漫画 / 音频） | 左侧规则列表（可置顶、过滤），顶部多级分类，滚动加载更多；可直接编辑 / 关闭规则 |
| 详情 | 封面、简介、收藏、继续观看/阅读；**多线路**切换；已读/上次位置标记；正序倒序 |
| 播放器 | hls.js 播放 m3u8 / mp4，选集侧栏，**自动下一集**、**记忆播放进度**、倍速；非直链自动切换网页模式 |
| **直播** | 订阅 M3U / TXT 直播列表（**内置 [iPTV](https://github.com/akiralereal/iptv)，开箱即用**），分组、台标、**EPG 节目单**（正在播放 / 下一个 / 当天列表）、多线路、频道收藏、↑↓ 换台；支持 HLS / FLV / TS，**服务端转发**解决跨域与防盗链，直连失败自动改转发、再自动换线路 |
| 阅读器 | 小说 / 漫画，上一章 / 下一章 / 目录，阅读进度记忆，预加载下一章，快捷键 |
| 规则管理 | 导入（文本 / URL 订阅 / 文件 / 拖拽）、**从苹果 CMS 资源站一键生成**、测速、批量启停、导出 |
| 规则编辑 | 分步表单 / JSON 编辑，**搜索测试、URL 测试、取文本测试**三种调试工具，语法速查 |
| 设置 | 4 套主题、阅读排版、播放偏好、清除缓存 |

## 项目结构

```
watchEverywhere/
├── packages/
│   ├── core/      规则解析引擎（对应 any-reader 的 @any-reader/core + rule-utils）
│   │   ├── src/rule.ts            规则类型、eso:// 编解码、导入、苹果CMS转规则
│   │   ├── src/request.ts         请求参数解析、编码识别(gbk 等)
│   │   ├── src/analyzers.ts       CSS / JSONPath / XPath / JS / 正则 / 替换 解析器
│   │   ├── src/AnalyzerManager.ts 规则串联、&& || ## {{}} 处理
│   │   ├── src/RuleManager.ts     搜索 / 发现 / 章节(多线路) / 正文
│   │   └── test/                  使用本地模拟站点的完整流程测试
│   ├── server/    Koa 接口服务（对应 @any-reader/server + shared）
│   │   ├── src/api.ts             所有接口，路径与 any-reader 保持一致
│   │   ├── src/live.ts            直播：直播源、节目单、播放转发
│   │   ├── src/iptv.ts            内置 iPTV 进程管理
│   │   ├── src/live-parser.ts     M3U / TXT / XMLTV 解析、m3u8 改写
│   │   └── src/store.ts           JSON 文件存储，数据在 ~/.watch-everywhere
│   └── web/       Vue 3 + Ant Design Vue 页面（对应 @any-reader/web 的 PC 端）
├── scripts/setup-iptv.mjs  安装 / 更新内置 iPTV
├── vendor/iptv/   内置 iPTV（安装时自动下载，不提交到仓库）
└── package.json   npm workspaces
```

## 开始使用

需要 Node.js 18+（推荐 20 / 22）。

```bash
cd watchEverywhere
npm install

# 开发：同时启动接口(8898) 和页面(5173)
npm run dev
# 打开 http://localhost:5173

# 运行核心引擎测试
npm test

# 生产：构建页面后由服务端统一托管
npm run build
npm start
# 打开 http://localhost:8898
```

可选环境变量：`PORT`（默认 8898）、`WE_DATA_DIR`（数据目录，默认 `~/.watch-everywhere`）、`WE_DEBUG=1`（打印接口耗时）。

## 直播（内置 iPTV）

watchEverywhere 内置了 [iPTV](https://github.com/akiralereal/iptv)（直播源聚合服务，GPL-3.0），**不需要再单独部署**：

- `npm install` 时会自动把 iPTV 下载到 `vendor/iptv` 并安装依赖（需要 git 并能访问 GitHub；检测到系统 Chrome 时直接使用，不再额外下载 Chromium）
- `npm run dev` / `npm start` 时自动启动 iPTV（默认端口 1905），并自动添加「内置 iPTV」直播源；iPTV 意外退出会自动重启，watchEverywhere 退出时一起关闭
- 首次启动需要抓取频道，约 1~2 分钟，直播页会显示启动状态并在就绪后自动加载
- 频道模块的开关、分组、排序在 iPTV 后台管理：直播页右上角「频道管理」，或 `http://localhost:1905/admin`
- iPTV 数据保存在 `~/.watch-everywhere/iptv`
- 如果 1905 端口上已经有 iPTV 在运行（比如之前用 Docker 部署的），会直接复用而不重复启动

| 命令 / 环境变量 | 说明 |
| --- | --- |
| `npm run iptv:update` | 安装或更新内置 iPTV |
| `WE_IPTV=0` | 不使用内置 iPTV（安装和启动都跳过） |
| `WE_IPTV_PORT=1905` | iPTV 端口 |
| `WE_IPTV_REPO=...` | 下载 iPTV 用的仓库地址（GitHub 访问慢时可换镜像） |

除内置源外，也可以在「直播 → 管理直播源」添加任意 M3U / TXT 订阅（例如 NAS 上的 iPTV：`http://NAS的IP:1905/interface.m3u`）。浏览器无法播放 rtmp / rtp / udp 地址，可复制到 VLC 观看。请只观看你有权收看的频道内容。

## 添加内容源

### 示例规则（公版内容，可直接导入）

`rules/public-domain.json` 内置 3 条指向合法公开内容的规则，在「规则」页 → 添加规则 → **从文件导入**选择它即可：

| 规则 | 类型 | 内容 |
| --- | --- | --- |
| Internet Archive 公版电影 | 视频 | archive.org 的经典长片、默片、黑色电影、动画、老电视剧、Prelinger 档案等 |
| LibriVox 公版有声书 | 音频 | 志愿者朗读的公版书有声版、老电台节目 |
| Project Gutenberg 公版书 | 小说 | 古腾堡计划的公版电子书（以英文为主，也有少量中文），按章节阅读 |

> 说明：Internet Archive 的部分条目没有可在线播放的文件，会显示「没有获取到章节」，换一个即可。

### 聚合规则包（`rules/aggregate.json`）

12 条规则（9 条站点源 + 3 条苹果 CMS 资源站），一次导入：「规则」页 → 添加规则 → **从文件导入** → 选 `rules/aggregate.json`。

| 规则 | 类型 | 搜索 | 发现 | 剧集/目录 | 正文 |
| --- | --- | --- | --- | --- | --- |
| AGE动漫 `www.agedm.io` | 视频 | ✓ | ✓ 目录 / 一周更新 / 排行榜 | ✓ 8 条线路 | 播放页解析器（自动网页模式） |
| 樱花动漫 `www.yinghuabb.com` | 视频 | ✓ | ✓ 5 个分类 | ✓ 多线路 | 直链 m3u8 |
| 腾讯视频 `v.qq.com` | 视频 | ✓ | ✓ 5 个频道词 | 单片 | 直链 mp4，取不到时开官网页 |
| 爱奇艺 `www.iqiyi.com` | 视频 | ✓ | ✓ 6 个频道（各 24 条） | 单片 | 官方页观看 |
| 哔哩哔哩番剧 | 视频 | ✓ | ✓ 5 个榜单（99 条） | ✓ 按季度 | 直链 mp4（匿名 720P，会员集填 Cookie） |
| 哔哩哔哩 | 视频 | ✓ | ✓ 5 个榜单（100 条） | ✓ 分 P | 直链 mp4 |
| 包子漫画 `cn.bzmgcn.com` | 漫画 | ✓ 支持翻页 | ✓ 10 个分类（36 条/页，可翻页） | ✓ 全目录 | 本机 Chrome 抓图，直接阅读 |
| 哔哩哔哩漫画 `manga.bilibili.com` | 漫画 | ✓ | — | 整部 | 原站详情页内嵌阅读 |
| 腾讯动漫 `ac.qq.com` | 漫画 | — * | ✓ 3 个榜 | 最新话 | 原站章节页内嵌阅读 |
| 资源站 · cj.lziapi.com | 视频 | ✓ | ✓ 40 个分类 | ✓ 多线路 22 集 | 直链 m3u8（自动从播放页提取） |
| 资源站 · ffzy5.tv | 视频 | ✓ | ✓ 31 个分类 | ✓ 多线路 | 直链 m3u8 |
| 资源站 · api.guangsuapi.com | 视频 | ✓ | ✓ 44 个分类 | ✓ 多线路 | 直链 m3u8 |

\* 腾讯动漫站内搜索是纯前端渲染、没有可用接口，只能从发现页进。

生成与自测：

```bash
node scripts/build-rules.mjs                          # 改脚本里的选择器后重新生成 aggregate.json
npx tsx scripts/check-rules.ts 鬼灭                    # 全链路：发现 → 搜索 → 章节 → 播放地址
npx tsx scripts/debug-rule.ts 樱花动漫 search 鬼灭      # 单步调试，打印实际请求和响应
npx tsx scripts/build-cms-rules.ts                     # 重新生成 3 条资源站规则（接口失效时换新的）
```

> 需要登录才有的内容（B 站会员集、漫画正文等）把账号 Cookie 填到规则的 `cookies` 字段即可。

### 其他方式

进入「规则」页 → 添加规则：

- **从资源站添加**：填写苹果 CMS v10 接口地址（形如 `https://域名/api.php/provide/vod`），自动生成带分类、搜索、多线路剧集的视频规则。
- **从文本 / URL 导入**：粘贴 any-reader / ESO 格式的规则 JSON、`eso://` 压缩规则，或订阅地址。
- **从文件导入 / 拖拽**：规则 JSON 文件。

## 规则语法速查

| 写法 | 含义 |
| --- | --- |
| `.list li@text` | CSS 选择器（默认），`@` 后取值：`text` / `html` / `innerHtml` / `outerHtml` / 属性名 |
| `$.data[*].name` | JSONPath（以 `$` 开头或 `@json:`） |
| `//a/@href` | XPath（以 `/` 开头或 `@xpath:`） |
| `@js:result.split(',')` | JavaScript，`result` 为上一步结果；可用 `http(url)`、`CryptoJS`、`cheerio`、`xpath` |
| `@regex:(\d+)` | 正则，取第一个捕获组 |
| `规则##正则##替换` | 正则替换 |
| `A&&B` / `A\|\|B` | 合并结果 / 取第一个有值的 |
| `/a?id={{$.id}}` | 模板拼接 |
| `-规则` | 列表倒序 |
| `$keyword` `$page` `$host` `$result` | 地址变量 |


## 桌面版（单文件可执行程序）

```bash
node scripts/build-desktop.mjs              # 当前平台
node scripts/build-desktop.mjs all          # mac-arm64 + mac-x64 + win-x64
```

产物在 `dist/`：`watchEverywhere-mac-arm64`（117 MB，自带 Node，双击即用）、`watchEverywhere-win-x64.exe`。

做法：Vite 构建前端 → esbuild 把服务端打成一个 CJS → 前端产物转 base64 内联 → `node --experimental-sea-config` 生成 blob → `postject` 注入 Node 二进制 → macOS 重新 ad-hoc 签名。运行时前端从内存托管（`globalThis.__WE_ASSETS__`），不依赖外部文件。

启动行为：自动监听 `8898` 并打开默认浏览器；`WE_NO_OPEN=1` 可关掉；`WE_DATA_DIR` 指数据目录；Ctrl+C 会顺带收掉 puppeteer 起的 Chrome。

## 更新与推送

桌面版和 `npm start` 用的是同一套逻辑，配置两个地址即可：

```bash
WE_UPDATE_URL=https://你的域名/watchEverywhere/latest.json
WE_NOTICE_URL=https://你的域名/watchEverywhere/notices.json
```

`latest.json`：

```json
{
  "version": "0.2.0",
  "publishedAt": "2026-11-03",
  "notes": "新增漫画 19 分类；修复播放器",
  "platforms": {
    "mac-arm64": { "url": "https://…/watchEverywhere-mac-arm64", "size": 117000000 },
    "win-x64":   { "url": "https://…/watchEverywhere-win-x64.exe", "size": 118000000 }
  }
}
```

`notices.json`（公告推送，任意条）：

```json
[{ "id": "n1", "title": "服务公告", "content": "今晚 23:00 资源站可能波动", "level": "warning" }]
```

客户端行为：

- 启动时请求一次 → 顶部出现「新版本 v0.2.0 已发布…」/「公告 …」提示条，可关闭（会话内不再弹）
- 「设置 → 版本」里有当前版本、「检查更新」按钮、下载链接和公告列表
- 接口：`POST /api/app/info`、`POST /api/app/update-check {force}`、`POST /api/app/notices`
- 版本号取 `WE_VERSION`，默认根 `package.json` 的 version；发版时改版本号重新打包、上传新包、更新 `latest.json` 即可，老客户端下次启动就会提示

暂不做「静默自动替换二进制」（涉及签名/权限，容易被系统拦），现在是「提示 + 一键下载」；如果要真·自动更新，可以在下载完成后把新文件写到 `~/.watch-everywhere/updates/`，下次启动由启动器替换，我可以再补。

## 与 any-reader 的差异

- 数据存储由 sqlite + typeorm 改为 JSON 文件，无需编译原生模块。
- 请求层加了 **Cookie 罐**（服务端 `Set-Cookie` 自动保存并按域名回传，规则里只写账号 Cookie）、
  **补充根证书**（`packages/core/src/ca.ts`，修 Node 缺 AAA / SSL.com 根导致的 `unable to get local issuer certificate`）、
  **网络错误自动重试一次**、默认超时 20s（慢站可给地址包 `{"url":…,"timeout":45000}`）。
- 漫画源允许把「原站章节页」当正文返回，阅读器自动改成内嵌网页显示。
- 新增 **浏览器兜底抓取**（`packages/server/src/browser.ts`）：包子漫画的阅读页必须跑 JS 才能过 gatekeeper，
  纯 HTTP 解完 PoW 仍 403；这里用 `puppeteer-core` 驱动**本机已装的 Chrome**（不下载 Chromium）拿渲染后的 HTML，
  再抽出图片地址。只对 `bzmgcn.com / cnbzmg.com / baozimh` 这类站点生效，命中后按 24h 缓存。
- 新增 **媒体转发**（`packages/server/src/media.ts`，`/api/media/proxy`）：跨站播放地址自动带 Referer 转发、
  m3u8 分片一起改写，解决 B 站 / 腾讯 CDN 的防盗链与跨域；播放页拿到的始终是同源地址。
- JS 沙箱改为**每个规则一个实例**，并发搜索时变量互不干扰（原项目为全局静态）。
- 多线路视频源会返回全部线路（原项目仅取第一条线路）。
- 正文按纯文本渲染，避免来源站点注入脚本。
- 暂未实现：Electron 桌面端、VSCode 插件、本地 txt/epub 书籍、TTS 朗读、`@filter`(puppeteer) / `@web` 解析器、登录密码。
