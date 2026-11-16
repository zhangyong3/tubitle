import { fileURLToPath } from 'node:url';
import { createLlamaModel } from '../llama/adapter.mjs';

const languages = {
  ar: 'Arabic', en: 'English', es: 'Spanish', de: 'German', fr: 'French', it: 'Italian',
  ja: 'Japanese', nl: 'Dutch', pl: 'Polish', pt: 'Portuguese', ru: 'Russian', tr: 'Turkish', zh: 'Chinese',
  bg: 'Bulgarian', bn: 'Bengali', cs: 'Czech', da: 'Danish', el: 'Greek', fa: 'Persian', fi: 'Finnish',
  hi: 'Hindi', hu: 'Hungarian', id: 'Indonesian', ko: 'Korean', nb: 'Norwegian Bokmål', ro: 'Romanian',
  sk: 'Slovak', sv: 'Swedish', th: 'Thai', uk: 'Ukrainian', vi: 'Vietnamese',
  am: 'Amharic', az: 'Azerbaijani', bo: 'Tibetan', he: 'Hebrew', hr: 'Croatian', hy: 'Armenian',
  is: 'Icelandic', jv: 'Javanese', ka: 'Georgian', kk: 'Kazakh', km: 'Khmer', ky: 'Kirghiz',
  lo: 'Lao', mvf: 'Inner Mongolian', mr: 'Marathi', ms: 'Malay', my: 'Burmese', ne: 'Nepali',
  ps: 'Pashto', si: 'Sinhala', sw: 'Swahili', ta: 'Tamil', te: 'Telugu', tg: 'Tajik',
  tl: 'Tagalog', ug: 'Uyghur', ur: 'Urdu', uz: 'Uzbek', yue: 'Cantonese',
};

export default createLlamaModel({
  name: 'niutrans',
  id: 'lmt-60-0.6b-q4',
  weight: 'models/LMT-60-0.6B-Q4_K_M.gguf',
  setupScript: fileURLToPath(new URL('./setup.sh', import.meta.url)),
  targets: Object.keys(languages),
  pairError({ source }) {
    if (source !== undefined && (typeof source !== 'string' || !Object.hasOwn(languages, source.split('-')[0]))) {
      return 'LMT-60 不支持该源语言';
    }
  },
  prompt({ text, source, target }) {
    const from = source ? languages[source.split('-')[0]] : null;
    return `Translate the following text ${from ? `from ${from} ` : ''}into ${languages[target]}:\n${from ? `${from}: ` : ''}${text}\n${languages[target]}:`;
  },
  generation: { temperature: 0, top_p: 1, top_k: 0, repeat_penalty: 1, max_tokens: 512 },
});
