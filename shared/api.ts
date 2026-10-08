// Contrato publicable. Nunca contiene credenciales ni dependencias del servidor.
export interface AICategorization {
  title: string;
  time_markers: string[];
  entities: {
    name: string;
    type: 'PERSON' | 'LOCATION' | 'EVENT' | 'OBJECT' | 'TIME' | 'EMOTION';
    parent_name?: string;
  }[];
  ambiguities: string[];
}

export interface BackendStatus {
  version: number;
  secrets: { openai: boolean; googleMaps: boolean };
  quotaReady: boolean;
  limits: { maxAudioBytes: number; maxMemoryChars: number };
}

export interface LocationBias {
  circle?: {
    center: { latitude: number; longitude: number };
    radius: number;
  };
  rectangle?: {
    low: { latitude: number; longitude: number };
    high: { latitude: number; longitude: number };
  };
}

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_MEMORY_CHARS = 12000;
