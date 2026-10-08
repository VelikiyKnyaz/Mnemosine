// Solo configuración pública. Las claves privadas viven exclusivamente en el backend.
// No se leen las claves heredadas de .env ni de AsyncStorage; se conservan sin modificarlas.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://eknupuhacgqfgmbrxrys.supabase.co';
export const SUPABASE_PUBLIC_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrbnVwdWhhY2dxZmdtYnJ4cnlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MTA5MDEsImV4cCI6MjA5MzA4NjkwMX0.HYcHhS7P36D-QOoonosyil8779iUG-fT-iHbIdOZjK4';
