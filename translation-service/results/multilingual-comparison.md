# 多语言模型性能与译文对比

本机实测：小牛 LMT-60 是此次新增方案中更适合先体验的选择。SMaLL-100 吞吐更高，但在这批英译中字幕中出现明显直译、语义错误和漏译，不能仅根据速度替换混元。以下是小样本功能与性能测试，不是标准翻译质量排名，也不是 VPS 容量承诺。

## 测试条件

- Apple M1 Pro，10 个逻辑 CPU，32 GiB 内存，macOS arm64；全部使用 CPU，未启用 Metal/GPU。具体时间和系统信息保留在原始 JSON。
- 同一套 16 条输入：8 条英文短字幕、4 条英文段落、英译日/西/阿及中译英各 1 条。源文本见 `benchmarks/samples.json`。
- 每组先预热，再逐条检查 16 条译文；短字幕在并发 1/2/4 各执行 32 次，段落各执行 16 次。五组依次运行，暂停默认服务避免争抢 CPU；结束后恢复原来的 2-bit 服务。
- 每组 144 次计时请求，合计 720 次，均 HTTP 200、finishReason=stop；另有 80 次质量检查和 5 次预热。HTTP 成功及正常 EOS 不代表译文完整，SMaLL-100 就存在提前结束、漏译末句的问题。
- llama.cpp 模型使用 8 线程、4 个推理槽、总上下文 8192；Q4 与小牛使用 b12140，2-bit 使用此前兼容该量化格式的固定提交 92c448af6 和 CPU_KLEIDIAI 构建。此处比较实际服务配置，包含不同内核、分词器及解码策略的影响。
- SMaLL-100 使用 CTranslate2 4.8.5，4 个 worker，每个 2 线程，INT8（本机实际计算类型 int8_float32）。默认 beam=5，另测 beam=1。混元保留原有采样参数；小牛使用 temperature=0 的贪心解码，**不等于官方 Transformers 示例的 beam=5**。
- llama.cpp 请求关闭提示缓存；原始数据确认命中 token 为 0。跨模型 token 含义不同，因此主要比较每秒完成请求数与端到端延迟。
- 每档只有 16 或 32 次请求，P95 容易受调度、后台负载影响。尚未做长时间压测、实际 YouTube 全片评测或 x86 VPS 测试。

## 短字幕结果

每格依次为 **请求/秒 / P95 毫秒**。单次请求是一条字幕，不是一段视频，也不是一个用户。

| 配置 | 并发 1 | 并发 2 | 并发 4 |
|---|---:|---:|---:|
| Hy-MT2 Q4_K_M | 2.65 / 516 | 3.24 / 851 | 2.63 / 3170 |
| Hy-MT2 官方 2-bit | 1.52 / 866 | 1.81 / 1491 | 2.42 / 2163 |
| 小牛 LMT-60 Q4_K_M | 5.81 / 248 | 7.24 / 394 | 8.51 / 684 |
| SMaLL-100 INT8 beam=5 | 4.51 / 308 | 7.62 / 361 | 9.79 / 562 |
| SMaLL-100 INT8 beam=1 | 5.55 / 247 | 9.32 / 297 | 12.60 / 426 |

并发 4 时，相对 Q4，小牛吞吐约 3.24 倍，SMaLL-100 beam=5 约 3.72 倍，beam=1 约 4.79 倍。相对 2-bit，分别约 3.52、4.05、5.21 倍。Q4 这轮并发 4 比并发 2 更慢，说明提高并发不能保证吞吐线性增长。

## 段落结果

| 配置 | 并发 1 请求/秒 | 并发 2 请求/秒 | 并发 4 请求/秒 | 并发 4 P95 毫秒 |
|---|---:|---:|---:|---:|
| Hy-MT2 Q4_K_M | 0.81 | 0.90 | 1.16 | 4310 |
| Hy-MT2 官方 2-bit | 0.39 | 0.54 | 0.73 | 6463 |
| 小牛 LMT-60 Q4_K_M | 1.67 | 1.95 | 2.65 | 1923 |
| SMaLL-100 INT8 beam=5 | 1.18 | 1.99 | 2.56 | 1720 |
| SMaLL-100 INT8 beam=1 | 1.46 | 2.49 | 3.10 | 1403 |

