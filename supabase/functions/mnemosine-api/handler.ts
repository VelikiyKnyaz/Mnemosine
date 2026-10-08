import { MAX_AUDIO_BYTES, MAX_MEMORY_CHARS, type AICategorization } from '../../../shared/api.ts';
import { EXTRACT_PROMPT, SEGMENT_PROMPT } from './prompts.ts';

type JsonObject = Record<string, unknown>;
type Fetcher = typeof fetch;
export interface ApiDependencies {
  env: (name: string) => string | undefined;
  fetch?: Fetcher;
}

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const invalid = () => new ApiError(400, 'INVALID_INPUT', 'La solicitud contiene datos inválidos o excede los límites permitidos.');
const isObject = (value: unknown): value is JsonObject => !!value && typeof value === 'object' && !Array.isArray(value);
const asObject = (value: unknown): JsonObject => { if (!isObject(value)) throw invalid(); return value; };
const onlyKeys = (value: JsonObject, keys: string[]) => {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw invalid();
};
const stringValue = (value: unknown, max: number, optional = false): string => {
  if (optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) throw invalid();
  return value;
};
const coordinate = (value: unknown, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > max) throw invalid();
  return value;
};
const point = (value: unknown) => {
  const object = asObject(value);
  onlyKeys(object, ['latitude', 'longitude']);
  return { latitude: coordinate(object.latitude, 90), longitude: coordinate(object.longitude, 180) };
};

function locationBias(value: unknown): JsonObject | undefined {
  if (value === undefined) return undefined;
  const object = asObject(value);
  onlyKeys(object, ['circle', 'rectangle']);
  if (Object.keys(object).length !== 1) throw invalid();
  if (object.circle) {
    const circle = asObject(object.circle);
    onlyKeys(circle, ['center', 'radius']);
    if (typeof circle.radius !== 'number' || !Number.isFinite(circle.radius) || circle.radius <= 0) throw invalid();
    return { circle: { center: point(circle.center), radius: Math.min(50000, circle.radius) } };
  }
  const rectangle = asObject(object.rectangle);
  onlyKeys(rectangle, ['low', 'high']);
  const low = point(rectangle.low);
  const high = point(rectangle.high);
  if (low.latitude >= high.latitude) throw invalid();
  return { rectangle: { low, high } };
}

async function readBoundedBody(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 10000);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (timedOut) throw new ApiError(408, 'BODY_TIMEOUT', 'La carga tardó demasiado. Intenta de nuevo.');
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        void reader.cancel().catch(() => {});
        throw new ApiError(413, 'BODY_TOO_LARGE', 'La solicitud es demasiado grande. El audio admite hasta 10 MB.');
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function validateCategorization(value: unknown): AICategorization {
  const result = asObject(value);
  const strings = (data: unknown, max: number): string[] => {
    if (!Array.isArray(data) || data.length > max) throw new Error('Invalid provider output');
    return data.map((item) => stringValue(item, 500));
  };
  if (!Array.isArray(result.entities) || result.entities.length > 200) throw new Error('Invalid provider output');
  const types = ['PERSON', 'LOCATION', 'EVENT', 'OBJECT', 'TIME', 'EMOTION'];
  return {
    title: stringValue(result.title, 200).trim().split(/\s+/).slice(0, 5).join(' '),
    time_markers: strings(result.time_markers, 100),
    ambiguities: strings(result.ambiguities, 100),
    entities: result.entities.map((entity) => {
      const object = asObject(entity);
      if (typeof object.type !== 'string' || !types.includes(object.type)) throw new Error('Invalid provider output');
      const parent = stringValue(object.parent_name, 300, true);
      return {
        name: stringValue(object.name, 300),
        type: object.type as AICategorization['entities'][number]['type'],
        ...(parent ? { parent_name: parent } : {}),
      };
    }),
  };
}

