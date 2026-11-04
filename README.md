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
| 播放器 | hls.js 播放 m3u8 / mp4，选集侧栏，**自动下一集**、**记忆播放进度**、倍速；**智能去广告**；**外部播放器**（PotPlayer / VLC / IINA / MPV / Infuse / nPlayer / MX Player）；字幕支持 srt / vtt / **ASS·SSA 特效**；非直链自动切换网页模式 |
| **AI 问片** | 接任意 OpenAI 兼容接口（DeepSeek / 通义千问 / Kimi / 智谱 / OpenAI / 本地 Ollama），聊天找片、查剧情演员，AI 会直接在你的资源里搜索并给出可点开的结果；详情页 **AI 影评** |
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

一键发版（GitHub Actions，打 tag 即发）：

```bash
git tag v0.2.0 && git push origin v0.2.0
```

`.github/workflows/release.yml` 会跑测试 → 打 mac-arm64 / mac-x64 / win-x64 → 生成 `latest.json`（带 size + sha256）→ 传 Release。
本地也可以手动生成清单：

```bash
node scripts/make-manifest.mjs 0.2.0 "本次更新说明"
WE_RELEASE_BASE=https://github.com/你/repo/releases/download/v0.2.0 node scripts/make-manifest.mjs 0.2.0
```

暂不做「静默自动替换二进制」（涉及签名/权限，容易被系统拦），现在是「提示 + 一键下载」；如果要真·自动更新，可以在下载完成后把新文件写到 `~/.watch-everywhere/updates/`，下次启动由启动器替换，我可以再补。


## 播放弹幕 / 规则订阅 / 合并搜索

- **弹幕**：哔哩哔哩番剧、投稿自动带弹幕（`/api/danmaku/list`，B 站 XML），播放器右侧可开关，开关状态本地记忆；滚动弹幕 + 顶部/底部固定弹幕都支持
- **规则订阅**：规则页 → 添加规则 → 「管理规则订阅」，填订阅地址（规则 JSON / eso:// / 返回它们的 URL），可设置每小时自动检查；更新时保留你本地的 `cookies` 与排序
- **合并搜索**：搜索结果右上角开关「合并同名」，同一部作品来自多个源时合并成一行，点下面的标签切换来源
- **移动端**：≤640px 侧边栏变底部导航（带 iPhone 安全区），播放器 ≤900px 上下布局，卡片两列

## 自动更新（下载 → 校验 → 替换）

设置 → 版本 → 「下载安装包」：服务端把新版本下到 `~/.watch-everywhere/updates/<version>/`，
按清单里的 `sha256` 校验（不匹配直接标记失败并拒绝安装），然后出现「立即重启并更新」。

点了之后会写一个 `apply.sh` / `apply.cmd`：等当前进程退出 → 备份旧文件（`*.bak-<旧版本>`）→ 覆盖 → 重新启动。
日志在 `~/.watch-everywhere/updates/`。

CI 里签名/公证是「有 secrets 才跑」：

| secret | 作用 |
| --- | --- |
| `MAC_CERT_P12` / `MAC_CERT_PASSWORD` / `MAC_SIGN_IDENTITY` | Developer ID 签名（`--options runtime --timestamp`） |
| `APPLE_ID` / `APPLE_APP_PASSWORD` / `APPLE_TEAM_ID` | `notarytool submit --wait` 公证 + `stapler` |

不配置也能发版，只是产物是 ad-hoc 签名（别人首次打开要右键「打开」）。


## 规则市场 / 收藏分组

- **规则市场**：规则页 → 添加规则 → 规则市场。索引随程序发布（`rules/market.json`，13 条内置规则，带简介和标签），点「添加」即导入，已装过的标「已安装」并可覆盖更新；也支持 `WE_MARKET_URL` 指向远程索引（格式相同）
- **收藏分组**：收藏页顶部标签切换分组，`+ 分组` 新建；「多选」后可批量「加入分组 / 仅保留所选分组 / 取消收藏」


## 追更 / 片头片尾学习

- **追更 / 追番**：作品目录页点「追更」，服务端定时重新拉目录（间隔可设：15 分钟～每天）
  - 自动识别集数：`第12集`、`第十二话`、`EP12`、`S01E12`、`[12]`、`番名 - 12 [1080p]`、`更新至12集`；识别不出时按条目数
  - 多线路时自动识别字幕组（LoliHouse、喵萌奶茶屋、桜都字幕组…），默认追集数最新的线路，也可以在卡片「⋯」菜单里指定只追某条线路
  - 新集角标 `+N` 会一直保留到点「标记已读」，鼠标移上去能看到新增了哪几集
  - 有更新时提醒：浏览器通知（页面开着时）+ 推送渠道 Bark / 企业微信 / 飞书 / 钉钉 / 通用 Webhook，在首页「追更 → 提醒设置」里配置，可逐部关闭提醒
  - 数据存 `~/.watch-everywhere/watch.json`，推送配置单独存 `notify.json`

