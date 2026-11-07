import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { requestInference } from '../upstream.mjs';

const languages = new Map(Object.entries({
  en: 'English', zh: 'Simplified Chinese', 'zh-Hant': 'Traditional Chinese',
  fr: 'French', pt: 'Portuguese', es: 'Spanish', ja: 'Japanese', tr: 'Turkish',
  ru: 'Russian', ar: 'Arabic', ko: 'Korean', th: 'Thai', it: 'Italian', de: 'German',
  vi: 'Vietnamese', ms: 'Malay', id: 'Indonesian', tl: 'Filipino', hi: 'Hindi',
  pl: 'Polish', cs: 'Czech', nl: 'Dutch', km: 'Khmer', my: 'Burmese', fa: 'Persian',
  gu: 'Gujarati', ur: 'Urdu', te: 'Telugu', mr: 'Marathi', he: 'Hebrew',
  bn: 'Bengali', ta: 'Tamil', uk: 'Ukrainian', bo: 'Tibetan', kk: 'Kazakh',
  mn: 'Mongolian', ug: 'Uyghur', yue: 'Cantonese',
}));
const targets = [...languages.keys()];
const inferenceScript = fileURLToPath(new URL('./inference.sh', import.meta.url));

export function createHyMt2Model({ name, id, weight, setupScript, runtime = () => ({}) }) {
  return {
    id,
    setupScript,
    targets,
    backendPort: () => process.env.LLAMA_PORT ?? 18080,
    backendCommand(port) {
      const overrides = runtime();
      if (!existsSync(weight) || (overrides.LLAMA_SERVER && !existsSync(overrides.LLAMA_SERVER))) {
        throw new Error(`请先执行 bash service.sh setup ${name}`);
      }
      return {
        command: 'bash',
        args: [inferenceScript],
        env: { ...process.env, ...overrides, MODEL_PATH: weight, LLAMA_MODEL_ALIAS: id, LLAMA_PORT: String(port) },
      };
    },
    async translate(origin, { text, target }, signal) {
      const result = await requestInference(`${origin}/v1/chat/completions`, {
        model: id,
        messages: [{
          role: 'user',
          content: `Translate the following text into ${languages.get(target)}. Note that you should only output the translated result without any additional explanation:\n${text}`,
        }],
        temperature: 0.7, top_p: 0.6, top_k: 20, repeat_penalty: 1.05,
        max_tokens: 768, cache_prompt: false, seed: 42, stream: false, timings_per_token: true,
      }, signal);
      const choice = result.choices?.[0];
      return {
        translation: choice?.message?.content,
        finishReason: choice?.finish_reason,
        usage: result.usage,
        inference: result.timings,
      };
    },
  };
}
