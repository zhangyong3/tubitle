import { ANALYSIS_PROMPT } from './prompt';

export async function generateAnalysis(sentence: string, config: Record<string, string>, signal?: AbortSignal): Promise<string> {
  const base = new URL(config.openai_base_url || 'https://api.openai.com/v1');
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) throw new Error('Invalid AI endpoint');
  if (!config.openai_api_key || !config.openai_model) throw new Error('AI_NOT_CONFIGURED');
  const response = await fetch(`${base.href.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', redirect: 'error',
    signal: AbortSignal.any([AbortSignal.timeout(55000), ...(signal ? [signal] : [])]),
    headers: { Authorization: `Bearer ${config.openai_api_key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.openai_model, stream: false, temperature: 0.2, max_tokens: 4096, messages: [{ role: 'system', content: ANALYSIS_PROMPT }, { role: 'user', content: sentence }] }),
  });
  if (!response.ok || !response.body) throw new Error('AI provider unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      body += decoder.decode(value, { stream: !done });
      if (body.length > 262144) throw new Error('AI response too large');
      if (done) break;
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const payload = JSON.parse(body);
  const choice = payload.choices?.[0];
  const result = choice?.message?.content;
  if (choice?.finish_reason !== 'stop' || typeof result !== 'string' || !result.trim() || result.length > 50000) throw new Error('AI response incomplete');
  return result;
}
