const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createLoader } = require('./helpers/load-typescript.cjs');
const load = createLoader();
const { createApiHandler } = load('supabase/functions/mnemosine-api/handler.ts');
const { MAX_AUDIO_BYTES, MAX_MEMORY_CHARS } = load('shared/api.ts');
const { ALL_EMOTION_NAMES } = load('shared/emotions.ts');
const { EXTRACT_PROMPT } = load('supabase/functions/mnemosine-api/prompts.ts');

const userId = '11111111-1111-4111-8111-111111111111';
const token = 'FICTITIOUS-authenticated-user-token';
const serverSecrets = {
  SUPABASE_URL: 'https://FICTITIOUS-project.invalid',
  SUPABASE_ANON_KEY: 'FICTITIOUS-public-key',
  SUPABASE_SERVICE_ROLE_KEY: 'FICTITIOUS-service-role-JWT',
  OPENAI_API_KEY: 'sk-FICTITIOUS-server-openai',
  GOOGLE_MAPS_API_KEY: 'FICTITIOUS-server-google',
};

function fixture(options = {}) {
  const calls = [];
  const environment = { ...serverSecrets, ...options.environment };
  const handler = createApiHandler({
    env: (name) => environment[name],
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (url.endsWith('/auth/v1/user')) {
        return Response.json(options.user ?? { id: userId, role: 'authenticated', is_anonymous: false }, { status: options.authStatus ?? 200 });
      }
      if (url.endsWith('/rpc/mnemosine_consume_api_quota')) {
        return Response.json({ allowed: options.allowed ?? true }, { status: options.quotaStatus ?? 200 });
      }
      if (options.provider) return options.provider(String(url), init);
      return Response.json({ places: [], suggestions: [], status: 'ZERO_RESULTS', results: [] });
    },
  });
  const request = (body, headers = {}) => new Request('https://FICTITIOUS-function.invalid', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  return { handler, calls, request, environment };
}

function paidCalls(calls) {
  return calls.filter(({ url }) => /googleapis\.com|api\.openai\.com/.test(url));
}

test('missing/fake 66 tokens are rejected before Auth, quota or provider calls', async () => {
  for (const authorization of ['', 'Bearer debug', 'Bearer 66']) {
    const f = fixture();
    const response = await f.handler(f.request({ action: 'places.search', textQuery: 'Bogotá' }, { Authorization: authorization }));
    assert.equal(response.status, 401);
    assert.equal(f.calls.length, 0);
  }
});

test('user identity is validated by Auth; anonymous/invalid/expired sessions cannot spend', async () => {
  for (const options of [
    { authStatus: 401 }, { user: { id: userId, role: 'anon' } },
    { user: { id: userId, role: 'authenticated', is_anonymous: true } },
    { user: { id: 'admin', role: 'authenticated' } },
  ]) {
    const f = fixture(options);
    const response = await f.handler(f.request({ action: 'places.search', textQuery: 'Bogotá' }));
    assert.equal(response.status, 401);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].init.headers.Authorization, `Bearer ${token}`);
  }
});

