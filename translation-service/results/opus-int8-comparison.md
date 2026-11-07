# OPUS-MT INT8 与 Hy-MT2 Q4_K_M：英译简中 CPU 对照

在 Apple M1 Pro（10 核、32 GB）上依次测试。OPUS 使用 [Helsinki-NLP 官方权重](https://huggingface.co/Helsinki-NLP/opus-mt-en-zh/tree/408d9bc410a388e1d9aef112a2daba955b945255)，源文件 SHA-256 与 Hugging Face 发布值一致；用 [CTranslate2](https://opennmt.net/CTranslate2/guides/transformers.html#marianmt) 转换为 INT8，并在请求前以 `>>cmn_Hans<<` 指定简体中文。OPUS 比较 beam=1 和模型配置的 beam=4；Q4 使用现用 llama.cpp `b12140`，关闭 GPU，保留原有生成设置。

两个推理方案都配置 8 个 CPU 线程：CTranslate2 4 个 worker、每个 2 线程；llama.cpp 8 线程、4 个槽。各方案预热后，使用同一个 Node HTTP 压测客户端，每组 32 条短字幕或 16 条段落，内容来自同一批 [`samples.json`](../benchmarks/samples.json)。延迟到收完译文为止，含分词和 HTTP，不含模型载入。客户端固定在途请求数，没有译文缓存或跨请求批量合并；llama.cpp 使用自身的连续批处理。不同模型的分词不同，不比较 token/s。

转换后的 OPUS 权重为 79,567,635 字节，Q4 GGUF 为 1,133,080,448 字节。CTranslate2 4.8.5 运行日志确认使用 ARM NEON、Ruy INT8 矩阵乘法，实际计算类型为 `int8_float32`；其余部分使用浮点。三个全量测试各 144 条计时请求，全部完成，无截断；测试各自开始和结束的体验服务日志大小相同。

| 样例 | 在途 | Q4 p50 / p95，条/秒 | OPUS beam=1 p50 / p95，条/秒 | OPUS beam=4 p50 / p95，条/秒 |
|---|---:|---:|---:|---:|
| 短字幕 | 1 | 689 / 1,158 ms，1.37 | 45 / 76 ms，19.18 | 82 / 132 ms，11.61 |
| 短字幕 | 2 | 1,187 / 1,917 ms，1.65 | 53 / 88 ms，32.65 | 96 / 160 ms，18.85 |
| 短字幕 | 4 | 1,229 / 2,697 ms，2.62 | 74 / 119 ms，46.11 | 140 / 226 ms，26.25 |
| 段落 | 1 | 1,216 / 2,653 ms，0.73 | 225 / 296 ms，4.30 | 340 / 423 ms，2.79 |
| 段落 | 2 | 2,274 / 3,819 ms，0.79 | 263 / 347 ms，6.81 | 441 / 550 ms，4.19 |
| 段落 | 4 | 5,988 / 9,169 ms，0.71 | 369 / 487 ms，9.33 | 632 / 822 ms，5.54 |

额外在并发 4 分别跑了 1,024 条重复短字幕请求，无缓存。beam=1 在 22.76 秒内全部完成，**44.99 条/秒，p50/p95 为 78/128 ms**；beam=4 在 38.07 秒内全部完成，**26.90 条/秒，p50/p95 为 138/233 ms**。原始数据为 `results/opus-long-beam{1,4}-cpu.json`。这是合成负载的短时吞吐，不能据此承诺真实视频高峰容量。

译文人工查看共 12 个英译简中样例：

| 源文 | OPUS beam=1 | OPUS beam=4 | Q4 |
|---|---|---|---|
| `a piece of cake` | 很顺利 | 小菜一碟 | 很容易 |
| `My coffee kicked in right after I decided to take a nap.` | 我决定睡午觉后咖啡就倒了 | 我决定睡午觉后 我的咖啡就泡汤了 | 我决定小睡一会儿后，咖啡立刻开始起作用了。 |
| `a tiny dip in starlight` | 星光中的微小沉积 | 星光的微小沉积 | 星光中的微小变化 |
| `turn on Metal` | 打开金属 | 打开金属 | 打开 Metal |
| `3 percentage points, not by 3 percent` | 3个百分点,而不是3% | 3个百分点,而不是3% | 3个百分点，而不是3% |

两档都能保留这组数字样例的关键信息。beam=4 改善了部分词句，却仍在口语、专名和技术语境中改错原意。这批样例不足以评估一般准确率，也不能把差异单独归因于 INT8。原始译文和计时保存在 `results/opus-compare-{q4,beam1,beam4}-cpu.json`。

复现：进入 `translation-service`，执行 `bash service.sh setup opus`，用 `PORT=18092 OPUS_BEAM=1 .runtime/opus/venv/bin/python src/models/opus/serve.py` 启动 OPUS，然后运行 `PORT=18092 BENCH_TARGET=zh BENCH_BACKEND=cpu BENCH_MODEL=OPUS-MT-en-zh-int8-beam1 node benchmarks/bench.mjs results/opus-compare-beam1-cpu.json`。beam=4 单独启动。对照使用 `LLAMA_GPU_LAYERS=0` 启动 Q4，使用同一客户端、`BENCH_TARGET=zh`，保持两个模型的测试时段分开。服务仅用于本机压测。
