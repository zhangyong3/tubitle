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
- 通过 OpenAI Chat Completions 兼容接口流式解析句子
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
