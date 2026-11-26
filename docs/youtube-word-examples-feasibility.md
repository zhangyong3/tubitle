# 在 Tubitle 学习库中提供单词视频例句的可行性

核验日期：2026-11-26。本文是产品和技术可行性分析，不包含功能实现；没有调用 YouGlish 服务，也没有读取用户凭据。

## 结论

可以自行实现“复习单词 → 选择另一条视频例句 → 跳到对应片段 → 重播／调速”的交互。播放控制已有官方 API；困难是获得并维护“单词 → 视频 → 字幕句子 → 起止时间”的可靠语料索引。仅使用 YouTube Data API 和 IFrame Player API，不能直接得到任意公开视频中的单词命中片段。

适合 Tubitle 的起点是查询用户本人已保存的学习语境，再逐步引入由权利人直接提供、允许检索和展示的字幕语料。不宜把任意公开视频字幕抓取当成稳定、已获授权的公共语料来源。

## 已核实的官方能力

| 能力 | 可行性与限制 | 依据 |
| --- | --- | --- |
| 关键词找相关视频 | `search.list` 返回视频等资源及摘要，不返回查询词的字幕命中句子和时间。`videoCaption=closedCaption` 只是“有字幕”过滤，`relevanceLanguage` 只是相关性偏好，也会返回其他语言。不能由“有字幕的相关视频”推导出“该词确实在第几秒出现”。 | [search.list](https://developers.google.com/youtube/v3/docs/search/list)、[Search resource](https://developers.google.com/youtube/v3/docs/search) |
| 读取任意视频的完整字幕 | 官方 `captions.list` 本身需要 OAuth，只返回字幕轨道信息，不含字幕正文；`captions.download` 明确要求调用者有编辑该视频的权限。一般用户对公开视频的观看权限不满足此条件。 | [captions.list](https://developers.google.com/youtube/v3/docs/captions/list)、[captions.download](https://developers.google.com/youtube/v3/docs/captions/download) |
| 定位与播放 | 官方 IFrame Player API 支持按视频 ID、起始时间加载、seek、暂停、获取当前时间、调整播放速度。某些播放操作可被浏览器自动播放规则阻止，因此以用户点击启动为基础。 | [IFrame Player API](https://developers.google.com/youtube/iframe_api_reference) |
| 从嵌入播放器取出字幕全文 | IFrame API 的公开 `captions` 模块仅列出 `fontSize`、`reload` 等显示选项，没有读取字幕正文或按词检索字幕的公开方法。此结论针对公开 API，不把播放器内部请求当作受支持接口。 | [IFrame 的字幕模块](https://developers.google.com/youtube/iframe_api_reference#Events) |
| 视频片段逐条切换 | 已知视频 ID 和时间后可以自行实现。起止点需来自已有的人工标注或授权字幕索引；播放器不会自动计算单词的出现时间。 | [IFrame 播放控制](https://developers.google.com/youtube/iframe_api_reference#Functions) |

YouGlish 文档展示的字幕、口音筛选、相邻片段、词典、调速等选项可作为交互参考，但其组件文档不公开其语料获得、授权及索引构建机制。不能据此推断 YouTube 有一个可直接替代 YouGlish 的公开“按发音片段检索”接口。[YouGlish Widget](https://youglish.com/api/doc/widget)、[YouGlish JS API](https://youglish.com/api/doc/js-api)

## 当前配额，避免沿用旧成本模型

2026-11-26 查询的官方文档已采用下列默认分桶方式：

- `search.list` 有独立 Search Queries 配额桶，默认每天 100 次，每次调用计 1。翻页也会额外调用。
- `videos.insert` 也有独立配额桶，默认每天 100 次。
- 其余接口合计默认每天 10,000 units。
- 默认每日配额按美国太平洋时间零点重置，不跟随 Tubitle 注册时区的业务额度。

依据：[官方 Quota Calculator](https://developers.google.com/youtube/data/determine_quota_cost)（页面显示更新日期 2026-11-12）、[search.list 配额说明](https://developers.google.com/youtube/v3/docs/search/list)。不要把旧教程的“每次搜索 100 units，从统一 10,000 units 中扣除”直接作为现行配置。正式接入仍应以实际 Google Cloud 项目的配额控制台为准；本文没有访问任何项目控制台。

由此推算，若每个用户每次复习均发起一次搜索，100 个用户各搜索一次即可用完默认搜索次数；这只是请求数估算，不是 100 条视频的上限，因为一次请求可返回多条视频。共享缓存可减少重复查询，但不能解决字幕命中时间缺失，也不应通过多个项目规避配额。

## 三条路线

### A. 复用用户自己的已保存语境，适合作为第一版

以用户本人学习记录中的词、上下文、`videoId`、开始时间为基础，提供“我在其他视频里见过它”的例句列表；仅在该用户自己的记录范围内查找。已有词条、句子上下文和视频时间可用于最小版本，不必先建立全站字幕库。

优点是来源、时间戳明确，播放路径简短；主要限制是新用户和低频词没有足够例句。只保存过一次该词时应明确显示只有原例句，不能以关键词视频搜索结果冒充已验证的用词片段。

这是工程建议，并不自动解决原始字幕来源的授权问题。用户同意同步自己的记录，不等于版权方同意把完整字幕上传成公共语料；第一版应保持私有，不跨用户共享历史、观看记录或字幕。当前字幕获取路径如依赖页面内部接口，还需要单独核查稳定性和平台政策。

### B. 自有／明确授权的语料索引，适合真正的“更多例句”

先与内容方约定允许搜索、必要存储、例句展示和商业使用等范围，最好由内容方直接提供字幕文件或原始音频。建立句级索引，存储视频标识、原语种、句子、时间、匹配词形及来源授权信息。用户选择单词后，检索本地索引，返回若干不同视频的命中片段，再用官方 YouTube 播放器播放。

可从少量高质量频道、单一语言、常见词和短语开始，优先确保完整句子、命中准确和声音清楚；逐步扩展词形变化、同义词、难度、口音等筛选。官方搜索可辅助发现候选内容，但语料是否包含目标词应由已授权字幕验证。

“版权方授权”与“YouTube API／平台政策允许”需要分别满足。OAuth 能下载某字幕，不意味着该 API 数据可无限期保存、公开聚合或再分发。自建索引的具体数据来源、保存内容及展示形式需要在上线前确定。

### C. 抓取任意公开视频字幕／下载音频后 ASR，不宜作为默认路线

这条路在工程上可能做出原型，但不属于仅调用受支持的官方 YouTube API。它涉及抓取限制、视听内容下载限制、内容权利和平台风控，接口或请求凭据也可能随时变化。不要把“公开视频可播放”“浏览器能看到字幕”或“用户授权扩展读取页面”视为获得公共字幕库构建与商业再分发权利。

## 需要纳入设计的政策边界

官方 Developer Policies 的关键约束包括：

- III.E.6：禁止 API Client 直接或间接抓取 YouTube 应用，或取得被抓取的 YouTube 数据／内容。
- III.E.1：没有 YouTube 事先书面批准，不可下载、导入、备份、缓存或保存 YouTube 视听内容；不能用 API 促进侵权。将 YouTube 音频下载下来再做 ASR，不因产物是文本而自动免除前置下载限制。
- III.E.4：API 数据存储、刷新／删除、用户授权与衍生数据还有额外约束；不能将缓存策略简单设为永久保存。
- III.E.5、III.A：需要保护用户数据、说明数据用途并尊重删除与撤回；跨用户共享学习语境与私有历史是新的用途，不是原同步功能的自然授权。
- 官方播放器要求至少 200 × 200 可视区域；要保留正常播放器体验，不以遮挡或裁切播放器作为片段播放器实现。

依据：[YouTube Developer Policies](https://developers.google.com/youtube/terms/developer-policies)、[IFrame Player API requirements](https://developers.google.com/youtube/iframe_api_reference#Requirements)。以上为对官方文件的产品设计解读，不代表平台已批准拟议的语料获取或索引方案。

## 建议的产品边界

首个入口可命名为“更多语境”，默认提供本人其他已保存例句；没有结果时明确说明暂无更多语境。若提供官方关键词搜索，标为“相关视频”，不保证其中出现目标词，也不自动定位到一个未经验证的时间点。

有了明确授权的字幕库之后，再升级为“更多视频例句”：每次给出 3–5 个已验证片段，保留整句和少量前后文，支持重播和下一个例句。播放始终走官方嵌入播放器；不要保存或重新分发视频文件。

项目代码中，`web/src/blocks/learning-player.tsx` 已使用官方 IFrame 单播放器，`web/src/lib/learning.ts` 的记录包含 `videoId`、`startSeconds`、`endSeconds` 和 `context`。因此第一版属于现有复习流程扩展；YouGlish 级别的全站用词视频检索则是独立的语料建设与维护项目。决定是否投入后，第一步应确认语料来源和授权范围，再估算覆盖率与规模成本。

更多例句宜作为临时复习内容展示，只有用户明确收藏才创建学习库记录，以免自动播放或浏览例句消耗 Free 每日 5 条／总计 100 条记录的额度。

官方政策 III.F.3 还规定不得对观看嵌入的 YouTube 内容收费；通常的登录流程可以存在，但不要把 Pro 权益设计成付费才能观看这些嵌入视频。收费价值应定位于独立的学习整理、分析或练习服务，并核对其具体实现是否满足平台政策。[Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
