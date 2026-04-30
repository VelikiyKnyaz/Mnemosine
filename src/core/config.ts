// Configuración de claves en runtime. Se guardan en AsyncStorage del dispositivo.
// Nunca se suben a Git ni se hardcodean en el código.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  OPENAI_API_KEY: 'config:openai_api_key',
  SUPABASE_URL: 'config:supabase_url',
  SUPABASE_ANON_KEY: 'config:supabase_anon_key',
};

export const getConfig = async (key: keyof typeof KEYS): Promise<string> => {
  const value = await AsyncStorage.getItem(KEYS[key]);
  return value || '';
};

export const setConfig = async (key: keyof typeof KEYS, value: string): Promise<void> => {
  await AsyncStorage.setItem(KEYS[key], value);
};

export const getAllConfig = async (): Promise<Record<string, string>> => {
  const result: Record<string, string> = {};
  for (const [key, storageKey] of Object.entries(KEYS)) {
    result[key] = (await AsyncStorage.getItem(storageKey)) || '';
  }
  return result;
};
