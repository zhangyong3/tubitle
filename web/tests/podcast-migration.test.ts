import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createClient } from '@libsql/client';

test('additive SQLite/D1 migration preserves existing users and learning records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'podcast-migration-'));
  const client = createClient({ url: `file:${dir}/test.db` });
  try {
    await client.executeMultiple(
      "CREATE TABLE user (id text PRIMARY KEY); CREATE TABLE learning_record (id text PRIMARY KEY, user_id text, text text); INSERT INTO user(id) VALUES('existing'); INSERT INTO learning_record(id,user_id,text) VALUES('saved','existing','Private learning text');"
    );
    await client.executeMultiple(
      await readFile(
        new URL('../migrations/20261127-podcasts.sqlite.sql', import.meta.url),
        'utf8'
      )
    );
    assert.equal(
      (await client.execute('SELECT text FROM learning_record')).rows[0].text,
      'Private learning text'
    );
    assert.equal(
      (await client.execute('SELECT podcast_language_notice FROM user')).rows[0]
        .podcast_language_notice,
      1
    );
    const tables = (
      await client.execute("SELECT name FROM sqlite_master WHERE type='table'")
    ).rows.map((row) => row.name);
    for (const table of [
      'podcast_episode',
      'podcast_preference',
      'podcast_source',
      'member_usage_day',
    ])
      assert.ok(tables.includes(table));
  } finally {
    client.close();
    await rm(dir, { recursive: true, force: true });
  }
});
