#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/../../.."
source src/models/download.sh
runtime=.runtime/small100
repo=https://huggingface.co/alirezamsh/small100/resolve/8ab680e26a596d2e3d2d2d17ae0f68df1037328c
export UV_CACHE_DIR="$PWD/.runtime/python-cache"
if [[ ! -x "$runtime/venv/bin/python" ]]; then uv venv --python 3.11 "$runtime/venv"; fi
uv pip install --python "$runtime/venv/bin/python" 'ctranslate2==4.8.5' 'transformers==4.57.6' 'torch==2.15.0' 'sentencepiece==0.2.3'
for name in config.json tokenizer_config.json vocab.json special_tokens_map.json tokenization_small100.py; do
  download "$runtime/source/$name" "$repo/$name"
done
download "$runtime/source/sentencepiece.bpe.model" "$repo/sentencepiece.bpe.model" d8f7c76ed2a5e0822be39f0a4f95a55eb19c78f4593ce609e2edbc2aea4d380a
download "$runtime/source/model.safetensors" "$repo/model.safetensors" dd3b845a36ea4ed90437fd0b9b477e30c21f144d3658679fd5c945e3c96b0fbc
if [[ ! -s "$runtime/int8/model.bin" ]]; then
  HF_HUB_OFFLINE=1 "$runtime/venv/bin/python" src/models/small100/convert.py
fi
