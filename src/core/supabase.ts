import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from './config';

let _supabase: SupabaseClient | null = null;

// Inicialización lazy: lee las claves de AsyncStorage en vez de hardcodearlas
export const getSupabase = async (): Promise<SupabaseClient> => {
  if (_supabase) return _supabase;

  const url = await getConfig('SUPABASE_URL');
  const anonKey = await getConfig('SUPABASE_ANON_KEY');

  if (!url || !anonKey) {
    throw new Error('Supabase no configurado. Ve al Panel Admin para ingresar las claves.');
  }

  _supabase = createClient(url, anonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });

  return _supabase;
};

// Para compatibilidad con código existente que usa `supabase` directamente (login bypass etc.)
// Crea un cliente dummy que será reemplazado cuando se configure
export const supabase = createClient('https://placeholder.supabase.co', 'placeholder', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});
