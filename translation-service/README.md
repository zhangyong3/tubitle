# Tubitle 自研翻译服务

Tubitle 用同一个本地接口运行三种模型，浏览器插件只需选择「使用 Tubitle 自研翻译服务」。服务和推理进程仅绑定 `127.0.0.1`，无需 API 密钥。翻译权重由腾讯混元或 Helsinki-NLP 提供。

在本目录执行。要求 Node.js 20+、curl、shasum。模型按需准备一次，已经准备好的机器可以直接启动：

| 模型参数 | 首次准备 | 用途 |
|---|---|---|
| `q4` | `bash service.sh setup q4` | 默认，Hy-MT2 Q4_K_M，多语言；Apple Silicon 上安装固定版 llama.cpp。其他系统需先安装支持 Hy-MT2 的 `llama-server`。 |
| `2bit` | `bash service.sh setup 2bit` | 官方 Hy-MT2 2-bit，多语言；需要 CMake、编译器和兼容的 llama.cpp，使用 CPU。 |
| `opus` | `bash service.sh setup opus` | OPUS-MT INT8，英文 → 简体中文；需要 `uv` 和 Python 3.11。 |

```sh
bash service.sh start q4      # 后台启动，等待 API 就绪
bash service.sh status
bash service.sh restart 2bit  # 停掉旧模型，改用 2-bit
bash service.sh restart opus  # 改用 OPUS-MT
bash service.sh logs          # 最近的服务和推理日志
bash service.sh stop          # 同时停止 API 和推理进程
```

默认 API 端口 `18081`，内部推理端口 `18080`。`TUBITLE_PORT` 和 `TUBITLE_BACKEND_PORT` 可为测试指定独立端口；插件仍固定访问 `18081`。若端口上已有手工启动的旧服务，先停止旧进程；启停脚本只管理自己启动的进程。OPUS 默认 `OPUS_BEAM=1`；可用 `OPUS_BEAM=4 bash service.sh restart opus` 比较译文。

在 Chrome 重新加载已构建的 `extension/dist`，在弹窗选择「使用 Tubitle 自研翻译服务」。用 OPUS 时，将目标语言设为「中文（简体）」并打开带英文 CC 的视频。切换模型后刷新视频页面，让当前页重新请求译文；持久字幕缓存按模型区分。

```sh
curl -fsS http://127.0.0.1:18081/health
curl -fsS http://127.0.0.1:18081/v1/translate \
  -H 'Content-Type: application/json' \
  -d '{"text":"The battery dropped from 82% to 39% in just 45 minutes.","source":"en","target":"zh"}'
```

三个模型的接口相同。健康检查返回 `ready`、`model` 和 `targets`；翻译返回 `translation`、`target`、`model`、`finishReason`。`target` 默认 `zh`，`source` 可省略；OPUS 仅接受 `zh` 目标，若显式传 `source`，须为 `en` 或其地区变体。输入最多 1,200 字符；OPUS 另有 512 输入 token 上限。`finishReason: "length"` 表示可能截断。插件会附上 `expectedModel`，避免切换时把新模型译文存入旧模型缓存。

[Q4 实测](results/benchmark.md) · [2-bit 对照](results/2bit-comparison.md) · [OPUS 对照](results/opus-int8-comparison.md)。对照报告保留了直接启动推理进程的命令，便于复现实验。

代码按职责存放：

```text
service.sh                 # 安装、启停、切换和查看日志
src/
  http/                    # 插件使用的统一 HTTP 接口
  runtime/                 # API 和推理进程的启停与状态
  models/
    index.mjs              # 模型注册表
    hy-mt2/                # 两种量化共用提示词和 llama.cpp 启动脚本
      q4/                  # Q4_K_M 的配置与安装
      2bit/                # 2-bit 的配置与安装
    opus/                  # OPUS-MT INT8 的配置、安装与 Python 推理
benchmarks/                # 压测脚本与字幕样例
results/                   # 历史压测报告
```

已下载的权重和推理环境继续放在 `models/` 和 `.runtime/`，无需重新下载。

接入新模型时，在 `src/models/` 下增加目录并在 `index.mjs` 注册。模型模块提供语言能力、安装脚本、推理进程启动参数和翻译方法；HTTP 层负责统一校验和响应，进程管理层负责启停。
