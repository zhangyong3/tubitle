# 简约翻译免 Key 引擎调研

调研日期：2026-11-24。依据 fishjar/kiss-translator 官方仓库 `dev` 分支的公开源码；未读取用户当前安装扩展的代码或版本号，不能保证与已安装版本完全一致。`dev` 分支会继续更新，以下链接反映调研时可见实现。

## 结论

“免 Key”描述的是用户不必填写自己的付费 API 凭据，不能直接推出上游服务承诺无限请求。代码中的请求池、重试、批处理与缓存，说明该项目同样需要控制请求频率；请求池注释明确提及避免高频请求导致服务封禁。[请求池源码](https://github.com/fishjar/kiss-translator/blob/dev/src/libs/pool.js)

## 各引擎为什么无需用户填写 Key

下表由并行源码核对汇总；只记录请求形态，不证明这些消费端点允许第三方无限量使用，也没有对上游实施压力测试。

| 引擎 | 公开代码中的实现 | 免 Key 的实际含义 |
|---|---|---|
| Microsoft | 请求 `edge.microsoft.com/translate/translatetext` | 使用 Edge 翻译入口，区别于用户订阅的 Azure API |
| AzureAI | 订阅 Key 和 Region 认证 | 仍需用户的官方服务凭据 |
| Google | `gtx` 翻译请求 | 使用网页/客户端可用入口，不填写 Google Cloud Key |
| Google2 | `translateHtml` 请求，默认配置包含预设 Key | 用户不填写，不等于请求根本无 Key；本文不复制预设 Key |
| GoogleCloud | 用户配置 Key | 官方云 API 凭据路径 |
| Volcengine | `translate.volcengine.com/crx/translate/v1`，提交语言与文本 | 消费端/扩展端入口，不是用户开通的机器翻译签名 API |
| Tencent | `transmart.qq.com/api/imt`，使用固定客户端标识及 Referer | 不填写付费 Secret，但仍有客户端请求参数 |
| BuiltinAI | Chrome `Translator.availability()` / `Translator.create()` | 在浏览器本地执行，不依赖云 API Key |

各项来源：[Microsoft/Azure 请求构造](https://github.com/fishjar/kiss-translator/blob/dev/src/builtin-plugins/microsoft.js)、[Google 请求构造](https://github.com/fishjar/kiss-translator/blob/dev/src/builtin-plugins/google.js)、[内置预设配置](https://github.com/fishjar/kiss-translator/blob/dev/src/builtin-plugins/presets.js)、[Volcengine 请求构造](https://github.com/fishjar/kiss-translator/blob/dev/src/builtin-plugins/volcengine.js)、[Tencent 请求构造](https://github.com/fishjar/kiss-translator/blob/dev/src/builtin-plugins/tencent.js)、[Chrome 本地翻译封装](https://github.com/fishjar/kiss-translator/blob/dev/src/libs/builtinAI.js)。

仓库还保留兼容实现文件：[旧 DeepL 实现](https://github.com/fishjar/kiss-translator/blob/dev/src/apis/deepl.js) 使用 `www2.deepl.com/jsonrpc` 的客户端协议，[旧 Baidu 实现](https://github.com/fishjar/kiss-translator/blob/dev/src/apis/baidu.js) 使用 `fanyi.baidu.com/transapi`。这些文件不单独证明当前版本的实际调度路径，故不将其作为当前安装版本的确定行为。

## 并发、批处理和缓存

- 请求池限制最大并发和每个任务的启动间隔，失败默认最多重试两次，重试间隔默认一秒；取消不重试，耗尽重试后仍向调用者抛错。[pool.js](https://github.com/fishjar/kiss-translator/blob/dev/src/libs/pool.js)
- 全局默认值为并发 10、启动间隔 100 毫秒；聚合请求的默认等待时间 400 毫秒、每批最多 20 段与 10000 字符。这些是扩展自身的调度设置，不是供应商承诺的配额。[apiConstants.js](https://github.com/fishjar/kiss-translator/blob/dev/src/config/apiConstants.js)
- 批处理按段落数量、累计长度和批次并发来拆分任务；取消单个调用不会误取消同批其他调用。[batchQueue.js](https://github.com/fishjar/kiss-translator/blob/dev/src/libs/batchQueue.js)
- 普通文本翻译默认启用缓存和请求池。缓存按服务、原文、源/目标语言和相关配置等区分，命中时直接返回；成功结果写入本地缓存，因此重复看到同一段译文不意味着再次调用上游。[apis/index.js](https://github.com/fishjar/kiss-translator/blob/dev/src/apis/index.js)
- HTTP 缓存使用浏览器 CacheStorage。扩展前台通过消息交给后台读写。缓存只降低真实请求量，不能赋予上游无限额度。[cache.js](https://github.com/fishjar/kiss-translator/blob/dev/src/libs/cache.js)

## “代理”要区分两种含义

公开请求适配代码中的一类“代理”只是 content script 把网络请求交给扩展 background 执行；油猴版使用 `GM.xmlHttpRequest`，普通环境使用 `fetch`。因此看到 background 转发并不能认定请求经过作者付费服务器，也不能据此认定有共享 API Key。是否使用远端中转，要看具体服务最终配置的 URL 和凭据策略。[request.js](https://github.com/fishjar/kiss-translator/blob/dev/src/libs/request.js)

## 对 Tubitle 的含义

可借鉴独立引擎适配、当前字幕优先、适量预取、队列限速、请求取消及本地缓存。在接入任何免 Key 远端入口前，应逐个确认实际端点和公开使用政策；不要把“扩展不计费”或“没有展示字数计数器”写成“供应商保证永久无限量”。以上是基于调度与请求代码的工程判断，不是对任一供应商服务条款的法律结论。
