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
 * Verifica sesión activa antes de subir. Usa Uint8Array desde base64 para máxima compatibilidad con Expo Snack/Android.
 * NUNCA devuelve un file:// URI — si falla el upload, lanza un error.
 */
export const uploadAvatar = async (userId: string, localUri: string, base64Data?: string): Promise<string> => {
  // Si ya es una URL remota, devolverla directamente
  if (!localUri || localUri.startsWith('http')) {
    return localUri;
  }

  // Verificar que es un archivo local válido
  if (!localUri.startsWith('file://') && !localUri.startsWith('content://')) {
    console.warn('[Avatar Upload] URI no reconocida, ignorando:', localUri.substring(0, 30));
    return '';
  }
  
  // Verificar que hay sesión activa (el token JWT es lo que autoriza contra RLS)
  const { data: { session: currentSession } } = await supabase.auth.getSession();
  if (!currentSession) {
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshData.session) {
      throw new Error('[Avatar Upload] No hay sesión activa para subir avatar');
    }
  }

  const fileExt = localUri.split('.').pop()?.split('?')[0] || 'jpg';
  // Nombre de archivo estable por usuario: siempre sobreescribe al actualizar
  const filePath = `avatars/${userId}.${fileExt}`;
  const contentType = `image/${fileExt === 'png' ? 'png' : 'jpeg'}`;

  let error;

  if (base64Data) {
    console.log('[Avatar Upload] Subiendo desde base64...');
    const arrayBuffer = decodeBase64(base64Data);
    const res = await supabase.storage
      .from('user_assets')
      .upload(filePath, arrayBuffer, {
        contentType,
        upsert: true
      });
    error = res.error;
  } else {
    console.log('[Avatar Upload] Subiendo desde fetch blob...');
    const response = await fetch(localUri);
    const blob = await response.blob();
    const res = await supabase.storage
      .from('user_assets')
      .upload(filePath, blob, {
        contentType,
        upsert: true
      });
    error = res.error;
  }

  if (error) {
    console.error('[Avatar Upload] Error al subir a Storage:', error);
    throw error;
  }

  // Limpiar avatares obsoletos del storage (ej. de extensiones anteriores o timestamps viejos)
  try {
    const { data: existingFiles, error: listError } = await supabase.storage
      .from('user_assets')
      .list('avatars', { search: userId });

    if (listError) {
      console.warn('[Avatar Upload] Error al listar archivos para limpieza:', listError);
    } else if (existingFiles && existingFiles.length > 0) {
      const newFileName = `${userId}.${fileExt}`;
      const filesToDelete = existingFiles
        .filter(f => (f.name.startsWith(`${userId}.`) || f.name.startsWith(`${userId}-`)) && f.name !== newFileName)
        .map(f => `avatars/${f.name}`);

      if (filesToDelete.length > 0) {
        console.log('[Avatar Upload] Eliminando archivos de avatar obsoletos para evitar bloat:', filesToDelete);
        const { error: removeError } = await supabase.storage
          .from('user_assets')
          .remove(filesToDelete);
        if (removeError) {
          console.warn('[Avatar Upload] Error al eliminar archivos obsoletos:', removeError);
        } else {
          console.log('[Avatar Upload] Limpieza de avatares obsoletos completada con éxito.');
        }
      }
    }
  } catch (cleanError) {
    console.warn('[Avatar Upload] Error inesperado durante la limpieza de Storage:', cleanError);
  }

  const { data: { publicUrl } } = supabase.storage
    .from('user_assets')
    .getPublicUrl(filePath);

  // Añadir un parámetro de versión para romper la caché estricta de React Native Image y Supabase CDN.
  // Esto asegura que, aunque el archivo en Storage se sobrescriba con el mismo nombre, 
  // la URL resultante sea "nueva" y la app cargue la imagen actualizada inmediatamente.
  const versionedUrl = `${publicUrl}?v=${Date.now()}`;

  console.log('[Avatar Upload] Subida exitosa. Public URL:', versionedUrl);
  return versionedUrl;
};

