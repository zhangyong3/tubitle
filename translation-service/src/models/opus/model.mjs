import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { requestInference } from '../upstream.mjs';

export default {
  id: 'opus-mt-en-zh-int8',
  setupScript: fileURLToPath(new URL('./setup.sh', import.meta.url)),
  sources: ['en'],
  targets: ['zh'],
  backendPort: () => process.env.OPUS_PORT ?? 18092,
  backendCommand(port) {
    const python = '.runtime/opus/venv/bin/python';
    if (![python, '.runtime/opus/int8/model.bin'].every(existsSync)) {
      throw new Error('请先执行 bash service.sh setup opus');
    }
    return {
      command: python,
      args: [fileURLToPath(new URL('./serve.py', import.meta.url))],
      env: { ...process.env, PORT: String(port) },
    };
  },
  pairError({ source, target }) {
    if (target !== 'zh' || (source !== undefined && (typeof source !== 'string' || !/^en(?:-|$)/i.test(source)))) {
      return 'OPUS-MT 仅支持英文 → 简体中文';
    }
  },
  async translate(origin, { text, target }, signal) {
    const result = await requestInference(`${origin}/v1/translate`, { text, target }, signal, { forwardBadRequest: true });
    return {
      translation: result.translation,
      finishReason: result.finishReason,
      usage: result.usage,
      inference: result.timings,
    };
  },
};
