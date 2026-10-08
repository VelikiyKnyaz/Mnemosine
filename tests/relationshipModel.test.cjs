const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

// Exercise the actual pure model without adding a test framework or changing
// Expo's module resolution. The independent typecheck validates TypeScript.
const sourcePath = path.resolve(__dirname, '../src/features/familyTree/relationshipModel.ts');
const { outputText } = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
  fileName: sourcePath,
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
});
const compiledModule = { exports: {} };
new Function('module', 'exports', outputText)(compiledModule, compiledModule.exports);
const {
  buildRelationshipSnapshot,
  getAvatarUri,
  getBirthLabel,
  getBirthYear,
  getExplicitPartnerIds,
  getPartnerMetadata,
  getPersonSubtitle,
  isExplicitPartnerPair,
  matchesPersonSearch,
  normalizeBirthYear,
  parsePersonMetadata,
  wouldCreateParentCycle,
} = compiledModule.exports;

function person(id, fields = {}) {
  return {
    id,
    name: id,
    metadata: null,
    father_id: null,
    mother_id: null,
    birth_date: null,
    mentions: 0,
    ...fields,
  };
}

const ids = (people) => people.map(({ id }) => id);

test('an absent or unknown focus yields no relational snapshot', () => {
  const people = [person('ana')];
  assert.equal(buildRelationshipSnapshot(people, null), null);
  assert.equal(buildRelationshipSnapshot(people, 'unknown'), null);
  assert.equal(buildRelationshipSnapshot([], 'ana'), null);
});

test('the snapshot includes only direct parents, children and shared-parent siblings', () => {
  const people = [
    person('father'),
    person('mother'),
    person('focus', { father_id: 'father', mother_id: 'mother' }),
    person('sibling', { father_id: 'father', mother_id: 'mother' }),
    person('half-sibling', { mother_id: 'mother' }),
    person('partner'),
    person('child', { father_id: 'focus', mother_id: 'partner' }),
    person('grandchild', { father_id: 'child' }),
    person('unrelated'),
  ];
  const snapshot = buildRelationshipSnapshot(people, 'focus');
  assert.equal(snapshot.focus.id, 'focus');
  assert.equal(snapshot.father.id, 'father');
  assert.equal(snapshot.mother.id, 'mother');
  assert.deepEqual(ids(snapshot.children), ['child']);
  assert.deepEqual(ids(snapshot.siblings), ['half-sibling', 'sibling']);
  assert.deepEqual(ids(snapshot.partners), ['partner']);
});

test('missing parent and partner records do not create phantom people', () => {
  const focus = person('focus', {
    father_id: 'missing-father',
    mother_id: 'missing-mother',
    metadata: JSON.stringify({ partner_ids: ['missing-partner'] }),
  });
  const snapshot = buildRelationshipSnapshot([focus], 'focus');
  assert.equal(snapshot.father, null);
  assert.equal(snapshot.mother, null);
  assert.deepEqual(snapshot.partners, []);
  assert.deepEqual(snapshot.siblings, []);
});

test('partner metadata removes duplicates, empty ids, invalid values and self-links', () => {
  const focus = person('focus', {
    metadata: JSON.stringify({
      partner_id: 'partner',
      partner_ids: ['partner', 'focus', '', 42, null, 'other'],
    }),
  });
  assert.deepEqual(getExplicitPartnerIds(focus), ['partner', 'other']);
});

test('one-sided partner declarations are recognized symmetrically', () => {
  const first = person('first');
  const second = person('second', {
    metadata: JSON.stringify({ partner_id: 'first' }),
  });
  assert.equal(isExplicitPartnerPair(first, second), true);
  assert.equal(isExplicitPartnerPair(second, first), true);
  assert.deepEqual(ids(buildRelationshipSnapshot([first, second], 'first').partners), ['second']);
  assert.deepEqual(ids(buildRelationshipSnapshot([first, second], 'second').partners), ['first']);
  assert.equal(isExplicitPartnerPair(first, person('unrelated')), false);
});

test('explicit links and co-parenting merge into one partner without inferring unrelated partners', () => {
  const people = [
    person('focus', { metadata: JSON.stringify({ partner_id: 'partner', partner_ids: ['partner'] }) }),
    person('partner', { metadata: JSON.stringify({ partner_id: 'focus' }) }),
    person('child-one', { father_id: 'focus', mother_id: 'partner' }),
    person('child-two', { father_id: 'focus', mother_id: 'partner' }),
    person('other'),
    person('others-child', { father_id: 'partner', mother_id: 'other' }),
  ];
  const snapshot = buildRelationshipSnapshot(people, 'focus');
  assert.deepEqual(ids(snapshot.partners), ['partner']);
  assert.deepEqual(ids(snapshot.children), ['child-one', 'child-two']);
});

test('building and editing metadata leave the supplied records untouched', () => {
  const focus = person('focus', {
    metadata: JSON.stringify({ nickname: 'Ana', custom: 'keep', partner_id: 'old' }),
  });
  const people = [focus, person('old')];
  const original = JSON.stringify(people);
  buildRelationshipSnapshot(people, 'focus');
  const edited = getPartnerMetadata(focus, ['new', 'new', 'focus', '']);
  assert.deepEqual(edited.partner_ids, ['new']);
  assert.equal(edited.partner_id, 'new');
  assert.equal(edited.nickname, 'Ana');
  assert.equal(edited.custom, 'keep');
  assert.equal(JSON.stringify(people), original);
  const removed = getPartnerMetadata(focus, []);
  assert.deepEqual(removed.partner_ids, []);
  assert.equal(removed.partner_id, undefined);
});

