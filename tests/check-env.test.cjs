const assert = require('node:assert/strict');
const { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

// Every fixture uses invented values in its own temporary directory. The real
// project's .env files and the parent process's API variables are never loaded.
function fixture(t, files) {
  const temporaryRoot = path.resolve(tmpdir());
  const directory = mkdtempSync(path.join(temporaryRoot, 'mnemosine-check-env-'));
  const relativeTarget = path.relative(temporaryRoot, directory);
  assert.ok(relativeTarget && !relativeTarget.startsWith('..') && !path.isAbsolute(relativeTarget));
  assert.ok(path.basename(directory).startsWith('mnemosine-check-env-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, 'scripts'));
  copyFileSync(path.resolve(__dirname, '../scripts/check-env.mjs'), path.join(directory, 'scripts/check-env.mjs'));
  for (const [filename, contents] of Object.entries(files)) {
    assert.match(filename, /^\.env(?:\.[a-z]+)*$/);
    writeFileSync(path.join(directory, filename), contents);
  }
  return directory;
}

function check(directory, args = [], extraEnvironment = {}) {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('EXPO_PUBLIC_') && name !== 'NODE_ENV'),
  );
  const result = spawnSync(process.execPath, ['scripts/check-env.mjs', ...args], {
    cwd: directory,
    env: { ...environment, ...extraEnvironment },
    encoding: 'utf8',
  });
  assert.equal(result.error, undefined);
  return { status: result.status, output: result.stdout + result.stderr };
}

function neverPrintsValues(output, values) {
  for (const value of values) assert.equal(output.includes(value), false, 'A fixture value must not appear in output');
}

test('explicit production checks production files instead of development files', (t) => {
  const developmentKey = 'FICTITIOUS-development-google-rest-key';
  const productionKey = 'sk-FICTITIOUS-production-openai-key';
  const directory = fixture(t, {
    '.env.development': `EXPO_PUBLIC_GOOGLE_MAPS_KEY=${developmentKey}\n`,
    '.env.production': `EXPO_PUBLIC_OPENAI_API_KEY=${productionKey}\n`,
  });
  const result = check(directory, ['--strict', '--environment', 'production']);
  assert.equal(result.status, 1);
  assert.match(result.output, /Entorno comprobado: production\./);
  assert.match(result.output, /- EXPO_PUBLIC_OPENAI_API_KEY/);
  assert.doesNotMatch(result.output, /- EXPO_PUBLIC_GOOGLE_MAPS_KEY/);
  neverPrintsValues(result.output, [developmentKey, productionKey]);
});

test('development remains the default even if NODE_ENV is production', (t) => {
  const directory = fixture(t, {
    '.env.development': 'EXPO_PUBLIC_SUPABASE_URL=https://FICTITIOUS-development.invalid\n',
    '.env.production': 'EXPO_PUBLIC_OPENAI_API_KEY=sk-FICTITIOUS-production-secret\n',
  });
  const result = check(directory, ['--strict'], { NODE_ENV: 'production' });
  assert.equal(result.status, 0);
  assert.match(result.output, /Entorno comprobado: development\./);
  assert.doesNotMatch(result.output, /- EXPO_PUBLIC_OPENAI_API_KEY/);
  neverPrintsValues(result.output, ['https://FICTITIOUS-development.invalid', 'sk-FICTITIOUS-production-secret']);
});

test('production local files have precedence and shell variables override dotenv, including empty values', (t) => {
  const fileKey = 'FICTITIOUS-public-anon-key';
  const localKey = 'sb_secret_FICTITIOUS-local-key';
  const shellKey = 'FICTITIOUS-shell-public-key';
  const directory = fixture(t, {
    '.env': `EXPO_PUBLIC_SUPABASE_ANON_KEY=${fileKey}\n`,
    '.env.production': 'EXPO_PUBLIC_SUPABASE_ANON_KEY=FICTITIOUS-production-key\n',
    '.env.local': 'EXPO_PUBLIC_SUPABASE_ANON_KEY=FICTITIOUS-local-public-key\n',
    '.env.production.local': `EXPO_PUBLIC_SUPABASE_ANON_KEY=${localKey}\nEXPO_PUBLIC_OPENAI_API_KEY=sk-FICTITIOUS-file-secret\n`,
  });
  const first = check(directory, ['--strict', '--environment', 'production']);
  assert.equal(first.status, 1);
  assert.match(first.output, /- EXPO_PUBLIC_SUPABASE_ANON_KEY/);
  const overridden = check(directory, ['--strict', '--environment', 'production'], {
    EXPO_PUBLIC_SUPABASE_ANON_KEY: shellKey,
    EXPO_PUBLIC_OPENAI_API_KEY: '',
  });
  assert.equal(overridden.status, 0);
  assert.doesNotMatch(overridden.output, /- EXPO_PUBLIC_SUPABASE_ANON_KEY|EXPO_PUBLIC_OPENAI_API_KEY/);
  neverPrintsValues(first.output + overridden.output, [fileKey, localKey, shellKey, 'sk-FICTITIOUS-file-secret']);
});

test('test environment omits .env.local but loads .env.test and .env.test.local', (t) => {
  const directory = fixture(t, {
    '.env.local': 'EXPO_PUBLIC_OPENAI_API_KEY=sk-FICTITIOUS-ignored-local-secret\n',
    '.env.test': 'EXPO_PUBLIC_GOOGLE_MAPS_KEY=FICTITIOUS-test-google-key\n',
    '.env.test.local': 'EXPO_PUBLIC_GOOGLE_MAPS_KEY=FICTITIOUS-test-local-google-key\n',
  });
  const result = check(directory, ['--strict', '--environment', 'test']);
  assert.equal(result.status, 1);
  assert.match(result.output, /Entorno comprobado: test\./);
  assert.match(result.output, /- EXPO_PUBLIC_GOOGLE_MAPS_KEY/);
  assert.doesNotMatch(result.output, /- EXPO_PUBLIC_OPENAI_API_KEY/);
  neverPrintsValues(result.output, ['sk-FICTITIOUS-ignored-local-secret', 'FICTITIOUS-test-google-key', 'FICTITIOUS-test-local-google-key']);
});

const serviceRole = `FICTITIOUS.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.FICTITIOUS`;
for (const [name, value] of [
  ['EXPO_PUBLIC_OPENAI_API_KEY', 'sk-FICTITIOUS-openai-secret'],
  ['EXPO_PUBLIC_GOOGLE_MAPS_KEY', 'FICTITIOUS-google-rest-secret'],
  ['EXPO_PUBLIC_GOOGLE_MAPS_API_KEY', 'FICTITIOUS-google-rest-secret'],
  ['EXPO_PUBLIC_GOOGLE_PLACES_API_KEY', 'FICTITIOUS-google-rest-secret'],
  ['EXPO_PUBLIC_SUPABASE_ANON_KEY', serviceRole],
]) {
  test(`detects ${name} without printing its value; strict fails and informational mode continues`, (t) => {
    const directory = fixture(t, { '.env': `${name}=${value}\n` });
    for (const strict of [false, true]) {
      const result = check(directory, strict ? ['--strict'] : []);
      assert.equal(result.status, strict ? 1 : 0);
      assert.ok(result.output.includes(`- ${name}`));
      neverPrintsValues(result.output, [value]);
    }
  });
}

test('invalid or missing environment arguments fail without echoing user input', (t) => {
  const directory = fixture(t, {});
  const invalid = 'FICTITIOUS-private-argument';
  for (const args of [['--environment', invalid], ['--environment'], ['--unknown-option']]) {
    const result = check(directory, args);
    assert.equal(result.status, 2);
    neverPrintsValues(result.output, [invalid]);
  }
});