- **片头片尾学习**：不做音频分析，只学你的行为——在开头 10% 内手动跳转记一次片头样本、在结尾 25% 内点「下一集」记一次片尾样本；样本满 3 个取中位数，弹一次「记住这 90 秒片头吗？」，确认后按规则单独生效（`we-skip-config:<ruleId>`）


## 智能去广告 / 外部播放器 / ASS 字幕

- **智能去广告**（默认开启，设置 → 播放）：资源站常把广告用 `#EXT-X-DISCONTINUITY` 插在正片清单里。播放前按分片的路径特征、时长和关键字识别并删掉这些片段，播放时左上角会提示跳过了几段。直连和转发播放都生效；漏网的广告可以在设置里补充分片地址的正则
- **外部播放器**：播放页 / 直播页「外部播放」，唤起 PotPlayer、VLC、IINA、MPV、Infuse、nPlayer、MX Player，或复制播放地址。用其他设备上的播放器打开时，需要 watchEverywhere 能被那台设备访问（地址不能是 localhost）
- **ASS / SSA 特效字幕**：字幕菜单加载本地 `.ass` / `.ssa`，用 [ASS.js](https://github.com/weizhenye/ASS) 渲染位置、颜色、淡入淡出等特效；渲染失败时自动降级为纯文本。支持延迟调整、按集记忆。按 `F` 全屏时字幕和弹幕会一起全屏

## AI 问片

1. 侧边栏「AI」→ 右上角「设置」，选服务商（DeepSeek / 通义千问 / Kimi / 智谱 / 硅基流动 / OpenAI / 本地 Ollama）或自定义，填接口地址、API Key、模型，点「测试连接」
2. 直接聊：「推荐几部类似《漫长的季节》的悬疑剧」「帮我找《三体》能看的资源」。AI 会调用 `search_media` 在**你已添加的规则**里搜索，结果以卡片显示，点开就能看
3. 作品详情页「AI 影评」：生成一段不剧透的短评（同一作品缓存 7 天，可以「换一篇」）

API Key 只保存在服务端的 `~/.watch-everywhere/ai.json`，任何接口都只返回打码后的预览。不支持工具调用的模型会自动退化为普通聊天（不能帮你搜资源）。

## 线路清晰度记忆

- 每次播放会拉一次 m3u8 主清单，解析 `RESOLUTION` / `BANDWIDTH`，连同拉流耗时一起记到 `we-roadstat:<ruleId>`
- 线路标签直接显示清晰度（`1080P` / `720P` / `2K`），悬停看「成功/失败次数、分辨率、码率、拉流耗时」
- 排序规则：**可疑线路（失败多且刚失败）排最后 → 清晰度高的在前 → 拉流快的在前**
- 打开某集时，如果当前线路被判坏，自动切到最优线路；播放中彻底失败也会自动换


## Docker 部署

```bash
# 直接构建运行
docker build -t watch-everywhere .
docker run -d --name watch-everywhere -p 8898:8898 -v $PWD/data:/data watch-everywhere

# 或者 compose
docker compose up -d --build
```

- 数据（规则 / 收藏 / 历史 / 更新包）都在 `./data`
- 健康检查打 `/api/app/info`，容器里不会自动开浏览器（`WE_NO_OPEN=1`）
- 前端已构建进镜像（`packages/server/public`），镜像内只有一份运行依赖

## 借鉴 MoonTVPlus 的部分

| 能力 | 本项目的做法 |
| --- | --- |
| 外部播放器跳转 | 播放器「外部播放器」菜单：PotPlayer / VLC / IINA / MPV / Infuse / nPlayer / MX Player，地址走本机转发（Referer 由我们补） |
| 外挂字幕 | 本地 `.srt` / `.vtt` + ASS/SSA 特效字幕（assjs 渲染）；B 站 CC 字幕（需登录态） |
| 智能去广告 | `utils/adfilter.ts`：按 HLS 片段时长/`#EXT-X-DISCONTINUITY` 识别贴片广告并跳过，播放器提示跳过时长 |
| 消息通知 | 追更更新可推送（`notify.ts`：Webhook / ServerChan / Bark / Telegram 等渠道），设置里可一键测试 |
| AI 问片 | `ai.ts`：接任意 OpenAI 兼容接口，对话里带 `search_media` 工具，直接在你自己的规则里搜片并给卡片；也能生成影评 |
| 豆瓣短评 | 详情页自动拉豆瓣热门短评（`meta/douban-comments`，6 小时缓存） |
| PWA | `manifest.webmanifest` + `sw.js`：可安装到桌面/主屏，静态资源离线可用，接口和媒体不走缓存 |
| 追番订阅 | 只做「本地规则里的集数变化」，不接磁力站 / 网盘离线下载 |
| 磁力搜索 / 网盘离线 / 观影室 / WebTV / 超分 | 未做 |


## 磁力搜索 / 视频超分

### 磁力搜索（Mikan / Nyaa / ACG.RIP）

- 侧边栏「磁力」页：按番剧名搜索，结果按做种数排序，显示来源 / 大小 / 发布时间
- **只做搜索与磁力生成**：不接离线下载、不转存网盘
- Mikan 的 RSS 只给 `.torrent`，服务端内置极简 bencode 解析，取 `info` 字典算 sha1 得到 infohash 再拼磁力（`magnet/resolve` 按需生成，避免搜索时等十几秒）
- 多镜像：`mikanime.tv` / `mikanani.kas.pub` / `mikanani.me` 并行取第一个可用的；每个源单独限时，被墙的站点不会拖住整个搜索
- 结果缓存 15 分钟，空结果不缓存（避免一次超时锁死）

### 视频超分（WebGL2）

播放器工具栏「超分」：

| 选项 | 说明 |
| --- | --- |
| 关闭 | 恢复原始 video |
| 柔和 / 标准 / 强 | 锐化强度 0.5 / 1.2 / 2.0 |
| 1.5x / 2x / 3x | 放大倍率（按容器尺寸 + devicePixelRatio 渲染） |

实现要点（`utils/superres.ts`）：

- `texImage2D(video)` 每帧上传画面 → 片元着色器做「3×3 高斯模糊 + 反锐化掩膜」
- 用 Sobel 式梯度判断边缘：边缘处强锐化、平坦区按 `denoise` 混合邻域均值，压掉噪点和色带
- 末段轻微提对比度，避免放大后发灰
- 用 `requestVideoFrameCallback` 跟帧（不支持时退回 rAF），`preserveDrawingBuffer` 便于截图/像素校验
- 浏览器不支持 WebGL2 时按钮给出提示而不是白屏


### 多源同片聚合播放

- 播放器工具栏「换源」：按片名在其他规则里找同一部作品（`aggregate/same`），列表显示每个源命中的标题
- 点「切过去」会自动拉对方目录，用**集数**匹配（`第03集` / `EP03` / `[03]` / `S01E03` 都认），停在相同的集；找不到就落到第一集
- 播放失败的错误页也有「换个源播放」，不用退回搜索页
- 标题归一化会去掉季/年份/清晰度/语言后缀再比对，避免「葬送的芙莉莲第二季」和「葬送的芙莉莲 S2」对不上



### 磁力搜索的等待策略

Mikan 对不同关键词的速度差很多（「芙莉莲」3 秒、「鬼灭之刃」实测 19 秒），所以：

1. 主源先等 **10 秒**（`WE_MAGNET_TIMEOUT` 可调），有结果立刻返回
2. 超时就先返回空结果 + `pending: true`，同时**后台继续搜**，结果进缓存
3. 前端显示「主站还在后台搜索…」，9 秒后自动再拉一次，通常十几秒内就出结果
4. 状态栏会显示每个源的情况：`Mikan: 100 条 / 2851ms`、`Nyaa: 无结果或不可达`

简化字关键词在 Mikan 上偏慢，用日文原名（如 `鬼滅の刃`）大多 3 秒内返回。



### 磁力源与代理

| 源 | 域名 | 说明 |
| --- | --- | --- |
| Mikan | mikanime.tv / mikanani.kas.pub / mikanani.me | RSS 搜索（约 100 条/次），种子按需解析 infohash |
| Nyaa | nyaa.si / nyaa.iss.ink / nyaa.moe | 表格解析，带做种/下载数，按做种排序 |
| Sukebei | sukebei.nyaa.si / sukebei.nyaa.iss.ink | 同 Nyaa 解析器 |
| 动漫花园 | share.dmhy.org / dmhy.org | 磁力是 base32 的 btih，服务端转成 hex 做去重 |
| ACG.RIP | acg.rip | JSON 接口（该站对部分 UA 返回 406） |

代理配置（给被墙的源用）：

```bash
WE_PROXY=http://127.0.0.1:7890 npm run dev:server
```

或「设置 → 网络 → 出口代理」保存（写到 `~/.watch-everywhere/proxy.json`）；两者都没有时自动探测本机常见端口（7890/1087/1080/8118…）。
`POST /api/magnet/sources` 会返回每个源的**直连 / 走代理**可达性和耗时，磁力页的源列表会标注「不可达」。

> 如果用的是 ClashX：未命中规则的流量由「⚓️其他流量」这一组决定，默认常常是 DIRECT ——
> 需要把这一组切到节点选择，或给 `nyaa.si`、`sukebei.nyaa.si`、`dmhy.org`、`acg.rip` 各加一条指向代理节点的规则。



## 启动 / 停止

```bash
npm run dev      # 服务 8898 + 前端 5173
npm run stop     # 一键停掉服务、前端 dev、内置 iPTV(1905)，以及测试实例端口
node scripts/stop.mjs --hard   # 卡死时强制 SIGKILL
```

`npm run stop` 只杀**本项目** node_modules 下的进程和 8898 / 5173-5190 / 8990-8999 / 1905 这几个端口上的监听者，
不会碰你机器上其他 node 程序。之前反复 `npm run dev` 留下的多份 vite / tsx 也能一次清干净。



### 磁力在线播放（边下边播）

磁力结果行点「在线看」→ 服务端打开种子、列出文件 → 选一个直接播，不用先下载完。

- `torrent/open`：torrent-stream 打开磁力/种子，返回文件列表（标注能否直接播）
- `GET /api/torrent/stream?hash=&index=`：按需拉取分片，支持 `Range`；播放器里能看 `peers / 进度 / 速度`
- **mkv/avi 等浏览器不认的容器**：服务端用 ffmpeg 无损转封装成 fMP4（`-c copy`，不重编码），再流给 `<video>`
- 会话按 infoHash 缓存，闲置 10 分钟自动关闭；同时最多 3 个会话
- 需要能连到 peer（DHT + UDP tracker）。**HTTP 代理帮不上 P2P**，要走 TUN/全局模式；一个 peer 都连不上时会明确报「连接磁力超时（没有找到 peer）」



### 磁力支持的分类与源

磁力页顶部有「类型」选择，不同分类会落到不同站点：

| 类型 | 主要来源 |
| --- | --- |
| 全部 | Torrents-CSV + Mikan + Nyaa + 动漫花园 |
| 动漫 | Mikan、动漫花园（`sort_id=1`）、Nyaa（`c=1_0`）、Torrents-CSV |
| 电影 | Torrents-CSV、TPB（`cat=201/207`） |
| 电视剧 | Torrents-CSV、TPB（`cat=205/208`）、Nyaa 真人（`c=4_0`） |
| 综艺 | 动漫花园（`sort_id=4`）、TPB（剧集分类） |
| 音乐 | Torrents-CSV、TPB（`cat=101/104`）、Nyaa（`c=2_0`） |
| 电子书 | Torrents-CSV、TPB（`cat=601/102/103`）、Nyaa（`c=3_0`） |
| 漫画 | Torrents-CSV、TPB（`cat=602`）、动漫花园（`sort_id=2`） |

工程上的几点：

- **Torrents-CSV** 是公开索引快照（`/service/search?q=&size=`），响应 <1s，作为通用兜底
- **TPB（apibay）** 分类最全但很慢（实测 10~40s），所以只放后台补；首屏不等它
- **源健康度**：某个源失败后 5 分钟内直接跳过，不再白等超时——所以第一次搜索可能 8~12s，之后基本 200~700ms
- 每个源单独限时，代理只在「代理能给的东西」上用（4 秒不通立刻退回直连）



### 种子健康度

磁力列表新增「健康」列（不额外请求，直接用来来源给的做种数分档）：

| 分档 | 条件 |
| --- | --- |
| 优（绿） | ≥ 50 做种 |
| 良（蓝） | 10 ~ 49 |
| 差（橙） | 1 ~ 9 |
| 无种子（红） | 0 |
| 未知（灰） | 来源没给 seeders |

每行还有「**测活**」按钮：`torrent/health` 会向种子里的 tracker（外加 5 个公共 tracker）发 **scrape** 请求，拿真实的做种/下载/完成数：

- HTTP(S) tracker：`GET <tracker>/scrape?info_hash=<raw bytes>` → bencode 解析
- UDP tracker：`dgram` 实现 connect(0) → scrape(2) 两段协议，解析 `seeders/incomplete/completed`
- 结果缓存 10 分钟；**所有 tracker 不可达时明确显示「未知（tracker 不可达）」**，不会误报成死种

> P2P 与 tracker 在部分网络下会被整体拦截（本项目开发机上就是如此：UDP/TCP 全超时）。
> 这时健康列仍然可用（基于来源统计），测活则会如实告诉你"不可达"。


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
