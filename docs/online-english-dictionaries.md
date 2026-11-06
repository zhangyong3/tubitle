# Tubitle 在线英英词典调研

核查日期：2026-11-06。范围：英文字幕点词、在扩展中显示英英释义、将已查过的释义保存为 PDF 旁批。免费浏览、免费调用 API、可缓存、可在 PDF 中复制及分享，分别核对。

## 推荐方案

- **PDF 可导出的默认词源：Open English WordNet。** 项目提供 [JSON API](https://en-word.net/api/docs) 和[官方数据下载](https://en-word.net/downloads)。[授权文件](https://github.com/globalwordnet/english-wordnet/blob/main/LICENSE.md) 允许分享和改编，要求同时署名 Open English WordNet 团队和 Princeton WordNet，底层数据保留适用的 [WordNet 声明](https://github.com/globalwordnet/english-wordnet/blob/main/WNDB_License.txt)。先试公开 API；没有查到其公开请求额度或服务保证，不能假设无限。正式分发时，可以固定官方数据版本自行托管或提供本地词库。它提供按词义组织的简明释义，不能预期有朗文同等的学习者例句和搭配覆盖。
- **需要免注册的托管接口，以及更多口语、习语和用法时：FreeDictionaryAPI.com。** [官方接口](https://freedictionaryapi.com/) 支持跨域请求，无需 Key，每 IP 每小时 1,000 次；返回词性、分义释义及可用的例句和用法标签。内容来自 English Wiktionary，服务要求链接原条目、显示服务署名，并在下载页注明来源。PDF 旁批可以保存原条目 URL 与许可；分享时遵守 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)，改编的词典内容适用相同许可。[Wikimedia 重用条款](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use#7._Licensing_of_Content) 提醒查看条目中的特殊授权。首版只导出释义和词性，跳过独立版权的引文和音频。
- **朗文保留为外链。** 点击「在朗文查看」打开官网词条。PDF 可保留词名和词条链接；完整释义使用开放词源。只有拿到明确覆盖在扩展中展示、缓存和用户导出/分享的授权后，才将朗文内容纳入这些流程。

## LDOCE Online 能否直接用？

[培生产品页](https://www.pearson.com/languages/educators/connected-english-learning-program/longman-english-dictionaries.html) 将 LDOCE Online 介绍为免费的词典网站，提供学习者释义、例句和搭配。它可以作为外部查词入口。我未找到培生当前公开且可自助注册的 LDOCE API/SDK；旧 `api.pearson.com/v2/dictionaries` 地址未验证可用，不作接入依据。

嵌入整页、抓取网页后重排、缓存词条和把释义写入可分享 PDF 属于不同用法，免费浏览不提供这些用法的授权依据。未核实该站当前的 iframe 响应头或产品专属条款。[Pearson Languages 网站条款](https://www.pearson.com/languages/terms-of-use.html) 限制对其站点的自动抓取和再利用；[培生权限申请](https://www.pearson.com/asia/permissions.html) 提供书面授权入口。产品集成前需向培生确认具体授权范围，不以网页可访问或个人可查阅代替许可。

## 其他 API

| 服务 | 免费条件 | 对 Tubitle 的意义 |
| --- | --- | --- |
| [Merriam-Webster Learner’s Dictionary](https://dictionaryapi.com/products/api-learners-dictionary) | [注册 Key](https://dictionaryapi.com/register/index)；[非商业用途，每 Key 每天 1,000 次，最多两种参考词典](https://dictionaryapi.com/info/frequently-asked-questions)。 | 面向英语学习者，有例句、音标和常用搭配。可评估非商业应用里的在线查阅；[服务条款](https://dictionaryapi.com/info/terms-of-service) 没有给出可直接用于本项目的缓存和可分享 PDF 导出授权，应先书面确认。 |
| [Cambridge Dictionary](https://dictionary.cambridge.org/develop.html) | [试用条款](https://dev.eim-ciip-cambridge.org/api/terms-and-conditions) 写明 30 天 3,000 次，仅供评估；正式使用[单独询价和授权](https://dev.eim-ciip-cambridge.org/apply)。 | 有适合学习者的权威内容；官方免费网页工具和搜索组件用于查阅，不等同于 API 或 PDF 再分发许可。 |
| [Oxford Dictionaries API](https://developer.oxforddictionaries.com/documentation/getting_started/sandbox) | 沙盒共 500 次，词条首字母范围受限；正式方案另计。 | [官方条款](https://developer.oxforddictionaries.com/api-terms-and-conditions?tab=noncommercial) 说明缓存、存储或本地保存需另谈授权，不适合作为免费的 PDF 旁批来源。 |
| [dictionaryapi.dev](https://dictionaryapi.dev/) | 公共英英接口，无需注册；[项目文档](https://github.com/meetDeveloper/freeDictionaryAPI) 未列可依赖的明确额度。 | 能用来试验在线查词，与 FreeDictionaryAPI.com 是不同服务。后者文档明确了限额、内容来源和逐条署名字段，更方便做 PDF。 |

## 接入边界

Tubitle 已能保存查词释义并供 PDF 导出。若继续开发，在线查询用 REST 即可，不必引入 SDK。查词结果应把释义和来源一起存入历史（词条、词性、释义、来源名、原条目 URL、许可 URL）。点词时才请求，在扩展侧声明所需的最小站点权限；PDF 导出只读取已经保存且有适当授权的内容。[Chrome 扩展网络请求文档](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)

上线前从目标网络测试常用词、多义词、变形和短语，例如 `crap` 和 `vantage point`。这次核对了官方接口文档、授权及 [crap](https://en.wiktionary.org/wiki/crap)、[vantage point](https://en.wiktionary.org/wiki/vantage_point) 的 Wiktionary 原条目；本环境未完成公共接口的实时请求，不能据此推断用户网络上的可用性。未改应用代码。
