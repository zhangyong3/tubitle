import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { requestInference } from '../upstream.mjs';

const beam = Number(process.env.SMALL100_BEAM ?? 5);
if (!Number.isInteger(beam) || beam < 1 || beam > 5) throw new Error('SMALL100_BEAM 必须是 1～5 的整数');

export default {
  id: `small100-int8-beam${beam}`,
  setupScript: fileURLToPath(new URL('./setup.sh', import.meta.url)),
  targets: 'af am ar ast az ba be bg bn br bs ca ceb cs cy da de el en es et fa ff fi fr fy ga gd gl gu ha he hi hr ht hu hy id ig ilo is it ja jv ka kk km kn ko lb lg ln lo lt lv mg mk ml mn mr ms my ne nl no ns oc or pa pl ps pt ro ru sd si sk sl so sq sr ss su sv sw ta th tl tn tr uk ur uz vi wo xh yi yo zh zu'.split(' '),
  backendPort: () => process.env.SMALL100_PORT ?? 18096,
  backendCommand(port) {
    const python = '.runtime/small100/venv/bin/python';
    if (![python, '.runtime/small100/int8/model.bin'].every(existsSync)) {
      throw new Error('请先执行 bash service.sh setup small100');
    }
    return { command: python, args: [fileURLToPath(new URL('./serve.py', import.meta.url))], env: { ...process.env, PORT: String(port) } };
  },
  async translate(origin, { text, target }, signal) {
    const result = await requestInference(`${origin}/v1/translate`, { text, target }, signal, { forwardBadRequest: true });
    return { translation: result.translation, finishReason: result.finishReason, usage: result.usage, inference: result.timings };
  },
};
