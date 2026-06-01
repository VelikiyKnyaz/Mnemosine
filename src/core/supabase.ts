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
 */
export const uploadAvatar = async (userId: string, localUri: string, base64Data?: string): Promise<string> => {
  // Solo subir archivos locales (file:// o content:// en Android)
  if (!localUri || (!localUri.startsWith('file://') && !localUri.startsWith('content://'))) {
    return localUri;
  }
  
  try {
    // 1. Verificar que hay sesión activa (el token JWT es lo que autoriza contra RLS)
    const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      console.error('[Avatar Upload] Error obteniendo sesión:', sessionError);
    }
    if (!currentSession) {
      console.error('[Avatar Upload] ⚠️ NO HAY SESIÓN ACTIVA. El upload será rechazado por RLS.');
      console.error('[Avatar Upload] userId recibido:', userId);
      // Intentar refrescar la sesión
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshData.session) {
        console.error('[Avatar Upload] No se pudo refrescar la sesión:', refreshError);
        return localUri; // Retornar URI local, no tiene sentido intentar subir sin auth
      }
      console.log('[Avatar Upload] Sesión refrescada exitosamente');
    } else {
      console.log('[Avatar Upload] ✅ Sesión activa. User ID del token:', currentSession.user.id);
      console.log('[Avatar Upload] Token expira:', new Date((currentSession.expires_at || 0) * 1000).toISOString());
    }

    const fileExt = localUri.split('.').pop()?.split('?')[0] || 'jpg';
    const filePath = `avatars/${userId}-${Date.now()}.${fileExt}`;
    const contentType = `image/${fileExt === 'png' ? 'png' : 'jpeg'}`;

    console.log('[Avatar Upload] Intentando subir a:', filePath, '| contentType:', contentType, '| base64:', !!base64Data);

    let error;

    if (base64Data) {
      // Ruta principal: Usamos el string base64 directo desde ImagePicker
      const arrayBuffer = decodeBase64(base64Data);
      console.log('[Avatar Upload] Uint8Array creado, tamaño:', arrayBuffer.byteLength, 'bytes');
      const res = await supabase.storage
        .from('user_assets')
        .upload(filePath, arrayBuffer, {
          contentType,
          upsert: true
        });
      error = res.error;
    } else {
      // Fallback si no hay base64
      const response = await fetch(localUri);
      const blob = await response.blob();
      console.log('[Avatar Upload] Blob creado, tamaño:', blob.size, 'bytes');
      const res = await supabase.storage
        .from('user_assets')
        .upload(filePath, blob, {
          contentType,
          upsert: true
        });
      error = res.error;
    }

    if (error) {
      console.error('[Avatar Upload] Supabase storage upload error:', JSON.stringify(error));
      // Log extra para diagnóstico RLS
      if (error.message?.includes('row-level security') || (error as any).statusCode === '403') {
        console.error('[Avatar Upload] 🔒 ERROR RLS: La política de storage en Supabase NO permite esta operación.');
        console.error('[Avatar Upload] Verificar en Supabase Dashboard > Storage > Policies del bucket "user_assets":');
        console.error('[Avatar Upload]   - Debe existir una policy INSERT para authenticated users');
        console.error('[Avatar Upload]   - Ejemplo SQL: CREATE POLICY "Allow authenticated uploads" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = \'user_assets\');');
      }
      throw error;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('user_assets')
      .getPublicUrl(filePath);

    console.log('[Avatar Upload] ✅ Subida exitosa:', publicUrl);
    return publicUrl;
  } catch (error) {
    console.error('[Avatar Upload] Error subiendo avatar:', error);
    // Devolver la URI original en caso de fallo para no perder la referencia
    return localUri;
  }
};

