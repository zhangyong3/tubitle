# 腾讯官方 Hy-MT2 2-bit 与 Q4_K_M 对比

在这台 M1 Pro 的纯 CPU 测试里，官方 2-bit 权重小约 47%，短字幕没有稳定加速。当前体验服务继续用 Q4_K_M。

比较的是腾讯发布的原始 [2-bit GGUF](https://huggingface.co/tencent/Hy-MT2-1.8B-2Bit-GGUF/blob/edf68a9/Hy-MT2-1.8B-2Bit.gguf) 与 [Q4_K_M GGUF](https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/blob/b27182d/Hy-MT2-1.8B-Q4_K_M.gguf)。两份权重分别为 600,534,880 和 1,133,080,448 字节；2-bit 文件小约 47.0%。2-bit 文件已核对官方 SHA-256：`dcc33bbae9b28d923c8c76a64f6157840841d26f8774f3dfd770d5fabeeb1cd7`。

现有上游 `b12140` 实测无法加载 2-bit 文件，报 `blk.0.attn_k_norm.weight` 的张量偏移不符。该文件使用 Q2_0C，GGUF 张量类型编号是 40；[腾讯模型卡链接的 PR](https://github.com/ggml-org/llama.cpp/pull/19357) 中，[提交 `92c448af6`](https://github.com/chaxu01/llama.cpp/commit/92c448af6) 的实现与这一编号对应。用它构建一份 CPU 版 llama.cpp，对两份权重使用相同的二进制。构建启用 `GGML_CPU_KLEIDIAI=ON`，关闭 `GGML_METAL`；日志确认 2-bit 加载了 224 个 Q2_0C 张量并使用了 `CPU_KLEIDIAI` 模型缓冲。M1 Pro 支持 DotProd，不支持 SME2；本次没有 Metal 同条件对照，结果也不能外推到 x86 VPS 或带 SME2 的机器。

两份权重依次运行，均用 8 个线程、4 个推理槽、8,192 总上下文、同一 Node HTTP 接口与生成参数。预热后，对 [同一批样例](../benchmarks/samples.json) 测在途请求数 1、2、4；每组 2 轮，短字幕 16 条、段落 8 条，英译简中。耗时从发送 HTTP 到收到完整译文，不含载入模型。按组计算 p50、p95 和完成请求数/秒；组样本量小，p95 等于最大值。译文及计时保存在本地 `results/q2-compare-cpu.json`、`results/q4-compare-cpu.json`。

| 样例 | 在途请求 | 2-bit p50 / p95 | 2-bit 条/秒 | Q4_K_M p50 / p95 | Q4_K_M 条/秒 |
|---|---:|---:|---:|---:|---:|
| 短字幕 | 1 | 656 / 852 ms | 1.54 | 625 / 1,554 ms | 1.46 |
| 短字幕 | 2 | 1,075 / 1,456 ms | 1.91 | 897 / 1,626 ms | 2.04 |
| 短字幕 | 4 | 1,599 / 2,769 ms | 2.28 | 1,725 / 2,401 ms | 2.34 |
| 段落 | 1 | 2,336 / 4,134 ms | 0.39 | 2,531 / 3,108 ms | 0.39 |
| 段落 | 2 | 4,374 / 4,901 ms | 0.46 | 3,817 / 6,004 ms | 0.44 |
| 段落 | 4 | 3,757 / 4,670 ms | 0.93 | 8,471 / 11,471 ms¹ | 0.42¹ |

每个模型的 72 条计时请求均完成且未截断，未复用提示 token。¹ Q4_K_M 段落并发 4 与本机浏览器的 Metal 体验请求重叠，且只有 8 条；不能用这组数据推断 2-bit 段落加速。

关键组复测只跑并发 4 的短字幕，每组 32 条。前两组使用同一个兼容构建；最后一行是当前 Q4 运行时关闭 GPU 后的额外基线。

| 权重与运行时 | p50 / p95 | 条/秒 |
|---|---:|---:|
| 2-bit，兼容构建（第一次） | 1,533 / 2,833 ms | 2.39 |
| 2-bit，兼容构建（第二次） | 1,375 / 1,790 ms | 2.89 |
| Q4_K_M，兼容构建 | 1,595 / 2,120 ms | 2.44 |
| Q4_K_M，现用 `b12140` | 1,261 / 1,825 ms | 3.11 |

第一次 2-bit 复测期间本机体验服务有 3 条请求，因此又补测了一次。2-bit 在同运行时有时更快，但优势没有稳定重现；在此机器和配置下，两次吞吐都未超过现用的 Q4_K_M 运行时。

16 条人工样例中，两个版本都保留了“3 个百分点”和“3%”的区别。2-bit 把 `a tiny dip in starlight` 译成“星光中极小的折射现象”，添加了原文没有的“折射”；Q4 译成“星光中的微小变化”，只保留了变化、漏掉下降。2-bit 还把 `turn on Metal` 译为“开启金属模式”，而 Q4 保留了 Metal。也有 2-bit 更准确的地方：`warmed up` 译为“预热”，而 Q4 译为“升温”。这些例子不代表所有语言或实际字幕质量。

复测时在 `translation-service` 目录执行。先下载并校验上述权重，构建兼容的 llama.cpp `llama-server` 目标，再用独立端口启动两项服务：

```sh
MODEL_PATH=models/Hy-MT2-1.8B-2Bit.gguf \
  LLAMA_SERVER=.runtime/q2-src/legacy/build/bin/llama-server \
  LLAMA_PORT=18086 LLAMA_GPU_LAYERS=0 bash src/models/hy-mt2/inference.sh
```

```sh
LLAMA_PORT=18086 PORT=18087 node src/http/server.mjs
```

```sh
PORT=18087 BENCH_BACKEND=cpu BENCH_ROUNDS=2 BENCH_MODEL=Hy-MT2-1.8B-2Bit \
  node benchmarks/bench.mjs results/q2-compare-cpu.json
```

切换到 `models/Hy-MT2-1.8B-Q4_K_M.gguf` 后重启推理进程，保持同一个 `LLAMA_SERVER`，将 `BENCH_MODEL` 和输出文件改为 Q4 对应值。API 响应里的 `model` 是启动脚本的固定别名；JSON 报告顶层 `model` 由 `BENCH_MODEL` 写入，标识实际权重。