// No arbitrary URL, model, prompt, field mask or user ID can be supplied by callers.
export function createApiHandler(dependencies: ApiDependencies) {
  const env = dependencies.env;
  const requestFetch = dependencies.fetch ?? fetch;

  function secret(name: string): string {
    const value = env(name);
    if (!value) throw new ApiError(503, 'MISSING_SECRET', 'Falta configurar un secreto del backend. Revisa Supabase Edge Functions → Secrets.');
    return value;
  }

  function supabaseKey(kind: 'public' | 'secret'): string {
    try {
      const keys = JSON.parse(env(kind === 'public' ? 'SUPABASE_PUBLISHABLE_KEYS' : 'SUPABASE_SECRET_KEYS') || '{}');
      if (typeof keys.default === 'string' && keys.default) return keys.default;
    } catch { /* fail closed */ }
    const legacy = env(kind === 'public' ? 'SUPABASE_ANON_KEY' : 'SUPABASE_SERVICE_ROLE_KEY');
    if (legacy) return legacy;
    throw new ApiError(503, 'BACKEND_CONFIG', 'La configuración interna de Supabase está incompleta.');
  }

  async function fetchJson(url: string, options: RequestInit, timeout = 15000): Promise<{ response: Response; data: JsonObject }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await requestFetch(url, { ...options, signal: controller.signal, redirect: 'error' });
      const data: unknown = await response.json();
      return { response, data: isObject(data) ? data : {} };
    } catch {
      throw new ApiError(controller.signal.aborted ? 504 : 502, 'UPSTREAM_UNAVAILABLE', 'El servicio no respondió. Tu recuerdo sigue guardado localmente; vuelve a intentarlo.');
    } finally { clearTimeout(timer); }
  }

  async function authenticate(request: Request): Promise<string> {
    const authorization = request.headers.get('Authorization') || '';
    if (!/^Bearer \S{20,8192}$/i.test(authorization)) {
      throw new ApiError(401, 'AUTH_REQUIRED', 'Inicia sesión con una cuenta real de Mnemósine. El acceso 66 es solo diagnóstico local.');
    }
    // Auth validates the actual user, not an unverified decoded JWT or a client-supplied ID.
    const { response, data } = await fetchJson(`${secret('SUPABASE_URL')}/auth/v1/user`, {
      headers: { apikey: supabaseKey('public'), Authorization: authorization },
    });
    if (!response.ok || typeof data.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.id) || data.role !== 'authenticated' || data.is_anonymous === true) {
      throw new ApiError(401, 'AUTH_REQUIRED', 'La sesión no es válida. Inicia sesión nuevamente con tu cuenta.');
    }
    return data.id;
  }

  async function quota(userId: string, bucket: string): Promise<boolean> {
    const key = supabaseKey('secret');
    const { response, data } = await fetchJson(`${secret('SUPABASE_URL')}/rest/v1/rpc/mnemosine_consume_api_quota`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', apikey: key,
        // New sb_secret_ keys are not JWTs. Legacy service_role JWTs also
        // need Authorization; neither key is ever supplied by the caller.
        ...(!key.startsWith('sb_secret_') ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({ p_user_id: userId, p_bucket: bucket }),
    });
    if (!response.ok || typeof data.allowed !== 'boolean') {
      throw new ApiError(503, 'QUOTA_NOT_READY', 'Falta instalar el control de uso del backend. Aplica la migración de Supabase antes de usar las APIs.');
    }
    return data.allowed;
  }

  async function provider(url: string, options: RequestInit, timeout?: number): Promise<JsonObject> {
    const { response, data } = await fetchJson(url, options, timeout);
    if (!response.ok) {
      // Never forward the upstream body: it may include secrets, prompts or URLs.
      throw new ApiError(response.status === 429 ? 429 : 502, 'PROVIDER_ERROR', response.status === 429
        ? 'El proveedor alcanzó su límite de uso o saldo. Revisa su facturación y cuotas.'
        : 'El proveedor rechazó la solicitud. Revisa la clave, las APIs habilitadas y la facturación del backend.');
    }
    return data;
  }

  async function completion(prompt: string, input: JsonObject, maxTokens: number): Promise<unknown> {
    const data = await provider('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret('OPENAI_API_KEY')}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: prompt }, { role: 'user', content: JSON.stringify(input) }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: maxTokens,
        store: false,
      }),
    }, 60000);
    try {
      const choices = data.choices as { message?: { content?: string }; finish_reason?: string }[];
      if (choices?.[0]?.finish_reason === 'length') throw new Error('Truncated result');
      return JSON.parse(choices[0].message!.content!);
    } catch {
      throw new ApiError(502, 'INVALID_PROVIDER_OUTPUT', 'La IA devolvió un resultado incompleto. El recuerdo queda pendiente para reintentar.');
    }
  }

  async function dispatch(body: JsonObject, userId: string): Promise<unknown> {
    const action = stringValue(body.action, 60);
    let bucket: string;
    let work: () => Promise<unknown>;

    switch (action) {
      case 'status': {
        onlyKeys(body, ['action']);
        let quotaReady = false;
        try { quotaReady = await quota(userId, 'status'); } catch { /* report only readiness, not secrets */ }
        return {
          version: 1,
          secrets: { openai: !!env('OPENAI_API_KEY'), googleMaps: !!env('GOOGLE_MAPS_API_KEY') },
          quotaReady,
          limits: { maxAudioBytes: MAX_AUDIO_BYTES, maxMemoryChars: MAX_MEMORY_CHARS },
        };
      }
      case 'ai.segment': {
        onlyKeys(body, ['action', 'text']);
        const text = stringValue(body.text, MAX_MEMORY_CHARS);
        bucket = 'ai';
        work = async () => {
          const result = asObject(await completion(SEGMENT_PROMPT, { memory: text }, 8192));
          if (!Array.isArray(result.fragments) || result.fragments.length === 0 || result.fragments.length > 20) throw new Error('Invalid fragments');
          const fragments = result.fragments.map((value) => stringValue(value, MAX_MEMORY_CHARS).trim());
          // Segmentation cannot invent/rewrite content, reorder it, duplicate
          // a fragment, or omit substantive parts of the original memory.
          let position = 0;
          for (const fragment of fragments) {
            const start = text.indexOf(fragment, position);
            if (start < 0) throw new Error('Invented fragment');
            const gap = text.slice(position, start).trim();
            if (gap && (position === 0 || !/^(?:(?:después de eso|luego|más tarde|al salir de allí)[,.;:\s]*)+$/iu.test(gap))) {
              throw new Error('Omitted memory content');
            }
            position = start + fragment.length;
          }
          if (text.slice(position).trim()) throw new Error('Omitted memory content');
          return { fragments };
        };
        break;
      }
      case 'ai.extract': {
        onlyKeys(body, ['action', 'text', 'existingEntitiesContext', 'timeContext', 'spaceContext']);
        const input = {
          memory: stringValue(body.text, MAX_MEMORY_CHARS),
          known_entities: stringValue(body.existingEntitiesContext, 8000, true),
          context_time: stringValue(body.timeContext, 2000, true),
          context_location: stringValue(body.spaceContext, 2000, true),
        };
        bucket = 'ai';
        work = async () => validateCategorization(await completion(EXTRACT_PROMPT, input, 4096));
        break;
      }
      case 'places.search': {
        onlyKeys(body, ['action', 'textQuery', 'limit']);
        const textQuery = stringValue(body.textQuery, 500).trim();
        const limit = body.limit ?? 5;
        if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 5) throw invalid();
        bucket = 'google';
        work = () => provider('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json', 'X-Goog-Api-Key': secret('GOOGLE_MAPS_API_KEY'),
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.addressComponents,places.types',
          },
          body: JSON.stringify({ textQuery, pageSize: limit, languageCode: 'es' }),
        });
        break;
      }
      case 'places.autocomplete': {
        onlyKeys(body, ['action', 'input', 'includedPrimaryTypes', 'locationBias']);
        const input = stringValue(body.input, 500).trim();
        const types = body.includedPrimaryTypes ?? [];
        const allowed = ['country', 'administrative_area_level_1', 'administrative_area_level_2', '(cities)'];
        if (!Array.isArray(types) || types.length > 2 || types.some((type) => !allowed.includes(type))) throw invalid();
        if (types.includes('(cities)') && types.length !== 1) throw invalid();
        const bias = locationBias(body.locationBias);
        bucket = 'google';
        work = () => provider('https://places.googleapis.com/v1/places:autocomplete', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': secret('GOOGLE_MAPS_API_KEY') },
          body: JSON.stringify({ input, languageCode: 'es', ...(types.length ? { includedPrimaryTypes: types } : {}), ...(bias ? { locationBias: bias } : {}) }),
        });
        break;
      }
      case 'places.details': {
        onlyKeys(body, ['action', 'placeId']);
        const id = stringValue(body.placeId, 512);
        if (!/^[A-Za-z0-9_-]+$/.test(id)) throw invalid();
        bucket = 'google';
        work = () => provider(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}?languageCode=es`, {
          headers: {
            'X-Goog-Api-Key': secret('GOOGLE_MAPS_API_KEY'),
            'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,addressComponents,types',
          },
        });
        break;
      }
      case 'geocode.address':
      case 'geocode.reverse': {
        onlyKeys(body, action === 'geocode.address' ? ['action', 'address'] : ['action', 'latitude', 'longitude']);
        const params = new URLSearchParams({ language: 'es' });
        if (action === 'geocode.address') params.set('address', stringValue(body.address, 500));
        else params.set('latlng', `${coordinate(body.latitude, 90)},${coordinate(body.longitude, 180)}`);
        bucket = 'google';
        work = async () => {
          params.set('key', secret('GOOGLE_MAPS_API_KEY'));
          const data = await provider(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, {});
          if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
            throw new ApiError(502, 'PROVIDER_ERROR', 'Google rechazó la consulta. Revisa la API Geocoding, la clave y la facturación.');
          }
          return { status: data.status, results: data.results || [] };
        };
        break;
      }
      default: throw new ApiError(400, 'UNKNOWN_ACTION', 'Esta acción no está disponible en el backend.');
    }
    if (!await quota(userId, bucket)) throw new ApiError(429, 'RATE_LIMITED', 'Se alcanzó el límite de uso de Mnemósine. Espera antes de volver a intentarlo.');
    try { return await work(); }
    catch (error) {
      if (error instanceof ApiError && error.code !== 'INVALID_INPUT') throw error;
      throw new ApiError(502, 'INVALID_PROVIDER_OUTPUT', 'El proveedor devolvió datos inválidos. La app conserva el recuerdo para reintentar.');
    }
  }

  return async (request: Request): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const origin = request.headers.get('Origin');
    const allowedOrigins = (env('MNEMOSINE_ALLOWED_ORIGINS') || 'http://localhost:8081,http://127.0.0.1:8081').split(',').map((item) => item.trim());
    const headers: Record<string, string> = {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
      'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 'X-Request-Id': requestId,
    };
    if (origin && allowedOrigins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
    try {
      if (origin && !allowedOrigins.includes(origin)) throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Este origen web no está autorizado.');
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Usa POST para invocar el backend.');
      const userId = await authenticate(request);
      const contentType = request.headers.get('Content-Type') || '';
      const multipart = contentType.toLowerCase().startsWith('multipart/form-data;');
      if (!multipart && !/^application\/json(?:;|$)/i.test(contentType)) throw new ApiError(415, 'UNSUPPORTED_MEDIA', 'Usa JSON o un archivo de audio multipart.');
      const limit = multipart ? MAX_AUDIO_BYTES + 65536 : 128 * 1024;
      if (Number(request.headers.get('Content-Length')) > limit) throw new ApiError(413, 'BODY_TOO_LARGE', 'La solicitud excede el tamaño permitido.');
      const bytes = await readBoundedBody(request.body, limit);
      if (multipart) {
        let form: FormData;
        try { form = await new Response(bytes, { headers: { 'Content-Type': contentType } }).formData(); } catch { throw invalid(); }
        if (Array.from(form.keys()).some((key) => !['file', 'action'].includes(key)) || form.get('action') !== 'audio.transcribe' || form.getAll('file').length !== 1 || form.getAll('action').length !== 1) throw invalid();
        const file = form.get('file');
        if (!(file instanceof File) || !file.size || file.size > MAX_AUDIO_BYTES || !/\.(m4a|mp4|mp3|wav|webm|ogg|flac|mpeg|mpga)$/i.test(file.name)) throw invalid();
        if (!/^(audio\/(?:m4a|x-m4a|mp4|mpeg|mp3|wav|x-wav|webm|ogg|flac)|video\/(?:mp4|webm)|application\/octet-stream)$/i.test(file.type)) throw invalid();
        if (!await quota(userId, 'audio')) throw new ApiError(429, 'RATE_LIMITED', 'Se alcanzó el límite de transcripciones. Espera para volver a intentarlo.');
        const upstream = new FormData();
        upstream.append('file', file, `recording.${file.name.split('.').pop()!.toLowerCase()}`);
        upstream.append('model', 'whisper-1');
        const data = await provider('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST', headers: { Authorization: `Bearer ${secret('OPENAI_API_KEY')}` }, body: upstream,
        }, 90000);
        if (typeof data.text !== 'string' || !data.text.trim()) throw new ApiError(502, 'EMPTY_TRANSCRIPTION', 'No se obtuvo una transcripción. El audio permanece guardado.');
        return json({ text: data.text });
      }
      let body: JsonObject;
      try { body = asObject(JSON.parse(new TextDecoder().decode(bytes))); } catch { throw invalid(); }
      return json(await dispatch(body, userId));
    } catch (error) {
      const safe = error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR', 'No se pudo completar la solicitud. Vuelve a intentarlo.');
      // Deliberately no logs of request bodies, tokens, URLs, audio or provider errors.
      return json({ error: { code: safe.code, message: safe.message }, requestId }, safe.status);
    }
  };
}
