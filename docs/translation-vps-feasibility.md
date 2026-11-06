# 混元翻译模型：在线服务和 VPS 选型

核查日期：2026-11-06。根据用户提供的[知乎文章](https://zhuanlan.zhihu.com/p/2033223791376118267)内容，本文评估 AngelSlim 的 Hy-MT1.5-1.8B 1.25-bit / 2-bit GGUF，用途为文本和字幕翻译。**在线服务可行；普通 VPS 首选 4 vCPU / 8 GiB / 40–80 GB SSD，先跑标准 Q4，再比较文章中的超低位模型。** 规格尚未在目标 VPS 实测。

## 模型与运行时

| 模型 | 权重文件 | VPS 选型影响 |
| --- | --- | --- |
| [AngelSlim 1.25-bit GGUF](https://huggingface.co/AngelSlim/Hy-MT1.5-1.8B-1.25bit-GGUF) | [462 MB](https://huggingface.co/AngelSlim/Hy-MT1.5-1.8B-1.25bit-GGUF/tree/main) | 自定义 STQ 内核的 [llama.cpp #22836](https://github.com/ggml-org/llama.cpp/pull/22836) 尚未合并，优化路径是 ARM NEON。x86 的通用回退可能较慢，[AVX2 优化 #27377](https://github.com/ggml-org/llama.cpp/pull/27377) 仍开放；也有新旧权重类型编号不兼容的记录。需要固定配套构建与权重版本，测试实际云机指令集。 |
| [AngelSlim 2-bit GGUF](https://huggingface.co/AngelSlim/Hy-MT1.5-1.8B-2bit-GGUF) | [601 MB](https://huggingface.co/AngelSlim/Hy-MT1.5-1.8B-2bit-GGUF/tree/main) | 依赖 `Q2_0c`，对应 [llama.cpp #19357](https://github.com/ggml-org/llama.cpp/pull/19357) 仍是草稿，优化以 ARM SME2 为目标；仅标注 ARM64 的云机不能保证支持该加速。 |
| [腾讯 Hy-MT1.5-1.8B Q4_K_M](https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF/tree/main) | 1.13 GB | 同代标准量化权重，用来测试低位版本是否有速度或内存收益。 |
| [腾讯 Hy-MT2-1.8B Q4_K_M](https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF) | 1.13 GB | 官方卡列出 33 种语言、标准 `llama.cpp` 用法和 Apache 2.0。推荐作为公网服务的第一版。 |

以上文件大小是磁盘占用，运行还要算上下文缓存、工作缓冲和 Web 进程。公开使用原版 1.25-bit 前需核对[随权重附带的腾讯社区许可证](https://huggingface.co/AngelSlim/Hy-MT1.5-1.8B-1.25bit-GGUF/blob/main/License.txt)：授权地域排除欧盟、英国和韩国，并列出向第三方提供服务时的主体披露、声明及使用条款等要求。Hy-MT1.5 官方 Q4 也有[单独的腾讯社区许可证](https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF/blob/main/License.txt)。

## 按部署方式选机器

| 部署方式 | 建议起步配置 | 适用场景与边界 |
| --- | --- | --- |
| 网站和 API 网关，上游负责翻译 | 2 vCPU / 2 GiB 内存 / 25–50 GB SSD；同机运行较重的站点或数据库时选 4 GiB | 先验证需求、语种和用量；无须 GPU。服务端保管上游密钥，按用户限额。 |
| 自托管 1.8B 量化翻译模型 | 4 vCPU / 8 GiB / 40–80 GB SSD；2 vCPU / 4 GiB 只用于单请求验证 | 先用一个常驻实例跑短文本，再测并发。延迟敏感时优先测独享 vCPU，观察共享 CPU 的尾延迟。 |
| 自托管 7B 级量化模型或更高实时吞吐 | 4–8 vCPU / 16–32 GiB / 80–120 GB SSD；用 16–24 GB 显存 GPU 作压测起点 | 若 CPU 路线未达延迟目标、译质需要更大模型，或并发已证明稳定，再租 GPU。显存需包含权重、上下文缓存和推理框架开销。 |

以上为工程估计，不是官方最低规格或吞吐保证。同一档 vCPU 的性能会随宿主 CPU、指令集、共享比例和运行时改变。购买前先按小时租机，启动后用 `lscpu` 查看 VPS 暴露的指令集。

## 成本参考

- **CPU 机器标价示例：**[腾讯云轻量应用服务器](https://cloud.tencent.com/document/product/1207/73452/)中国大陆对应套餐 2 vCPU / 4 GiB 为 ¥65/月、4 vCPU / 8 GiB 为 ¥210/月。[DigitalOcean](https://www.digitalocean.com/pricing/droplets)共享 2 vCPU / 4 GiB 为 $24/月、4 vCPU / 8 GiB 为 $48/月；独享 4 vCPU / 8 GiB 的 CPU-Optimized 档为 $84/月。以实际机房和结算价格为准。
- **GPU 标价示例：**[Runpod Pods](https://www.runpod.io/pricing)列出的 24 GB RTX A5000 为 $0.27/小时、24 GB RTX 4090 为 $0.89/小时；730 小时常开约 $197 和 $650，另看磁盘等费用。可先按小时压测，勿把 730 小时常开当成验证成本。
- **上游标价示例：**[Google Cloud Translation NMT](https://cloud.google.com/products/translate/pricing)前 50 万字符/月由 $10 信用额度抵扣，之后 $20/百万输入字符；同一原文翻成多个语种按目标语种分别计量。例：单目标每月 100 万计费字符约 $10 API 费，500 万约 $90，另计 VPS。用相同语对、译质、缓存后的实际调用量和峰值比较两条路线。

## 部署验证

1. 固定必需语对，取真实字幕和长段落样本。检查省略上下文、专有名词、标点、数字、占位符、漏译和输出被截断的情况。首版按需翻译选中的目标语种。
2. 先用标准 Q4 在目标 CPU 机按并发 1/2/4 逐档压测。短字幕和多句段落分别统计端到端及排队 p95、吞吐、超时率、峰值内存，区分冷启动和热运行，再让 1.25-bit / 2-bit 跑同一组输入。实时字幕优先测当前句，全文翻译单独排队。是否升级以目标 p95、流量峰值和译质为依据。
3. 上线采用 HTTPS、鉴权、字符与并发额度。推理端口仅内部可访问；Web/API 层按需做缓存，不把用户原文写入普通日志。默认不对匿名用户开放无配额的推理。

若用于当前 Tubitle，现有翻译入口只接 Microsoft、Google、腾讯云；自定义大模型 Base URL 属于句子分析，不能直接接管字幕翻译。低改动试用路径是用现有可自定义的 Microsoft Endpoint 接一个兼容 `/translate` 的网关；长期可加自托管翻译服务商选项。代码依据：[README](../README.md)、[现有服务商调用](../extension/src/local-providers.ts)。
