import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
let strict = false;
let environment = 'development';
const allowedEnvironments = new Set(['development', 'production', 'test']);
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--strict') {
    strict = true;
  } else if (args[index] === '--environment') {
    const selected = args[index + 1];
    if (!allowedEnvironments.has(selected)) {
      console.error('Entorno inválido. Usa --environment development, production o test.');
      process.exit(2);
    }
    environment = selected;
    index += 1;
  } else {
    console.error('Opción inválida. Usa --strict y/o --environment development, production o test.');
    process.exit(2);
  }
}

// Match Expo dotenv precedence without changing NODE_ENV or running Expo.
const envFiles = [
  '.env',
  `.env.${environment}`,
  ...(environment === 'test' ? [] : ['.env.local']),
  `.env.${environment}.local`,
];
const variables = new Map();

// Values are inspected only in memory. Never print values or the original file lines.
for (const filename of envFiles) {
  let source;
  try {
    source = readFileSync(resolve(projectRoot, filename), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    console.error(`No se pudo comprobar ${filename}.`);
    process.exit(strict ? 1 : 0);
  }

  for (const line of source.split(/\r?\n/)) {
    const assignment = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!assignment) continue;
    const [, name, rawValue] = assignment;
    const value = rawValue.replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
    if (value) variables.set(name, value);
    else variables.delete(name);
  }
}

// Already-exported shell variables take precedence over dotenv files in Expo.
for (const [name, value] of Object.entries(process.env)) {
  if (value) variables.set(name, value);
  else variables.delete(name);
}

const publicAllowlist = new Set([
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
]);

function isPrivateValue(value) {
  if (/^(?:sk-|sb_secret_)/i.test(value)) return true;
  const jwtParts = value.split('.');
  if (jwtParts.length !== 3) return false;
  try {
    const claims = JSON.parse(Buffer.from(jwtParts[1], 'base64url').toString('utf8'));
    return claims.role === 'service_role';
  } catch {
    return false;
  }
}

const unsafePublicVariables = [];
for (const [name, value] of variables) {
  if (!name.startsWith('EXPO_PUBLIC_')) continue;
  const privateName = /(?:OPENAI.*(?:KEY|TOKEN)|SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|ACCESS_TOKEN)/i.test(name);
  // This app uses this key for Places/Geocoding REST requests, not the native maps SDK.
  const googleRestKey = /^EXPO_PUBLIC_GOOGLE_(?:MAPS|PLACES|GEOCODING)(?:_API)?_KEY$/.test(name);
  if (isPrivateValue(value) || googleRestKey || (!publicAllowlist.has(name) && privateName)) {
    unsafePublicVariables.push(name);
  }
}

console.log('Comprobación local de configuración (sin mostrar valores).');
console.log(`Entorno comprobado: ${environment}.`);
console.log('Metro sirve y actualiza la app: no es un backend ni protege claves privadas.');
console.log('Toda variable EXPO_PUBLIC_ puede extraerse del bundle del teléfono.');

if (unsafePublicVariables.length) {
  console.error('Se detectaron secretos configurados como públicos:');
  for (const name of unsafePublicVariables.sort()) console.error(`- ${name}`);
  console.error('Retíralos del entorno de Expo y úsalos en un backend; no los copies al chat ni al repositorio.');
  console.error('Si un secreto ya se distribuyó en una app o bundle, rótalo en el proveedor.');
  if (strict) process.exitCode = 1;
  else console.log('Modo informativo: el desarrollo local sigue disponible. Usa --strict para CI o distribución.');
} else {
  console.log('No se detectaron secretos evidentes bajo EXPO_PUBLIC_. Esta comprobación no sustituye una auditoría.');
}

if ([...variables.keys()].some(name => /^EXPO_PUBLIC_GOOGLE_(?:MAPS|PLACES|GEOCODING)(?:_API)?_KEY$/.test(name))) {
  console.log('Google Places/Geocoding REST debe usar una clave del backend. No es una clave SDK nativa publicable.');
  console.log('Las claves para SDK Maps nativo son distintas: restringirlas por aplicación/plataforma y API.');
}
if (variables.has('EXPO_PUBLIC_SUPABASE_ANON_KEY') || variables.has('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY')) {
  console.log('Supabase: la clave pública requiere políticas RLS; nunca uses una clave service_role en la app.');
}
