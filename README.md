# Tubitle

Tubitle 是一个完全在浏览器扩展中运行的 YouTube 英语学习工具，不需要账号、自建服务端或 Vercel。

## 功能

- 英文、中文双行字幕，自动优先选择英文人工字幕
- Microsoft、Google Cloud、腾讯云机器翻译
- 当前句优先、受控并发、逐句显示与本地持久缓存
- 上一句、下一句、重复当前句与自定义快捷键
- 离线 MDX/MDD 词典、发音、查词历史
- 通过 OpenAI Chat Completions 兼容接口流式解析句子

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

生成可分发的 ZIP 安装包：

```bash
npm run package
```

命令会先执行生产构建，再生成 `extension/tubitle-v<版本号>.zip`。ZIP 根目录直接包含 `manifest.json`，可用于发布或上传 Chrome 扩展商店。

固定申请的服务域名包括腾讯云、Microsoft 和 Google 翻译。自定义 Microsoft Endpoint 与大模型 Base URL 会在保存时由浏览器请求对应的可选主机权限。

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
