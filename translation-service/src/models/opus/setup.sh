#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/../../.."

runtime=.runtime/opus
source_model="$runtime/source"
mkdir -p "$source_model"
export UV_CACHE_DIR="$PWD/$runtime/cache"

if [[ ! -x "$runtime/venv/bin/python" ]]; then
  uv venv --python "${OPUS_PYTHON:-3.11}" "$runtime/venv"
fi
uv pip install --python "$runtime/venv/bin/python" 'ctranslate2==4.8.5' 'transformers==4.57.6' 'torch==2.15.0' 'sentencepiece==0.2.3' 'sacremoses==0.2.0'

repo=https://huggingface.co/Helsinki-NLP/opus-mt-en-zh/resolve/408d9bc410a388e1d9aef112a2daba955b945255
for name in config.json generation_config.json tokenizer_config.json vocab.json source.spm target.spm pytorch_model.bin; do
  path="$source_model/$name"
  if [[ ! -s "$path" ]]; then
    curl -fsSL --retry 2 --connect-timeout 12 -C - "$repo/$name" -o "$path.part"
    mv "$path.part" "$path"
  fi
done
printf '%s  %s\n' 69a1d6ec829cee349360b3b677ac0aa99a7d88822d1a6578370029efffdca3f5 "$source_model/pytorch_model.bin" | shasum -a 256 -c -
if [[ ! -s "$runtime/int8/model.bin" ]]; then
  "$runtime/venv/bin/ct2-transformers-converter" --model "$source_model" \
    --output_dir "$runtime/int8" --quantization int8 --force
fi