test('parent assignment rejects self-parenting and all descendant cycles, through either parent', () => {
  const people = [
    person('ancestor'),
    person('child', { father_id: 'ancestor' }),
    person('grandchild', { mother_id: 'child' }),
    person('unrelated'),
  ];
  assert.equal(wouldCreateParentCycle(people, 'ancestor', 'ancestor'), true);
  assert.equal(wouldCreateParentCycle(people, 'ancestor', 'child'), true);
  assert.equal(wouldCreateParentCycle(people, 'ancestor', 'grandchild'), true);
  assert.equal(wouldCreateParentCycle(people, 'grandchild', 'ancestor'), false);
  assert.equal(wouldCreateParentCycle(people, 'ancestor', 'unrelated'), false);
});

test('cycle detection terminates even when older records already contain a cycle', () => {
  const people = [
    person('one', { father_id: 'two' }),
    person('two', { mother_id: 'one' }),
    person('unrelated'),
  ];
  assert.equal(wouldCreateParentCycle(people, 'one', 'two'), true);
  assert.equal(wouldCreateParentCycle(people, 'one', 'unrelated'), false);
});

test('relatives sort by birth year, then name, with unknown years last', () => {
  const people = [
    person('focus'),
    person('unknown', { name: 'Primero', father_id: 'focus' }),
    person('b', { name: 'Beatriz', father_id: 'focus', birth_date: '1990-01-01' }),
    person('a', { name: 'Ana', father_id: 'focus', birth_date: '1990' }),
    person('older', { father_id: 'focus', metadata: JSON.stringify({ birth_decade: 'Década de 1980' }) }),
  ];
  assert.deepEqual(ids(buildRelationshipSnapshot(people, 'focus').children), ['older', 'a', 'b', 'unknown']);
});

test('invalid JSON and primitive metadata safely fall back to empty metadata', () => {
  for (const value of [null, undefined, '', '{broken', 'null', '42', '"nickname"']) {
    assert.deepEqual(parsePersonMetadata(value), {});
  }
  assert.deepEqual(parsePersonMetadata('{"nickname":"Ana"}'), { nickname: 'Ana' });
  const metadata = { nickname: 'Ana' };
  assert.equal(parsePersonMetadata(metadata), metadata);
});

test('person subtitles use the first nickname, then relationship, then a neutral label', () => {
  assert.equal(getPersonSubtitle(person('ana', { metadata: JSON.stringify({ nickname: '  Anita, Ana ', relationship: 'Madre' }) })), 'Anita');
  assert.equal(getPersonSubtitle(person('ana', { metadata: JSON.stringify({ nickname: ' ', relationship: ' Madre ' }) })), 'Madre');
  assert.equal(getPersonSubtitle(person('ana')), 'Persona');
});

test('name searches are case-insensitive and include aliases, relationship and username', () => {
  const record = person('id', {
    name: 'María Pérez',
    metadata: JSON.stringify({ nickname: 'Lola', relationship: 'Abuela', username: 'mariap' }),
  });
  for (const query of [' MARÍA ', 'pÉrEz', 'lola', 'ABUELA', 'mariap', '  ']) {
    assert.equal(matchesPersonSearch(record, query), true, query);
  }
  assert.equal(matchesPersonSearch(record, 'desconocido'), false);
});

test('birth years accept a year or full date and fall back to a known decade', () => {
  assert.equal(getBirthYear(person('a', { birth_date: '1975-05-12' })), 1975);
  assert.equal(getBirthYear(person('a', { birth_date: ' 1975 ' })), 1975);
  assert.equal(getBirthYear(person('a', { birth_date: 'invalid', metadata: JSON.stringify({ birth_decade: 'Década de 1960' }) })), 1960);
  assert.equal(getBirthYear(person('a')), null);
  assert.equal(getBirthLabel(person('a')), 'Año pendiente');
});

test('birth year input rejects incomplete and implausible years without depending on a fixed current year', () => {
  const nextYear = new Date().getFullYear() + 1;
  assert.equal(normalizeBirthYear(' 1985 '), '1985');
  assert.equal(normalizeBirthYear(' '), '');
  assert.equal(normalizeBirthYear('198'), null);
  assert.equal(normalizeBirthYear('1985-05-12'), null);
  assert.equal(normalizeBirthYear('0999'), null);
  assert.equal(normalizeBirthYear(String(nextYear)), String(nextYear));
  assert.equal(normalizeBirthYear(String(nextYear + 1)), null);
});

test('avatar fallback correctly escapes names and retains an explicit avatar', () => {
  const record = person('id', { name: 'María & Ana' });
  const uri = new URL(getAvatarUri(record));
  assert.equal(uri.searchParams.get('seed'), record.name);
  assert.equal(getAvatarUri(person('id', { metadata: JSON.stringify({ avatar_url: 'https://example.com/avatar.png' }) })), 'https://example.com/avatar.png');
});
