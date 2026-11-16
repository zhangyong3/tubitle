# Tubitle 自研翻译服务

Tubitle 用同一个接口运行五种模型，浏览器插件只需选择「使用 Tubitle 自研翻译服务」。本地服务和推理进程仅绑定 `127.0.0.1`，无需 API 密钥。VPS 可通过带访问密钥的 HTTPS 代理接入，见 [VPS 运维说明](deploy/README.md) 和 [VPS 实测报告](results/vps-deployment.md)。翻译权重分别来自腾讯混元、NiuTrans、SMaLL-100 作者和 Helsinki-NLP。

在本目录执行。要求 Node.js 20+、curl、shasum。模型按需准备一次，已经准备好的机器可以直接启动：

| 模型参数 | 首次准备 | 用途 |
|---|---|---|
| `q4` | `bash service.sh setup q4` | 默认，Hy-MT2 Q4_K_M，多语言；Apple Silicon 上安装固定版 llama.cpp。其他系统需先安装支持 Hy-MT2 的 `llama-server`。 |
| `2bit` | `bash service.sh setup 2bit` | 官方 Hy-MT2 2-bit，多语言；需要 CMake、编译器和兼容的 llama.cpp，使用 CPU。 |
| `niutrans` | `bash service.sh setup niutrans` | 小牛 LMT-60-0.6B Q4_K_M，60 种语言、以中英为中心的 234 个方向；需要 uv、Python 3.11、llama-server 和 llama-quantize。首次安装转换官方权重。 |
| `small100` | `bash service.sh setup small100` | SMaLL-100 INT8，100 种语言；需要 uv 和 Python 3.11。默认 beam=5。 |
| `opus` | `bash service.sh setup opus` | OPUS-MT INT8，英文 → 简体中文；需要 `uv` 和 Python 3.11。 |

```sh
bash service.sh start q4      # 后台启动，等待 API 就绪
bash service.sh status
bash service.sh restart 2bit  # 停掉旧模型，改用 2-bit
bash service.sh restart opus  # 改用 OPUS-MT
bash service.sh restart niutrans # 改用小牛翻译
bash service.sh restart small100 # 改用 SMaLL-100（默认 beam=5）
bash service.sh logs          # 最近的服务和推理日志
bash service.sh stop          # 同时停止 API 和推理进程
```

默认 API 端口 `18081`，内部推理端口 `18080`。`TUBITLE_PORT` 和 `TUBITLE_BACKEND_PORT` 可为测试指定独立端口；插件默认访问 `18081`，也可在设置页填写远程 HTTPS 服务地址和访问密钥。若端口上已有手工启动的旧服务，先停止旧进程；启停脚本只管理自己启动的进程。OPUS 默认 `OPUS_BEAM=1`；可用 `OPUS_BEAM=4 bash service.sh restart opus` 比较译文。

在 Chrome 重新加载已构建的 `extension/dist`，在弹窗选择「使用 Tubitle 自研翻译服务」。用 OPUS 时，将目标语言设为「中文（简体）」并打开带英文 CC 的视频。切换模型后刷新视频页面，让当前页重新请求译文；持久字幕缓存按模型区分。

```sh
curl -fsS http://127.0.0.1:18081/health
curl -fsS http://127.0.0.1:18081/v1/translate \
  -H 'Content-Type: application/json' \
  -d '{"text":"The battery dropped from 82% to 39% in just 45 minutes.","source":"en","target":"zh"}'
```

五个模型的接口相同。健康检查返回 `ready`、`model` 和 `targets`；翻译返回 `translation`、`target`、`model`、`finishReason`。`target` 默认 `zh`，`source` 可省略；OPUS 仅接受 `zh` 目标，若显式传 `source`，须为 `en` 或其地区变体。输入最多 1,200 字符；OPUS 另有 512 输入 token 上限。`finishReason: "length"` 表示可能截断。插件会附上 `expectedModel`，避免切换时把新模型译文存入旧模型缓存。

[Q4 实测](results/benchmark.md) · [2-bit 对照](results/2bit-comparison.md) · [OPUS 对照](results/opus-int8-comparison.md) · [小牛与 SMaLL-100 对照](results/multilingual-comparison.md)。对照报告保留了直接启动推理进程的命令，便于复现实验。

代码按职责存放：

```text
service.sh                 # 安装、启停、切换和查看日志
src/
  http/                    # 插件使用的统一 HTTP 接口
  runtime/                 # API 和推理进程的启停与状态
  models/
    index.mjs              # 模型注册表
    llama/                 # llama.cpp 公共启动、安装和请求适配
    hy-mt2/                # 混元翻译模型
      q4/                  # Q4_K_M 的配置与安装
      2bit/                # 2-bit 的配置与安装
    niutrans/              # 小牛的提示词、安装与 GGUF 转换
    small100/              # SMaLL-100 的分词、INT8 转换和 Python 推理
    opus/                  # OPUS-MT INT8 的配置、安装与 Python 推理
benchmarks/                # 压测脚本与字幕样例
results/                   # 历史压测报告
```

已下载的权重和推理环境继续放在 `models/` 和 `.runtime/`，无需重新下载。

接入新模型时，在 `src/models/` 下增加目录并在 `index.mjs` 注册。模型模块提供语言能力、安装脚本、推理进程启动参数和翻译方法；HTTP 层负责统一校验和响应，进程管理层负责启停。


小牛使用官方 LMT-60-0.6B 权重转换成 Q4_K_M，采用单路贪心解码；官方 Transformers 示例的 beam=5 不是当前 llama.cpp 接口的行为。它支持 `zh`，不单独提供 `zh-Hant`。传入 `source` 时可以使用 `en-US`、`zh-CN` 等地区变体。

SMaLL-100 使用官方分词器：目标语言标记放在编码器输入前，不使用普通 M2M100 的强制目标 BOS。默认 `SMALL100_WORKERS=4`、`SMALL100_THREADS=2`、`SMALL100_BEAM=5`。可用 `SMALL100_BEAM=1 bash service.sh restart small100` 测试更快的解码设置；健康检查中的模型 ID 包含 beam，避免与 beam=5 混用插件缓存。它同样不单独提供繁体中文目标。

按 VPS 的纯 CPU 场景启动：`LLAMA_GPU_LAYERS=0 LLAMA_THREADS=8 bash service.sh start niutrans`。SMaLL-100 本身使用 CPU INT8；不要把一台 4 vCPU 机器配置成四个 worker、每个八线程。

开发检查：`node --test tests/models.test.mjs`；安装 SMaLL-100 后可执行 `.runtime/small100/venv/bin/python -m unittest discover -s tests -p 'test_small100.py'`，检查词表 ID 与目标语言标记。适配器修正了官方分词器导出保留词条时覆盖 `<unk>` ID 的问题；输入分词及目标语言前缀仍遵循官方实现。

压测：`PORT=18081 BENCH_ROUNDS=2 BENCH_BACKEND=cpu BENCH_MODEL=实际模型名 node benchmarks/bench.mjs results/benchmark.json`。脚本依次检查多语言样例，然后测英译简中的短字幕和段落；原始数据继续留在 Git 忽略目录。
