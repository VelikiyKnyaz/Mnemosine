import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from './config';

// Inicialización estática preferida desde variables de entorno de Expo, con fallbacks para Expo Snack
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://eknupuhacgqfgmbrxrys.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrbnVwdWhhY2dxZmdtYnJ4cnlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MTA5MDEsImV4cCI6MjA5MzA4NjkwMX0.HYcHhS7P36D-QOoonosyil8779iUG-fT-iHbIdOZjK4';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

let _supabase: SupabaseClient | null = null;

// Inicialización lazy: lee las claves de AsyncStorage si no hay variables de entorno
export const getSupabase = async (): Promise<SupabaseClient> => {
  if (_supabase) return _supabase;

  // Si las variables de entorno de Expo ya están configuradas, usamos la instancia estática principal
  if (process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) {
    _supabase = supabase;
    return _supabase;
  }

  const url = await getConfig('SUPABASE_URL');
  const anonKey = await getConfig('SUPABASE_ANON_KEY');

  if (!url || !anonKey) {
    throw new Error('Supabase no configurado. Configura las variables de entorno en el panel de Expo.');
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

