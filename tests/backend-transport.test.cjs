const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createLoader } = require('./helpers/load-typescript.cjs');
const { createBackendTransport, BackendError } = createLoader()('src/core/backendTransport.ts');

function transport(overrides = {}) {
  return createBackendTransport({
    url: 'https://FICTITIOUS-project.invalid', publicKey: 'FICTITIOUS-public-key',
    getAccessToken: async () => 'FICTITIOUS-user-token',
    // Tests must opt in to a fake fetch, never fall back to a real network.
    fetch: async () => { throw new Error('Unexpected call'); }, ...overrides,
  });
}

test('client rejects 66, missing and fake sessions locally without fetching', async () => {
  for (const overrides of [
    { isDiagnostic: () => true }, { getAccessToken: async () => null }, { getAccessToken: async () => 'debug' },
  ]) {
    let fetched = false;
    const request = transport({ ...overrides, fetch: async () => { fetched = true; } });
    await assert.rejects(request({ action: 'status' }), (error) => error instanceof BackendError && error.code === 'AUTH_REQUIRED');
    assert.equal(fetched, false);
  }
});

test('client sends public app key and user JWT to its own backend, never a provider', async () => {
  const request = transport({ fetch: async (url, init) => {
    assert.equal(url, 'https://FICTITIOUS-project.invalid/functions/v1/mnemosine-api');
    assert.equal(init.headers.Authorization, 'Bearer FICTITIOUS-user-token');
    assert.equal(init.headers.apikey, 'FICTITIOUS-public-key');
    assert.deepEqual(JSON.parse(init.body), { action: 'status' });
    return Response.json({ version: 1 });
  } });
  assert.deepEqual(await request({ action: 'status' }), { version: 1 });
});

test('client leaves multipart boundary to fetch', async () => {
  const form = new FormData();
  form.append('action', 'audio.transcribe');
  const request = transport({ fetch: async (_url, init) => {
    assert.equal(init.body, form);
    assert.equal(init.headers['Content-Type'], undefined);
    return Response.json({ text: 'prueba' });
  } });
  assert.deepEqual(await request(form), { text: 'prueba' });
});

test('not-deployed and gateway 401 failures give actionable messages without raw upstream error', async () => {
  for (const [status, code] of [[404, 'NOT_DEPLOYED'], [401, 'BACKEND_ERROR']]) {
    const request = transport({ fetch: async () => Response.json({ message: 'FICTITIOUS-private-upstream-value' }, { status }) });
    await assert.rejects(request({ action: 'status' }), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      assert.equal(error.message.includes('FICTITIOUS-private-upstream-value'), false);
      return true;
    });
  }
});

test('structured backend error and invalid JSON are handled explicitly', async () => {
  const rejected = transport({ fetch: async () => Response.json({ error: { code: 'RATE_LIMITED', message: 'Espera para reintentar.' } }, { status: 429 }) });
  await assert.rejects(rejected({ action: 'status' }), (error) => error.code === 'RATE_LIMITED' && error.status === 429);
  const invalid = transport({ fetch: async () => new Response('<html>invalid</html>') });
  await assert.rejects(invalid({ action: 'status' }), (error) => error.code === 'INVALID_RESPONSE');
});

test('network exceptions cannot expose tokens or arbitrary details', async () => {
  const request = transport({ fetch: async () => { throw new Error('Bearer FICTITIOUS-secret'); } });
  await assert.rejects(request({ action: 'status' }), (error) => {
    assert.equal(error.code, 'NETWORK_ERROR');
    assert.equal(error.message.includes('FICTITIOUS-secret'), false);
    return true;
  });
});

test('cancellation propagates to fetch and removes signal listener', async () => {
  const controller = new AbortController();
  const request = transport({ fetch: async (_url, init) => {
    controller.abort();
    assert.equal(init.signal.aborted, true);
    throw new Error('Aborted');
  } });
  await assert.rejects(request({ action: 'status' }, controller.signal), (error) => error.code === 'REQUEST_ABORTED');
});
