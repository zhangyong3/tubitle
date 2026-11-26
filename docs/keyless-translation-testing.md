# 免 Key 字幕翻译与独立 AI 解析设置

验证日期：2026-11-24。协议调研来源见 [简约翻译调研](kiss-translator-keyless-research.md)。实现为独立的请求构造与响应解析，没有复制共享 API Key，也没有加入模拟官方客户端的 UA / Referer 重写。

## 功能

- `serviceMode` 控制字幕服务；`analysisServiceMode` 独立控制语句解析。旧版合并模式迁移时继承原有选择，之后互不联动。
- 字幕新增 Edge、Google、Volcengine、Tencent Transmart、Baidu、DeepL 与 Chrome Translator 入口，保留 Microsoft / Google 官方 Key 配置。
- Google 2 使用共享预置 Key，不作为真正免 Key 引擎引入。
- 远端免 Key 请求复用扩展后台的翻译缓存、去重与取消机制，并额外串行、间隔至少 300ms 调度；单次请求超时 15 秒，不自动跨服务发送原文。
- 新远端域名沿用 manifest 已有的可选权限，在设置中点击测试或授权按钮时只请求相应域名，不增加安装时的全站权限。
- Chrome 本地翻译通过页面 bridge 在 MAIN 页面环境调用 Translator API，API Key 不经过页面 bridge。按语种复用 Translator，首次下载要求用户操作，处理不可用语言对、超时和取消。
- 自备大模型直接调用用户填写的 OpenAI 兼容 API，不经过 Tubitle 配额接口；费用和服务商限额依然适用。

## 真实网络测试

执行 `node --import ./web/node_modules/tsx/dist/loader.mjs scripts/probe-keyless.mts`。

只发送固定公开测试句：`Learning a language opens a new world.`；不发送用户字幕或任何 API Key。

| 引擎 | 结果 |
|---|---|
| Microsoft Edge | HTTP 200，返回“学习一门语言打开了一个新世界。” |
| Google | HTTP 200，返回“学习一门语言打开了一个新世界。” |
| Volcengine | 初始无尾斜杠地址返回 307；改为 `/crx/translate/v1/` 后 HTTP 200，返回有效中文 |
| Tencent Transmart | HTTP 200，返回“学习一门语言会打开一个新的世界。” |
| Baidu | HTTP 200，但业务响应 errno 1022、访问异常；作为失败处理，设置标为实验入口 |
| DeepL | HTTP 200，但返回客户端协议过旧的通知；明确识别为失败，不缓存为字幕；设置标为实验入口 |

腾讯免 Key 接口不声明支持繁体中文，因此请求该组合时明确拒绝，避免用简体冒充繁体。

上述为本机 Node 网络测试，不等同于所有用户网络或扩展权限环境都可用。浏览器设置页使用真实构建产物的隔离 HTTP 预览，预览存储与已安装扩展无关。预览脚本 `scripts/preview-extension-options.mjs` 不应打入扩展发布包。

## 浏览器验证

在 Chrome 的隔离 HTTP 设置预览中，Chrome Translator 测试按钮返回连接成功；实际 `page-bridge.js` 与请求端事件链路将固定英文样例翻译为“學習語言開啟了一個新世界。”，验证本机 API 与繁体目标语种。

## 自动化覆盖

`npm test` 覆盖新引擎协议构造/解析、简繁体代码、上游错误和 429、取消、不缓存 DeepL 停服通知、Chrome API 探测/下载用户手势/实例复用、旧设置迁移，以及字幕与 AI 解析模式独立选择。

类型检查：`npm run typecheck`；构建：`npm run build`。发布前仍应在重新加载后的扩展内验证权限授予和 YouTube 字幕播放。此任务的浏览器自动化不读取或操作 `chrome-extension://` 页面。

## 2026-11-26 设置简化与复测

使用修改前的 `keylessRequest` / `keylessResult`，仅发送上述固定英文样例：

- Baidu：HTTP 200，但返回 `errno: 1022`、`访问出现异常，请刷新后重试！`，没有有效译文。
- DeepL：HTTP 200，但译文字段为客户端版本过旧的多语言通知，解析器明确拒绝。

因此移除两者的服务商选项、请求和解析实现，旧设置中的这两个引擎回退到 Chrome Translator。新安装默认使用 Chrome Translator，已有明确服务选择继续保留。字幕翻译只展示服务商选择，Tubitle 合并为带额度限制说明的选项；测试结果置于各自测试按钮下方。移除底部自动保存与域名授权说明及按钮，测试按钮仍按所选服务请求所需域名权限。
