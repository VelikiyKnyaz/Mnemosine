import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from './config';

// Polyfill simple para decodificar base64 a Uint8Array sin dependencias externas (compatible con Snack)
const decodeBase64 = (base64: string): Uint8Array => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }

  let bufferLength = base64.length * 0.75;
  if (base64[base64.length - 1] === '=') bufferLength--;
  if (base64[base64.length - 2] === '=') bufferLength--;

  const bytes = new Uint8Array(bufferLength);
  let p = 0;
  for (let i = 0; i < base64.length; i += 4) {
    const encoded1 = lookup[base64.charCodeAt(i)];
    const encoded2 = lookup[base64.charCodeAt(i + 1)];
    const encoded3 = lookup[base64.charCodeAt(i + 2)];
    const encoded4 = lookup[base64.charCodeAt(i + 3)];

    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    if (encoded3 !== 64) bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    if (encoded4 !== 64) bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
  }
  return bytes;
};

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

/**
 * Uploads a local file (from gallery) to Supabase storage bucket 'user_assets' and returns its public URL.
 * Uses ArrayBuffer/Blob para evitar el bug de React Native en Android donde FormData elimina los headers de Auth (causando RLS 403).
 */
export const uploadAvatar = async (userId: string, localUri: string, base64Data?: string): Promise<string> => {
  // Solo subir archivos locales (file:// o content:// en Android)
  if (!localUri || (!localUri.startsWith('file://') && !localUri.startsWith('content://'))) {
    return localUri;
  }
  
  try {
    const fileExt = localUri.split('.').pop()?.split('?')[0] || 'jpg';
    const filePath = `avatars/${userId}-${Date.now()}.${fileExt}`;

    let error;

    if (base64Data) {
      // Snack / Android seguro: Usamos el string base64 directo desde ImagePicker
      const arrayBuffer = decodeBase64(base64Data);
      const res = await supabase.storage
        .from('user_assets')
        .upload(filePath, arrayBuffer, {
          contentType: `image/${fileExt === 'png' ? 'png' : 'jpeg'}`,
          upsert: true
        });
      error = res.error;
    } else {
      // Fallback si no hay base64 (fetch puro devolviendo blob y lo enviamos sin FormData)
      const response = await fetch(localUri);
      const blob = await response.blob();
      const res = await supabase.storage
        .from('user_assets')
        .upload(filePath, blob, {
          contentType: `image/${fileExt === 'png' ? 'png' : 'jpeg'}`,
          upsert: true
        });
      error = res.error;
    }

    if (error) {
      console.error('Supabase storage upload error:', error);
      throw error;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('user_assets')
      .getPublicUrl(filePath);

    console.log('[Avatar Upload] Subida exitosa:', publicUrl);
    return publicUrl;
  } catch (error) {
    console.error('[Avatar Upload] Error subiendo avatar:', error);
    // Devolver la URI original en caso de fallo para no perder la referencia
    return localUri;
  }
};

