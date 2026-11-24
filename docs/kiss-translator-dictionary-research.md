# 简约翻译查词接口调研

调研日期：2026-11-24。以官方 `fishjar/kiss-translator` 仓库公开 `dev` 源码为依据，其中词典处理器、汉典与释义本地化文件核对到 commit `8696ab9e9b2f6f4d90960e7c1d3c1bf0aa989a20`。未读取用户已安装扩展的代码或版本号，也未实测以下远端词典的当前响应，因此不能保证安装版本及网络可用性完全一致。

## 查词入口实际上分为三类

### 普通英语词典：Bing / Youdao

`src/config/apiConstants.js` 的普通词典枚举仅有 Bing、Youdao；百度出现在输入联想列表，不能据此称为完整百度词典。[枚举源码](https://github.com/fishjar/kiss-translator/blob/dev/src/config/apiConstants.js#L29-L40)

`src/views/Selection/DictHandler.js` 的 Bing 处理器在第 49–51 行连接 `apiMicrosoftDict`，Youdao 在第 234–236 行连接 `apiYoudaoDict`。[固定提交处理器](https://github.com/fishjar/kiss-translator/blob/8696ab9e9b2f6f4d90960e7c1d3c1bf0aa989a20/src/views/Selection/DictHandler.js#L49-L51)

| 词典 | 接口与方式 | 数据 / 凭据情况 |
|---|---|---|
| Bing 必应词典 | `GET https://www.bing.com/dict/search?q=...&FORM=BDVSP6&cc=cn`；读取 HTML 并用 DOMParser 提取 | 音标、发音地址、词性、释义、词形、双解和例句。请求带 `credentials: include`，没有要求用户填写订阅 Key；这不同于 Azure Translator API |
| Youdao 有道词典 | `POST https://dict.youdao.com/jsonapi_s?doctype=json&jsonversion=4`；表单包含 `q`、`le=en`、`t=3`、`client=web`、`keyfrom=webdict` | 返回词典 JSON，渲染英美音标、词性释义和双语例句；不是有道智云付费 API 的 appKey 签名流程 |

两条函数均可在 [`src/apis/index.js`](https://github.com/fishjar/kiss-translator/blob/dev/src/apis/index.js) 中核对。响应成功后存在缓存；“免用户 Key”不代表服务商公开承诺无限额度或稳定支持第三方。

### 单字汉典：网页提取

普通词典界面按“英文单词”和“单个汉字”分流。`DictionaryPanels.js` 第 55–58 行确认英文查 Bing/Youdao，单个汉字启用 Zdic；第 141 行渲染 `<Zdic text={text} />`。[固定提交调用入口](https://github.com/fishjar/kiss-translator/blob/8696ab9e9b2f6f4d90960e7c1d3c1bf0aa989a20/src/components/TranslationPanel/DictionaryPanels.js#L55-L58)

`src/apis/zdic.js` 的 `apiZdic` 请求 `https://www.zdic.net/hans/{编码后的单字}`，`credentials: omit`、`useCache: false`，再用 DOMParser 从网页提取部首、繁体/异体、五笔、拼音、发音地址、释义与英/德/法翻译字段。没有发送 API Key，也不是单独的汉典付费 JSON API。[固定提交汉典源码](https://github.com/fishjar/kiss-translator/blob/8696ab9e9b2f6f4d90960e7c1d3c1bf0aa989a20/src/apis/zdic.js)

### AI 词典：用户配置的模型

`apiDict` 并不是上述普通词典查询的同义名称。它走具有 dictionary 能力的服务和提示词，通过 AI 生成结构化词义结果，可使用上下文；是否需要 Key、是否收费取决于用户配置的模型服务，本地 AI 与云端 AI 不能混为一谈。[apiDict 调用链](https://github.com/fishjar/kiss-translator/blob/dev/src/apis/index.js)、[官方插件能力说明](https://github.com/fishjar/kiss-translator-plugins)

## 发音也有独立来源

Bing 词典渲染处理器播放查询结果返回的音频 URL。有道处理器第 312、319 行使用 `BaiduAudioBtn`；`src/views/Selection/AudioBtn.js` 第 73–78 行构造 `https://fanyi.baidu.com/gettts?lan=uk|en&text=...&spd=3`。因此“有道词典卡片”的释义来源和发音请求来源不一定相同。[词典处理器](https://github.com/fishjar/kiss-translator/blob/8696ab9e9b2f6f4d90960e7c1d3c1bf0aa989a20/src/views/Selection/DictHandler.js#L312-L319)、[发音按钮](https://github.com/fishjar/kiss-translator/blob/8696ab9e9b2f6f4d90960e7c1d3c1bf0aa989a20/src/views/Selection/AudioBtn.js#L73-L78)

## 词典释义还可能二次调用翻译服务

`src/views/Selection/loadDictionary.js` 第 42 行先执行所选 `dict.apiFn(text)`；当目标语言不是原始简体中文且配置了翻译服务，会抽取中文释义字段，第 71–78 行调用 `apiTranslate`，以简体中文为源语翻译至目标语言，再填回词典卡片。二次翻译失败会保留原始词典数据。[固定提交 loadDictionary](https://github.com/fishjar/kiss-translator/blob/8696ab9e9b2f6f4d90960e7c1d3c1bf0aa989a20/src/views/Selection/loadDictionary.js#L35-L78)

所以，“普通词典查询不填 Key”与“任何目标语言的词典释义都不需要翻译服务”是两回事。

## 联想建议不等于完整查词

- 百度输入建议：`POST https://fanyi.baidu.com/sug`，JSON `{kw: text}`。
- 有道输入建议：`GET https://dict.youdao.com/suggest`，参数包括 `num=5`、`ver=3.0`、`doctype=json`、`le=en`、`q`。

它们用于输入联想，不能替代普通词典的完整释义 / 词形 / 例句通道。[discovery.js](https://github.com/fishjar/kiss-translator/blob/dev/src/builtin-plugins/discovery.js#L58-L111)

## Collins / 内置离线词典的证据边界

README 中提及 Collins / 内置英文词典，但本次核对的当前普通词典枚举、`DictHandler.js` 和 `DictionaryPanels.js` 路由是 Bing、Youdao、Zdic 与 AI；没有确认独立 Collins 官方 API、独立 Collins 词库下载源或本地词典文件加载器。不能把 README 的产品描述直接解释为“使用 Collins 免费 API”，也不能据此断言已经内置可离线查词的数据。安装版、旧分支或其他项目可能有差异，需要进一步确认版本。[README](https://github.com/fishjar/kiss-translator/blob/dev/README.en.md)、[普通词典枚举](https://github.com/fishjar/kiss-translator/blob/dev/src/config/apiConstants.js#L29-L40)
