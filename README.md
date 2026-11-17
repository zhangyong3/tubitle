# Tubitle

Tubitle 是一个在浏览器扩展中运行的 YouTube 英语学习工具，不需要账号或 Vercel；翻译可选择云服务或本机运行的混元模型。

## 功能

- 英文、中文双行字幕，自动优先选择英文人工字幕
- 使用 YouTube 播放器的字幕按钮控制双语字幕和学习面板；关闭字幕会停止字幕翻译。
- 视频正常播放时，学习面板在其他标签页停留 10 秒后会自动返回「字幕」。可在设置的「字幕交互」调整秒数，填 0 可关闭。
- Microsoft、Google Cloud、腾讯云机器翻译、Tubitle 自研翻译服务
- 当前句优先、受控并发、逐句显示与本地持久缓存
- 按标点和停顿整理字幕，支持上一句、下一句、重复当前句与自定义快捷键
- 点词显示 Open English WordNet 英英释义，可手动打开朗文原站。配置 MDX/MDD 后，同一页还会显示离线释义与发音。
- 通过网站账户的 OpenAI Chat Completions 兼容服务解析句子
- 在字幕面板点击「下载 PDF」，导出完整原文、高亮查过的词，并附已经保存的 WordNet 词义和版权声明。旁批优先使用已完成的 AI 解析（含其译文）；没有解析时，直接显示已有译文，包括尚未播放的句子。也可以点击某一行的「译」手动保存译文。下载时不发起网络查询。

## 隐私与密钥

翻译和大模型密钥只保存到 `chrome.storage.local`，不会写入网页、同步到 Chrome 云端或发送给 Tubitle 服务。扩展后台只会把字幕原文和对应凭证发送给用户选择的 API 服务商。

浏览器本地存储不是系统钥匙串。能访问本机浏览器配置或扩展调试环境的软件仍可能读取这些密钥，请使用权限受限、可随时轮换的 API 凭证。

## 本地开发

要求 Node.js 20.9 或更高版本。

```bash
npm install
npm run build
```

打开 `chrome://extensions`，启用开发者模式，选择“加载已解压的扩展程序”，加载 `extension/dist`。随后打开扩展设置，填写所需服务商密钥并点击测试连接。

体验 Tubitle 自研翻译服务：按 [本地服务说明](translation-service/README.md) 准备模型，然后从项目根目录执行 `bash translation-service/service.sh start q4`。在扩展弹窗选择「使用 Tubitle 自研翻译服务」，打开有英文字幕的 YouTube 视频，开启播放器 CC 和扩展的「显示翻译」。字幕由本机模型生成，无需 API 密钥。可用 `restart 2bit` 或 `restart opus` 切换模型，用 `stop` 停止服务。

生成可分发的 ZIP 安装包：

```bash
npm run package
```

命令会先执行生产构建，再生成 `extension/tubitle-v<版本号>.zip`。ZIP 根目录直接包含 `manifest.json`，可用于发布或上传 Chrome 扩展商店。

固定申请的服务地址包括腾讯云、Microsoft、Google 翻译和 Tubitle 自研翻译服务的 `http://127.0.0.1:18081`。自定义 Microsoft Endpoint 与大模型 Base URL 会在保存时由浏览器请求对应的可选主机权限。

## 项目结构

```text
extension/src/background.ts       本地任务调度与消息处理
extension/src/local-providers.ts  翻译、腾讯云签名与大模型请求
extension/src/background-cache.ts IndexedDB 翻译缓存
extension/src/content/            YouTube 字幕与学习面板宿主
extension/src/shared/             设置、词典、历史与共享类型
scripts/build-extension.mjs       扩展构建脚本
```

## 验证

```bash
npm run typecheck
npm test
npm run build
```

## 默认快捷键

| 操作 | 快捷键 |
| --- | --- |
| 上一句 | `Alt+ArrowLeft` |
| 下一句 | `Alt+ArrowRight` |
| 重复当前句 | `Alt+R` |
| 显示/隐藏中文 | `Alt+T` |
| 解析当前句 | `Alt+A` |

## 网页学习库同步

在同一个 Chrome 浏览器中登录 Tubitle，之后在 YouTube 视频中的查词与完整句子分析自动上传，保留视频语境和位置。未登录时仅保存在本地，匿名旧历史不补传。网页学习库不提供手动新增词句。

同步直接使用网站登录会话，没有连接码、手动连接或补传功能。退出登录或会话过期停止上传；切换账户时清除旧账户待上传队列。本地历史不受影响。上传失败保留已登录账户的队列，每分钟重试（最多 1000 条）。日字幕额度的服务端执行仍待接入。

本地网站：`cd web && pnpm dev`，打开 `http://127.0.0.1:3100/zh`。发行构建由开发者设置网站域名，例如 `TUBITLE_SITE_URL=https://your-domain.example npm run package`；构建会将网站地址和对应访问权限写入扩展，用户无需配置。扩展和登录网站须使用同一 Chrome 配置文件。完整接口和隐私边界见 `web/docs/learning-api.md`。

### 插件历史记录

历史按本地日期分组，日期下按「查词／句子分析／句子翻译」展开。设置中的「最多保存天数」取代旧的每类条数限制，默认 30 天，范围 1–365 天（含今天）；旧条数设置不会直接解释成天数。过期历史在启动、设置变更及每小时自动清理，历史页面每分钟更新日期边界。不影响已上传的网页记录与待上传队列。

重复查词或同类型句子查询只保留最新记录及视频来源。点击历史条目查看查词或分析内容，右侧跳转图标打开视频，删除图标仅删除本地历史。视频跳转：同一视频直接跳到保存的位置并播放；其他视频在当前 YouTube 页面打开对应时间。独立打开学习面板时会新开原视频。新查词记录保留视频、时间和语境；缺少来源的旧记录显示「无视频位置」，仍可单独查看释义或分析。

### 服务方式

设置默认使用 Tubitle 服务，字幕翻译和 AI 语句分析一起使用平台接口，无需填写密钥。平台 AI 免费版每天 3 次、Pro 每天 100 次，北京时间零点重置，失败退回次数；AI 解析需要登录。网站管理员配置 OpenAI 兼容地址、API Key 和模型。Pro 购买仍未开放。

选择「使用自己的 API Key」后才显示 Microsoft / Google 翻译配置，以及 OpenAI 兼容大模型的接口地址、密钥和模型。自备 API 请求从插件直接发送到服务商，不要求 Tubitle 登录，不消耗 Tubitle 额度；费用由用户的 API 账户承担。个人密钥只存在本机，切回平台模式仍保留配置但不再使用。两种模式在登录后都会自动上传学习记录。

开发者发行时设置 `TUBITLE_TRANSLATION_URL=https://translation.example` 与 `TUBITLE_SITE_URL=https://your-domain.example`，构建会写入默认服务地址及对应访问权限。终端用户无需配置 Tubitle 服务地址或访问密钥。本地默认翻译地址为 `http://127.0.0.1:18081`。