## 质量观察

以下直接摘录本轮真实响应，未润色。这里只能观察有限样例，不计算主观总分，也没有运行 COMET/BLEU 基准。日语、西语及阿语均检查了接口响应，但尚无母语人工审校，不能承诺这些方向的质量。

### 习语：piece of cake

原文：I thought the update would be a piece of cake, but it took all afternoon.

| 配置 | 实测译文 |
|---|---|
| Hy-MT2 Q4_K_M | 我以为更新工作会很容易，但实际上花了整个下午。 |
| Hy-MT2 官方 2-bit | 我以为这次更新会非常轻松，但结果却花了整个下午的时间。 |
| 小牛 LMT-60 Q4_K_M | 我以为更新会很简单，但花了整个下午的时间。 |
| SMaLL-100 INT8 beam=5 | 我以为更新将是一块蛋糕,但它需要整个下午。 |
| SMaLL-100 INT8 beam=1 | 我以为更新将是一块蛋糕,但它花了整天下午。 |

### 口语：coffee kicked in

原文：My coffee kicked in right after I decided to take a nap.

| 配置 | 实测译文 |
|---|---|
| Hy-MT2 Q4_K_M | 我决定小睡一会儿后，咖啡立刻开始起作用了。 |
| Hy-MT2 官方 2-bit | 我决定小睡后，咖啡立刻就上来了。 |
| 小牛 LMT-60 Q4_K_M | 我决定睡个觉后，咖啡就冲到了我嘴里。 |
| SMaLL-100 INT8 beam=5 | 我的咖啡在我决定喝一杯后立即点了一口。 |
| SMaLL-100 INT8 beam=1 | 我喝咖啡在我决定喝一杯后立即点击。 |

### 数字概念：percentage points 与 percent

原文：The price rose by 3 percentage points, not by 3 percent.

| 配置 | 实测译文 |
|---|---|
| Hy-MT2 Q4_K_M | 价格上升了3个百分点，而不是3%。 |
| Hy-MT2 官方 2-bit | 价格上升了3个百分点，而不是3%。 |
| 小牛 LMT-60 Q4_K_M | 价格上涨了 3 个百分点，而不是上涨了 3%。 |
| SMaLL-100 INT8 beam=5 | 价格上涨了3%,而不是3%。 |
| SMaLL-100 INT8 beam=1 | 价格上涨了3%,而不是3%。 |

小牛能正确处理 piece of cake 与百分点，但把 coffee kicked in 译成“咖啡就冲到了我嘴里”，把 Metal 译成“金属”，存在明显错误。混元 Q4 在这些例子中更稳，不过同样并非全部准确，例如 science 样例丢失了星光“下降”的方向信息。

SMaLL-100 两档都将 piece of cake 直译为“一块蛋糕”，并把 3 percentage points 与 3 percent 都译成 3%。paragraph-b 两档都省掉最后一句：先发布支付变更、将登录修复延至周一；此时 finishReason 仍然为 stop。这对字幕理解影响很大，暂不建议作为默认英译中引擎。beam=5 也不保证每条都优于 beam=1。

### 转换正确性检查

SMaLL-100 必须使用官方目标语言编码器前缀，不能套用普通 M2M100 的源语言前缀和强制目标 BOS。另修复官方 tokenizer 的 get_vocab 导出时保留词条别名覆盖 `<unk>` ID 的兼容问题，转换后逐项验证全部真实 token 的权重行，完整词表长度 128112。已添加回归测试。

使用官方 Transformers FP32 模型与当前 CTranslate2 INT8 beam=5 比较 3 条新样例（英译中、英译日、中译英），结果逐字一致；因此上述坏译文不能简单归因于 INT8。这个检查仅覆盖三条，不能推出所有输入与浮点模型一致。检查原始记录位于 `.runtime/small100/parity.json`，运行环境与大文件均被 Git 忽略。

