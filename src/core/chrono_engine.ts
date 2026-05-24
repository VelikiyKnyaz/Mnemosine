import { getDb } from './database';

interface UserProfile {
  birth_date: string | null;
  hometown: string | null;
}

export const calculateDatesFromMarkers = async (timeMarkers: string[]): Promise<{ start_date: string | null, end_date: string | null }> => {
  const db = await getDb();
  let profile: UserProfile | null = null;

  try {
    profile = await db.getFirstAsync<UserProfile>('SELECT * FROM user_profile LIMIT 1');
  } catch (e) {
    console.warn("User profile not found or table doesn't exist yet");
  }

  const birthYear = profile?.birth_date ? parseInt(profile.birth_date.split('-')[0]) : null;
  const currentYear = new Date().getFullYear();

  if (!timeMarkers || timeMarkers.length === 0) {
    return { start_date: null, end_date: null };
  }

  // Normalize: AI may return strings ("exact_age:12") or objects ({exact_age: 12})
  const safeMarkers = timeMarkers
    .filter(m => m != null)
    .map(m => {
      if (typeof m === 'string') return m;
      if (typeof m === 'object') {
        const keys = Object.keys(m);
        if (keys.length > 0) return `${keys[0]}:${(m as any)[keys[0]]}`;
      }
      return String(m);
    })
    .filter(m => m.includes(':'));


  let startDate: string | null = null;
  let endDate: string | null = null;

  for (const marker of safeMarkers) {
    const parts = marker.split(':');
    if (parts.length < 2) continue;

    const type = parts[0].trim().toLowerCase();
    const value = parts.slice(1).join(':').trim().toLowerCase();

    if (type === 'exact_year') {
      const y = parseInt(value);
      startDate = `${y}-01-01`;
      endDate = `${y}-12-31`;

    } else if (type === 'exact_date') {
      // Formato: exact_date:2015-06-20
      startDate = value;
      endDate = value;

    } else if (type === 'exact_month') {
      // Formato: exact_month:2026-05
      const dateParts = value.split('-');
      if (dateParts.length === 2) {
        const y = parseInt(dateParts[0]);
        const m = parseInt(dateParts[1]);
        if (!isNaN(y) && !isNaN(m) && m >= 1 && m <= 12) {
          const monthStr = String(m).padStart(2, '0');
          startDate = `${y}-${monthStr}-01`;
          const lastDay = new Date(y, m, 0).getDate();
          endDate = `${y}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
        }
      }

    } else if (type === 'relative_years') {
      const offset = parseInt(value);
      const y = currentYear + offset;
      startDate = `${y}-01-01`;
      endDate = `${y}-12-31`;

    } else if (type === 'exact_age' || type === 'relative_age' || type === 'age') {
      // "cuando tenía 12 años" → exact_age:12
      if (birthYear) {
        const age = parseInt(value);
        const y = birthYear + age;
        startDate = `${y}-01-01`;
        endDate = `${y}-12-31`;
      }

    } else if (type === 'age_range') {
      // age_range:10-15
      if (birthYear) {
        const rangeParts = value.split('-');
        if (rangeParts.length === 2) {
          startDate = `${birthYear + parseInt(rangeParts[0])}-01-01`;
          endDate = `${birthYear + parseInt(rangeParts[1])}-12-31`;
        }
      }

    } else if (type === 'life_stage') {
      if (birthYear) {
        if (value === 'childhood' || value === 'niñez' || value === 'infancia') {
          startDate = `${birthYear + 3}-01-01`;
          endDate = `${birthYear + 12}-12-31`;
        } else if (value === 'teenage' || value === 'adolescencia') {
          startDate = `${birthYear + 13}-01-01`;
          endDate = `${birthYear + 19}-12-31`;
        } else if (value === 'adulthood' || value === 'adultez') {
          startDate = `${birthYear + 20}-01-01`;
          endDate = `${currentYear}-12-31`;
        }
      }

    } else if (type === 'fuzzy') {
      // Intentar extraer año de texto libre como "el verano pasado", "hace 2 meses"
      const yearMatch = value.match(/\d{4}/);
      if (yearMatch) {
        const y = parseInt(yearMatch[0]);
        startDate = `${y}-01-01`;
        endDate = `${y}-12-31`;
      }
      // Si no se puede extraer fecha de un fuzzy, dejamos null para que se genere inbox task
    }
  }

  const todayStr = getTodayStr();

  if (startDate && startDate > todayStr) {
    startDate = todayStr;
  }
  if (endDate && endDate > todayStr) {
    endDate = todayStr;
  }

  return { start_date: startDate, end_date: endDate };
};

const getTodayStr = (): string => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export const generateLifecycleStages = async (birthYear: number) => {
  if (!birthYear) return;
  const db = await getDb();
  const todayStr = getTodayStr();

  const stages = [
    { name: 'Infancia', startOffset: 0, endOffset: 11, type: 'TIME', is_custom_period: 0 },
    { name: 'Adolescencia', startOffset: 12, endOffset: 17, type: 'TIME', is_custom_period: 0 },
    { name: 'Adultez Temprana', startOffset: 18, endOffset: 29, type: 'TIME', is_custom_period: 0 },
    { name: 'Adultez Media', startOffset: 30, endOffset: 59, type: 'TIME', is_custom_period: 0 },
    { name: 'Adultez Mayor', startOffset: 60, endOffset: 120, type: 'TIME', is_custom_period: 0 },
  ];

  for (const stage of stages) {
    const startY = birthYear + stage.startOffset;
    const endY = birthYear + stage.endOffset;
    const startStr = `${startY}-01-01`;
    const naturalEndStr = `${endY}-12-31`;

    if (startStr > todayStr) continue; // Skip future stages

    const actualEndStr = naturalEndStr > todayStr ? todayStr : naturalEndStr;

    // Check if it already exists
    const existing = await db.getFirstAsync<{ id: string }>("SELECT id FROM entities WHERE type = 'TIME' AND name = ?", stage.name);

    const metadata = JSON.stringify({
      start_date: startStr,
      end_date: actualEndStr,
      is_custom_period: stage.is_custom_period
    });

    if (existing) {
      await db.runAsync("UPDATE entities SET metadata = ? WHERE id = ?", metadata, existing.id);
    } else {
      const { v4: uuidv4 } = require('uuid');
      await db.runAsync(
        "INSERT INTO entities (id, type, name, metadata, is_confirmed) VALUES (?, ?, ?, ?, 1)",
        uuidv4(), stage.type, stage.name, metadata
      );
    }
  }
};
