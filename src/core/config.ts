// Configuración de claves en runtime. Se guardan en AsyncStorage del dispositivo o se obtienen de variables de entorno de Expo.
// Nunca se suben a Git ni se hardcodean en el código.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  OPENAI_API_KEY: 'config:openai_api_key',
  GOOGLE_MAPS_KEY: 'config:google_maps_key',
  SUPABASE_URL: 'config:supabase_url',
  SUPABASE_ANON_KEY: 'config:supabase_anon_key',
};

// Mapeo a las variables de entorno de Expo
const ENV_MAPPING = {
  OPENAI_API_KEY: process.env.EXPO_PUBLIC_OPENAI_API_KEY,
  GOOGLE_MAPS_KEY: process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY,
  SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
};

export const getConfig = async (key: keyof typeof KEYS): Promise<string> => {
  // Primero intentamos obtener la variable desde el entorno de Expo
  const envValue = ENV_MAPPING[key];
  if (envValue) {
    return envValue;
  }
  // Fallback a AsyncStorage local
  const value = await AsyncStorage.getItem(KEYS[key]);
  return value || '';
};

export const setConfig = async (key: keyof typeof KEYS, value: string): Promise<void> => {
  await AsyncStorage.setItem(KEYS[key], value);
};

export const getAllConfig = async (): Promise<Record<string, string>> => {
  const result: Record<string, string> = {};
  for (const key of Object.keys(KEYS) as Array<keyof typeof KEYS>) {
    const envValue = ENV_MAPPING[key];
    if (envValue) {
      result[key] = envValue;
    } else {
      result[key] = (await AsyncStorage.getItem(KEYS[key])) || '';
    }
  }
  return result;
};

