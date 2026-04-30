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

  let startYear = currentYear;
  let endYear = currentYear;

  if (!timeMarkers || timeMarkers.length === 0) {
    return { start_date: null, end_date: null };
  }

  // Motor algorítmico simple (Token-optimized)
  for (const marker of timeMarkers) {
    const parts = marker.split(':');
    if (parts.length < 2) continue;
    
    const type = parts[0];
    const value = parts.slice(1).join(':').trim().toLowerCase();

    if (type === 'exact_year') {
      startYear = parseInt(value);
      endYear = startYear;
    } else if (type === 'relative_years') {
      const offset = parseInt(value);
      startYear = currentYear + offset;
      endYear = startYear;
    } else if (type === 'life_stage') {
      if (birthYear) {
        if (value === 'childhood' || value === 'niñez' || value === 'infancia') {
          startYear = birthYear + 3;
          endYear = birthYear + 12;
        } else if (value === 'teenage' || value === 'adolescencia') {
          startYear = birthYear + 13;
          endYear = birthYear + 19;
        } else if (value === 'adulthood' || value === 'adultez') {
          startYear = birthYear + 20;
          endYear = currentYear;
        }
      }
    }
  }

  // Devolver fechas ISO aproximadas
  return {
    start_date: `${startYear}-01-01`,
    end_date: `${endYear}-12-31`
  };
};
