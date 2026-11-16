#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/../../.."
source src/models/download.sh
bash src/models/llama/setup.sh
runtime=.runtime/niutrans
weight=models/LMT-60-0.6B-Q4_K_M.gguf
if [[ -s "$weight" ]]; then exit 0; fi
repo=https://huggingface.co/NiuTrans/LMT-60-0.6B/resolve/dd189845cdc73346cef33c7a94f4b8bd8efdd4eb
for name in config.json generation_config.json tokenizer.json tokenizer_config.json vocab.json merges.txt added_tokens.json special_tokens_map.json chat_template.jinja; do
  download "$runtime/source/$name" "$repo/$name"
done
download "$runtime/source/model.safetensors" "$repo/model.safetensors" c48c3b8d7b04d3c6e56452fa51ddefc03921043b0f70641cb80c5d3ac71b73e6
export UV_CACHE_DIR="$PWD/.runtime/python-cache"
if [[ ! -x "$runtime/venv/bin/python" ]]; then uv venv --python 3.11 "$runtime/venv"; fi
uv pip install --python "$runtime/venv/bin/python" 'torch==2.15.0' 'transformers==4.57.6' 'sentencepiece==0.2.3' 'protobuf==4.25.8' 'numpy==1.26.4'
download "$runtime/llama-b12140.tar.gz" https://github.com/ggml-org/llama.cpp/archive/refs/tags/b12140.tar.gz
mkdir -p "$runtime/llama-src" models
tar -xzf "$runtime/llama-b12140.tar.gz" -C "$runtime/llama-src" --strip-components=1
HF_HUB_OFFLINE=1 "$runtime/venv/bin/python" "$runtime/llama-src/convert_hf_to_gguf.py" "$runtime/source" --outfile "$runtime/model-f16.gguf" --outtype f16
quantizer=${LLAMA_QUANTIZE:-llama-quantize}
if [[ -z "${LLAMA_QUANTIZE:-}" && -x .runtime/llama-quantize ]]; then quantizer=./.runtime/llama-quantize; fi
"$quantizer" "$runtime/model-f16.gguf" "$weight.part" Q4_K_M
mv "$weight.part" "$weight"
shasum -a 256 "$weight" > "$runtime/quantized.sha256"
