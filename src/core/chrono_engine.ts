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

  // Sanitize: AI may return non-string markers (objects, numbers, etc.)
  const safeMarkers = timeMarkers
    .filter(m => m != null && typeof m !== 'object')
    .map(m => String(m))
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

  return { start_date: startDate, end_date: endDate };
};

