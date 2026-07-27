export interface PersonMetadata {
  nickname?: string;
  relationship?: string;
  avatar_url?: string;
  username?: string;
  user_id?: string | null;
  is_linked?: boolean;
  connection_status?: string | null;
  birth_decade?: string;
  partner_id?: string;
  partner_ids?: string[];
  [key: string]: unknown;
}

export interface PersonRecord {
  id: string;
  name: string;
  metadata: string | null;
  father_id: string | null;
  mother_id: string | null;
  birth_date: string | null;
  mentions: number;
}

export type RelationshipKind =
  | 'father'
  | 'mother'
  | 'partner'
  | 'sibling'
  | 'child_as_father'
  | 'child_as_mother';

export interface RelationshipSnapshot {
  focus: PersonRecord;
  father: PersonRecord | null;
  mother: PersonRecord | null;
  partners: PersonRecord[];
  children: PersonRecord[];
  siblings: PersonRecord[];
}

export function parsePersonMetadata(
  metadata: PersonRecord['metadata'] | PersonMetadata | undefined,
): PersonMetadata {
  if (!metadata) return {};
  if (typeof metadata !== 'string') return metadata;

  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getExplicitPartnerIds(person: PersonRecord): string[] {
  const metadata = parsePersonMetadata(person.metadata);
  const ids = new Set<string>();

  if (typeof metadata.partner_id === 'string' && metadata.partner_id) {
    ids.add(metadata.partner_id);
  }

  if (Array.isArray(metadata.partner_ids)) {
    metadata.partner_ids.forEach((id) => {
      if (typeof id === 'string' && id) ids.add(id);
    });
  }

  ids.delete(person.id);
  return [...ids];
}

export function isExplicitPartnerPair(
  first: PersonRecord,
  second: PersonRecord,
): boolean {
  return (
    getExplicitPartnerIds(first).includes(second.id) ||
    getExplicitPartnerIds(second).includes(first.id)
  );
}

function comparePeople(a: PersonRecord, b: PersonRecord): number {
  const yearA = getBirthYear(a) ?? Number.MAX_SAFE_INTEGER;
  const yearB = getBirthYear(b) ?? Number.MAX_SAFE_INTEGER;
  if (yearA !== yearB) return yearA - yearB;
  return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
}

export function buildRelationshipSnapshot(
  people: PersonRecord[],
  focusId: string | null,
): RelationshipSnapshot | null {
  if (!focusId) return null;

  const peopleById = new Map(people.map((person) => [person.id, person]));
  const focus = peopleById.get(focusId);
  if (!focus) return null;

  const partnerIds = new Set(getExplicitPartnerIds(focus));
  const children = people.filter(
    (person) => person.father_id === focus.id || person.mother_id === focus.id,
  );

  children.forEach((child) => {
    const otherParentId =
      child.father_id === focus.id ? child.mother_id : child.father_id;
    if (otherParentId) partnerIds.add(otherParentId);
  });

  people.forEach((person) => {
    if (getExplicitPartnerIds(person).includes(focus.id)) {
      partnerIds.add(person.id);
    }
  });

  const hasSharedParent = (person: PersonRecord) =>
    person.id !== focus.id &&
    ((focus.father_id && person.father_id === focus.father_id) ||
      (focus.mother_id && person.mother_id === focus.mother_id));

  return {
    focus,
    father: focus.father_id ? peopleById.get(focus.father_id) ?? null : null,
    mother: focus.mother_id ? peopleById.get(focus.mother_id) ?? null : null,
    partners: [...partnerIds]
      .map((id) => peopleById.get(id))
      .filter((person): person is PersonRecord => Boolean(person))
      .sort(comparePeople),
    children: [...children].sort(comparePeople),
    siblings: people.filter(hasSharedParent).sort(comparePeople),
  };
}

export function getBirthYear(person: PersonRecord): number | null {
  const raw = person.birth_date?.trim();
  if (raw) {
    const match = raw.match(/\d{4}/);
    if (match) {
      const year = Number(match[0]);
      if (year >= 1000 && year <= 9999) return year;
    }
  }

  const decade = parsePersonMetadata(person.metadata).birth_decade;
  if (typeof decade === 'string') {
    const match = decade.match(/\d{4}/);
    if (match) return Number(match[0]);
  }

  return null;
}

export function getBirthLabel(person: PersonRecord): string {
  const year = getBirthYear(person);
  if (year) return String(year);

  const decade = parsePersonMetadata(person.metadata).birth_decade;
  return typeof decade === 'string' && decade ? decade : 'Año pendiente';
}

export function getPersonSubtitle(person: PersonRecord): string {
  const metadata = parsePersonMetadata(person.metadata);
  if (typeof metadata.nickname === 'string' && metadata.nickname.trim()) {
    return metadata.nickname.split(',')[0].trim();
  }
  if (typeof metadata.relationship === 'string' && metadata.relationship.trim()) {
    return metadata.relationship.trim();
  }
  return 'Persona';
}

export function getAvatarUri(person: PersonRecord): string {
  const avatar = parsePersonMetadata(person.metadata).avatar_url;
  if (typeof avatar === 'string' && avatar.trim()) return avatar;
  return `https://api.dicebear.com/7.x/initials/png?seed=${encodeURIComponent(person.name)}`;
}

export function getPartnerMetadata(
  person: PersonRecord,
  partnerIds: string[],
): PersonMetadata {
  const metadata = parsePersonMetadata(person.metadata);
  const uniqueIds = [...new Set(partnerIds)].filter(
    (id) => id && id !== person.id,
  );

  return {
    ...metadata,
    partner_ids: uniqueIds,
    partner_id: uniqueIds[0],
  };
}

export function wouldCreateParentCycle(
  people: PersonRecord[],
  childId: string,
  proposedParentId: string,
): boolean {
  if (childId === proposedParentId) return true;

  const queue = [childId];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const children = people.filter(
      (person) =>
        person.father_id === currentId || person.mother_id === currentId,
    );

    for (const child of children) {
      if (child.id === proposedParentId) return true;
      queue.push(child.id);
    }
  }

  return false;
}

export function normalizeBirthYear(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!/^\d{4}$/.test(trimmed)) return null;

  const year = Number(trimmed);
  const nextYear = new Date().getFullYear() + 1;
  return year >= 1000 && year <= nextYear ? trimmed : null;
}

export function matchesPersonSearch(
  person: PersonRecord,
  query: string,
): boolean {
  const normalized = query.trim().toLocaleLowerCase('es');
  if (!normalized) return true;

  const metadata = parsePersonMetadata(person.metadata);
  const searchable = [
    person.name,
    metadata.nickname,
    metadata.relationship,
    metadata.username,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase('es');

  return searchable.includes(normalized);
}