## 安装、切换与插件

在 `translation-service` 目录：

```sh
bash service.sh setup niutrans
bash service.sh setup small100
bash service.sh restart niutrans
bash service.sh restart small100
SMALL100_BEAM=1 bash service.sh restart small100
bash service.sh status
bash service.sh stop
```

默认使用 `http://127.0.0.1:18081`；`GET /health`、`POST /v1/translate` 与原服务一致，插件继续选择「使用 Tubitle 自研翻译服务」，目标选简体中文即可体验。切换模型后刷新视频页，避免继续显示当前页旧字幕。模型 ID 包含 SMaLL-100 的 beam 值，缓存相互隔离。

小牛公布的范围是 60 种语言、以中英为中心的 234 个翻译方向，不承诺任意两种语言间效果。SMaLL-100 声明支持 100 种语言。两者不单独提供 `zh-Hant` 目标。不支持的目标返回 400，插件发来的 expectedModel 不匹配返回 409。输入沿用统一 1200 字符上限，SMaLL-100 另检查 1024 输入 token，最长输出 256 token。

模型文件大小：Q4 1,133,080,448 字节，2-bit 600,534,880 字节，小牛 Q4 484,219,584 字节，SMaLL-100 INT8 model.bin 338,727,246 字节。**这些不是进程内存占用**；还需要分词器、运行库、上下文及并发工作区，首次转换也需要保留上游完整权重与临时文件。

本机两个新增模型已安装。Linux VPS：SMaLL-100 需要 uv/Python 3.11；小牛还需安装 `llama-server` 与 `llama-quantize`（macOS arm64 脚本会准备固定版本）。不要将当前 ARM 性能直接用于购买 x86 VPS；建议用目标机器复跑，并为延迟余量预留容量。

## 复现与来源

验证已通过：3 项 Node 模型适配测试、3 项 Python 词表与前缀回归测试；SMaLL-100 四路并发交错执行中/日/英/西目标共 12 次，返回目标与模型 ID 均正确；不支持目标、空输入、超过字符上限返回 400，模型 ID 不匹配返回 409。小牛省略 source 也可完成翻译。两种新增模型重复 setup 无需重新下载或转换。插件现有测试 109 项及 TypeScript 检查通过；本次未做浏览器中的整段 YouTube 人工观看测试。

```sh
# 先停止默认实例，避免同时争抢 CPU
bash service.sh stop
LLAMA_GPU_LAYERS=0 LLAMA_THREADS=8 bash service.sh start niutrans
PORT=18081 BENCH_ROUNDS=4 BENCH_BACKEND=cpu BENCH_MODEL=niutrans node benchmarks/bench.mjs results/multilingual-niutrans-cpu.json
bash service.sh restart small100
PORT=18081 BENCH_ROUNDS=4 BENCH_BACKEND=cpu BENCH_MODEL=small100 node benchmarks/bench.mjs results/multilingual-small100-cpu.json
SMALL100_BEAM=1 bash service.sh restart small100
PORT=18081 BENCH_ROUNDS=4 BENCH_BACKEND=cpu BENCH_MODEL=small100-beam1 node benchmarks/bench.mjs results/multilingual-small100-beam1-cpu.json
```

原始 JSON：`results/multilingual-{q4,2bit,niutrans,small100,small100-beam1}-cpu.json`，本机保存，遵循现有规则不提交 Git。权重位于 `models/` 或 `.runtime/`，同样不提交。

- [NiuTrans 官方 LMT-60-0.6B 模型卡](https://huggingface.co/NiuTrans/LMT-60-0.6B)，安装固定 revision `dd189845cdc73346cef33c7a94f4b8bd8efdd4eb`。
- [SMaLL-100 官方模型与示例](https://huggingface.co/alirezamsh/small100)，安装固定 revision `8ab680e26a596d2e3d2d2d17ae0f68df1037328c`。
- [CTranslate2 转换与量化文档](https://opennmt.net/CTranslate2/guides/transformers.html)。
