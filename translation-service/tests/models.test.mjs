import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import q4 from '../src/models/hy-mt2/q4/model.mjs';
import niutrans from '../src/models/niutrans/model.mjs';
import small100 from '../src/models/small100/model.mjs';
import { models } from '../src/models/index.mjs';

test('new models are selectable and advertise their actual target languages', () => {
  assert.equal(models.get('niutrans'), niutrans);
  assert.equal(models.get('small100'), small100);
  assert.equal(niutrans.targets.length, 60);
  assert.equal(small100.targets.length, 100);
  for (const model of [niutrans, small100]) {
    for (const language of ['zh', 'en', 'ja', 'es', 'ar']) assert.ok(model.targets.includes(language));
    assert.ok(!model.targets.includes('zh-Hant'));
  }
});

test('LMT uses the requested source/target names and deterministic translation settings', async () => {
  let payload;
  const fetch = mock.method(globalThis, 'fetch', async (_url, options) => {
    payload = JSON.parse(options.body);
    return Response.json({ choices: [{ message: { content: '你好' }, finish_reason: 'stop' }], usage: { completion_tokens: 2 } });
  });
  try {
    const result = await niutrans.translate('http://localhost', { text: 'Hello', source: 'en-US', target: 'zh' });
    assert.equal(result.translation, '你好');
    assert.equal(payload.messages[0].content, 'Translate the following text from English into Chinese:\nEnglish: Hello\nChinese:');
    assert.equal(payload.temperature, 0);
    assert.equal(niutrans.pairError({ source: 'xx' }), 'LMT-60 不支持该源语言');
    assert.equal(niutrans.pairError({ source: 'zh-CN' }), undefined);
    await q4.translate('http://localhost', { text: 'Hello', target: 'zh' });
    assert.equal(payload.messages[0].content, 'Translate the following text into Simplified Chinese. Note that you should only output the translated result without any additional explanation:\nHello');
    assert.equal(payload.temperature, 0.7);
  } finally { fetch.mock.restore(); }
});

test('SMaLL-100 forwards language and upstream validation errors through the common interface', async () => {
  const fetch = mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'http://localhost/v1/translate');
    assert.deepEqual(JSON.parse(options.body), { text: 'Hello', target: 'ja' });
    return Response.json({ error: 'Input exceeds 1024 tokens' }, { status: 400 });
  });
  try {
    await assert.rejects(small100.translate('http://localhost', { text: 'Hello', target: 'ja' }), {
      status: 400, message: 'Input exceeds 1024 tokens',
    });
  } finally { fetch.mock.restore(); }
});