test('status reports presence, never values, without consuming paid APIs', async () => {
  const f = fixture();
  const response = await f.handler(f.request({ action: 'status' }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.secrets, { openai: true, googleMaps: true });
  assert.equal(data.quotaReady, true);
  assert.equal(paidCalls(f.calls).length, 0);
  for (const value of Object.values(serverSecrets)) assert.equal(JSON.stringify(data).includes(value), false);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('quota is fail-closed and uses Auth identity, not a supplied user ID', async () => {
  for (const [options, status] of [[{ quotaStatus: 404 }, 503], [{ allowed: false }, 429]]) {
    const f = fixture(options);
    const response = await f.handler(f.request({ action: 'places.search', textQuery: 'Bogotá' }));
    assert.equal(response.status, status);
    assert.equal(paidCalls(f.calls).length, 0);
    assert.deepEqual(JSON.parse(f.calls[1].init.body), { p_user_id: userId, p_bucket: 'google' });
  }
  const f = fixture({ quotaStatus: 404 });
  const data = await (await f.handler(f.request({ action: 'status' }))).json();
  assert.equal(data.quotaReady, false);
});

test('new Supabase keys are preferred; secret keys travel only in apikey', async () => {
  const f = fixture({ environment: {
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_FICTITIOUS' }),
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_FICTITIOUS' }),
  } });
  await f.handler(f.request({ action: 'status' }));
  assert.equal(f.calls[0].init.headers.apikey, 'sb_publishable_FICTITIOUS');
  assert.equal(f.calls[1].init.headers.apikey, 'sb_secret_FICTITIOUS');
  assert.equal(f.calls[1].init.headers.Authorization, undefined);
});

test('missing secrets and quota configuration never fall back to a client key', async () => {
  for (const environment of [
    { GOOGLE_MAPS_API_KEY: '' }, { SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_SECRET_KEYS: '' },
  ]) {
    const f = fixture({ environment });
    const response = await f.handler(f.request({ action: 'places.search', textQuery: 'Bogotá' }));
    assert.equal(response.status, 503);
    assert.equal(paidCalls(f.calls).length, 0);
  }
});

test('arbitrary URLs, models, field masks, actions and invalid payloads are blocked before quota', async () => {
  const invalidBodies = [
    { action: 'proxy', url: 'https://attacker.invalid' },
    { action: 'ai.segment', text: 'Recuerdo', model: 'expensive-model' },
    { action: 'ai.extract', text: 'Recuerdo', userId: 'admin' },
    { action: 'ai.segment', text: 'x'.repeat(MAX_MEMORY_CHARS + 1) },
    { action: 'ai.extract', text: 'Recuerdo', spaceContext: 'x'.repeat(2001) },
    { action: 'places.search', textQuery: 'Bogotá', fieldMask: '*' },
    { action: 'places.search', textQuery: 'Bogotá', limit: 6 },
    { action: 'places.details', placeId: '../../credentials?key=x' },
    { action: 'places.autocomplete', input: 'Bog', includedPrimaryTypes: ['(cities)', 'country'] },
    { action: 'geocode.reverse', latitude: 91, longitude: 0 },
    { action: 'geocode.reverse', latitude: '0', longitude: 0 },
    { action: 'places.autocomplete', input: 'Bog', locationBias: { circle: { center: { latitude: 0, longitude: 0 }, radius: -1 } } },
  ];
  for (const body of invalidBodies) {
    const f = fixture();
    const response = await f.handler(f.request(body));
    assert.equal(response.status, 400, body.action);
    assert.equal(f.calls.length, 1, 'only Auth should be called');
  }
});

test('Places fixes URL, Spanish language, result count, API key and field mask on server', async () => {
  const f = fixture();
  assert.equal((await f.handler(f.request({ action: 'places.search', textQuery: ' Bogotá ', limit: 1 }))).status, 200);
  const call = paidCalls(f.calls)[0];
  assert.equal(call.url, 'https://places.googleapis.com/v1/places:searchText');
  assert.deepEqual(JSON.parse(call.init.body), { textQuery: 'Bogotá', pageSize: 1, languageCode: 'es' });
  assert.equal(call.init.headers['X-Goog-Api-Key'], serverSecrets.GOOGLE_MAPS_API_KEY);
  assert.ok(call.init.headers['X-Goog-FieldMask'].includes('places.formattedAddress'));
  assert.equal(call.init.redirect, 'error');
});

test('Autocomplete caps excessive radius and accepts zero coordinates; reverse geocoding does too', async () => {
  const f = fixture();
  const body = { action: 'places.autocomplete', input: 'Bog', locationBias: { circle: { center: { latitude: 0, longitude: 0 }, radius: 200000 } } };
  assert.equal((await f.handler(f.request(body))).status, 200);
  assert.equal(JSON.parse(paidCalls(f.calls)[0].init.body).locationBias.circle.radius, 50000);
  assert.equal((await f.handler(f.request({ action: 'geocode.reverse', latitude: 0, longitude: 0 }))).status, 200);
  const url = new URL(paidCalls(f.calls)[1].url);
  assert.equal(url.searchParams.get('latlng'), '0,0');
});

test('provider errors are sanitized, including a key in error bodies, URL or network exception', async () => {
  for (const provider of [
    () => Response.json({ error: { message: `secret ${serverSecrets.OPENAI_API_KEY}` } }, { status: 401 }),
    () => { throw new Error(`url?key=${serverSecrets.GOOGLE_MAPS_API_KEY}`); },
    () => Response.json({ status: 'REQUEST_DENIED', error_message: serverSecrets.GOOGLE_MAPS_API_KEY }),
  ]) {
    const f = fixture({ provider });
    const response = await f.handler(f.request({ action: 'geocode.address', address: 'Bogotá' }));
    assert.equal(response.status, 502);
    const output = await response.text();
    for (const value of Object.values(serverSecrets)) assert.equal(output.includes(value), false);
    assert.ok(response.headers.get('X-Request-Id'));
  }
});

const completion = (result, finish_reason = 'stop') => Response.json({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason }] });
test('AI uses fixed model and JSON data separated from system instructions; no provider storage', async () => {
  const text = 'Caminé con Ana en Bogotá.';
  const f = fixture({ provider: () => completion({ fragments: [text] }) });
  const response = await f.handler(f.request({ action: 'ai.segment', text }));
  assert.deepEqual(await response.json(), { fragments: [text] });
  const body = JSON.parse(paidCalls(f.calls)[0].init.body);
  assert.equal(body.model, 'gpt-4o-mini');
  assert.equal(body.store, false);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.messages[0].role, 'system');
  assert.deepEqual(JSON.parse(body.messages[1].content), { memory: text });
});

