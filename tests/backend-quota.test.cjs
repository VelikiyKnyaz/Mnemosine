const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');

// Actual PostgreSQL (WASM), temporary in-memory database. No Supabase project,
// account, provider or local .env is used. PGlite has one connection, so these
// tests validate SQL semantics/permissions, not multi-isolate concurrency.
test('quota migration, authorization and limits execute in PostgreSQL', async (t) => {
  const db = await PGlite.create();
  t.after(() => db.close());
  const migration = readFileSync(path.resolve(__dirname, '../supabase/migrations/202610080001_api_quotas.sql'), 'utf8');
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create table public.memories (id integer primary key, text text);
    insert into public.memories values (1, 'FICTITIOUS local test');
  `);
  await db.exec(migration);
  const userId = '11111111-1111-4111-8111-111111111111';
  const consume = async (bucket, id = userId) => (await db.query(
    'select public.mnemosine_consume_api_quota($1::uuid, $2) as result', [id, bucket]
  )).rows[0].result.allowed;
  const clear = () => db.exec('truncate public.mnemosine_api_usage');

  await t.test('migration is additive, repeatable and does not touch existing data', async () => {
    await db.exec(migration);
    assert.deepEqual((await db.query('select * from public.memories')).rows, [{ id: 1, text: 'FICTITIOUS local test' }]);
    assert.equal((await db.query("select relrowsecurity from pg_class where oid = 'public.mnemosine_api_usage'::regclass")).rows[0].relrowsecurity, true);
    assert.equal((await db.query("select prosecdef from pg_proc where oid = 'public.mnemosine_consume_api_quota(uuid,text)'::regprocedure")).rows[0].prosecdef, true);
  });

  await t.test('status is free; unsupported bucket and null user are rejected', async () => {
    assert.equal(await consume('status'), true);
    assert.equal((await db.query('select count(*)::int as count from public.mnemosine_api_usage')).rows[0].count, 0);
    await assert.rejects(consume('arbitrary'));
    await assert.rejects(consume('ai', null));
  });

  await t.test('anon and authenticated cannot execute quota RPC or access its table', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        await assert.rejects(consume('status'), /permission denied/);
        await assert.rejects(db.query('select * from public.mnemosine_api_usage'), /permission denied/);
      } finally { await db.exec('reset role'); }
    }
    await db.exec('set role service_role');
    try { assert.equal(await consume('status'), true); }
    finally { await db.exec('reset role'); }
  });

  await t.test('per-user minute limits enforce Google, AI and audio independently', async () => {
    for (const [bucket, limit] of [['google', 120], ['ai', 10], ['audio', 2]]) {
      await clear();
      for (let i = 0; i < limit; i++) assert.equal(await consume(bucket), true, bucket);
      assert.equal(await consume(bucket), false, bucket);
      const counts = (await db.query('select request_count from public.mnemosine_api_usage where subject = $1 and bucket = $2', [userId, `${bucket}:minute`])).rows;
      assert.equal(counts[0].request_count, limit);
    }
  });

  await t.test('per-user daily limit and project budget are fail-closed', async () => {
    for (const [subject, bucket, limit] of [[userId, 'ai:day', 150], ['project', 'ai:day', 500]]) {
      await clear();
      await db.query(`insert into public.mnemosine_api_usage values ($1, $2, date_trunc('day', now() at time zone 'UTC') at time zone 'UTC', $3)`, [subject, bucket, limit]);
      assert.equal(await consume('ai'), false);
      const count = (await db.query('select request_count from public.mnemosine_api_usage where subject = $1 and bucket = $2', [subject, bucket])).rows[0].request_count;
      assert.equal(count, limit);
    }
  });

  await t.test('different users have separate minute windows but share the project budget', async () => {
    await clear();
    assert.equal(await consume('audio'), true);
    assert.equal(await consume('audio'), true);
    assert.equal(await consume('audio'), false);
    assert.equal(await consume('audio', '22222222-2222-4222-8222-222222222222'), true);
    assert.equal((await db.query("select request_count from public.mnemosine_api_usage where subject = 'project' and bucket = 'audio:day'")).rows[0].request_count, 4);
  });
});