test('AI rejects fabricated/reordered/truncated segments instead of silently processing a fallback', async () => {
  for (const [result, finish] of [
    [{ fragments: ['Texto inventado'] }, 'stop'],
    [{ fragments: ['Antes', 'des'] }, 'stop'],
    [{ fragments: ['después', 'Antes'] }, 'stop'],
    [{ fragments: [] }, 'stop'],
    [{ fragments: ['Antes y después'] }, 'length'],
  ]) {
    const f = fixture({ provider: () => completion(result, finish) });
    const response = await f.handler(f.request({ action: 'ai.segment', text: 'Antes y después' }));
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, 'INVALID_PROVIDER_OUTPUT');
  }
});

test('segmentation covers the original memory, allowing only explicitly permitted connectors', async () => {
  const fragments = ['Fui al parque.', 'Entré al museo.'];
  const f = fixture({ provider: () => completion({ fragments }) });
  const response = await f.handler(f.request({ action: 'ai.segment', text: 'Fui al parque. Después de eso, Entré al museo.' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { fragments });
  const omitted = fixture({ provider: () => completion({ fragments }) });
  assert.equal((await omitted.handler(omitted.request({ action: 'ai.segment', text: 'Fui al parque. Conversé con Ana. Entré al museo.' }))).status, 502);
});

test('extraction validates shape and strips unexpected fields', async () => {
  const categorization = { title: 'Una visita con Ana', time_markers: [], ambiguities: [], entities: [{ name: 'Ana', type: 'PERSON', unexpected: 'ignored' }] };
  const f = fixture({ provider: () => completion({ ...categorization, arbitrary: 'ignored' }) });
  const response = await f.handler(f.request({ action: 'ai.extract', text: 'Visité a Ana.' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ...categorization, entities: [{ name: 'Ana', type: 'PERSON' }] });
  for (const type of ['INVALID', ['PERSON'], null]) {
    const malformed = fixture({ provider: () => completion({ ...categorization, entities: [{ name: 'Ana', type }] }) });
    assert.equal((await malformed.handler(malformed.request({ action: 'ai.extract', text: 'Ana.' }))).status, 502);
  }
});

test('multipart preserves file bytes, extension, MIME and fixed transcription model without user metadata', async () => {
  const f = fixture({ provider: (_url, init) => {
    assert.ok(init.body instanceof FormData);
    assert.equal(init.headers['Content-Type'], undefined);
    assert.equal(init.body.get('model'), 'whisper-1');
    assert.equal(init.body.get('file').name, 'recording.m4a');
    assert.equal(init.body.get('file').type, 'audio/m4a');
    assert.equal(init.body.get('file').size, 3);
    return Response.json({ text: 'Transcripción de prueba', extra: 'ignored' });
  } });
  const form = new FormData();
  form.append('action', 'audio.transcribe');
  form.append('file', new File(['abc'], 'private-local-name.m4a', { type: 'audio/m4a' }));
  const response = await f.handler(new Request('https://FICTITIOUS.invalid', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }));
  assert.deepEqual(await response.json(), { text: 'Transcripción de prueba' });
  assert.equal(paidCalls(f.calls).length, 1);
  assert.equal(JSON.parse(f.calls[1].init.body).p_bucket, 'audio');
});

test('multipart rejects missing, duplicate, empty, oversized, non-audio and arbitrary fields before provider', async () => {
  for (const kind of ['missing', 'duplicate', 'empty', 'oversized', 'html', 'model']) {
    const f = fixture();
    const form = new FormData();
    form.append('action', 'audio.transcribe');
    if (kind !== 'missing') form.append('file', new File([kind === 'oversized' ? new Uint8Array(MAX_AUDIO_BYTES + 1) : kind === 'empty' ? '' : 'abc'],
      kind === 'html' ? 'recording.html' : 'recording.webm', { type: kind === 'html' ? 'text/html' : 'audio/webm' }));
    if (kind === 'duplicate') form.append('file', new File(['abc'], 'recording.webm', { type: 'audio/webm' }));
    if (kind === 'model') form.append('model', 'arbitrary-model');
    const response = await f.handler(new Request('https://FICTITIOUS.invalid', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }));
    assert.equal(response.status, 400, kind);
    assert.equal(paidCalls(f.calls).length, 0);
    assert.equal(f.calls.length, 1);
  }
});

test('body size bounds apply without Content-Length; unsupported content and malformed JSON are rejected', async () => {
  for (const [body, type, status] of [
    ['x'.repeat(128 * 1024 + 1), 'application/json', 413],
    ['not-json', 'application/json', 400],
    ['{}', 'text/html', 415],
  ]) {
    const f = fixture();
    const response = await f.handler(new Request('https://FICTITIOUS.invalid', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': type }, body }));
    assert.equal(response.status, status);
    assert.equal(paidCalls(f.calls).length, 0);
  }
});

test('CORS permits local web preflight, denies unknown web origins and allows native requests', async () => {
  const f = fixture();
  const response = await f.handler(new Request('https://FICTITIOUS.invalid', { method: 'OPTIONS', headers: { Origin: 'http://localhost:8081' } }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8081');
  assert.equal(f.calls.length, 0);
  const denied = await f.handler(f.request({ action: 'status' }, { Origin: 'https://attacker.invalid' }));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await f.handler(f.request({ action: 'status' }))).status, 200);
});

test('backend emotion instructions come from the same indexed taxonomy as the app', () => {
  assert.ok(ALL_EMOTION_NAMES.length > 0);
  for (const emotion of ALL_EMOTION_NAMES) {
    // A few names appear under more than one branch. Keep the original
    // indexOf mapping instead of reindexing memories already saved locally.
    assert.ok(EXTRACT_PROMPT.includes(`${ALL_EMOTION_NAMES.indexOf(emotion)}:${emotion}`));
  }
});
