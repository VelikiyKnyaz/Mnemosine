import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { MAX_AUDIO_BYTES, type AICategorization } from '../../shared/api';
import { BackendError, requestBackend } from './backend';

export type { AICategorization } from '../../shared/api';

export const transcribeAudio = async (audioUri: string): Promise<string> => {
  const form = new FormData();
  form.append('action', 'audio.transcribe');
  if (Platform.OS === 'web') {
    const response = await fetch(audioUri);
    const blob = await response.blob();
    if (!blob.size || blob.size > MAX_AUDIO_BYTES) throw new BackendError('AUDIO_TOO_LARGE', 'Usa un audio de hasta 10 MB. El archivo original sigue guardado.');
    const extension = /mp4|m4a/.test(blob.type) ? 'm4a'
      : blob.type.includes('ogg') ? 'ogg' : blob.type.includes('wav') ? 'wav'
      : /mpeg|mp3/.test(blob.type) ? 'mp3' : blob.type.includes('flac') ? 'flac' : 'webm';
    form.append('file', blob, `recording.${extension}`);
  } else {
    const file = new File(audioUri);
    if (!file.exists) throw new BackendError('AUDIO_NOT_FOUND', 'No se encontró el audio local.');
    if (file.size > MAX_AUDIO_BYTES) throw new BackendError('AUDIO_TOO_LARGE', 'Usa un audio de hasta 10 MB. El archivo original sigue guardado.');
    form.append('file', { uri: audioUri, name: 'recording.m4a', type: 'audio/m4a' } as any);
  }
  const result = await requestBackend<{ text: string }>(form);
  if (typeof result.text !== 'string') throw new BackendError('INVALID_RESPONSE', 'No se obtuvo una transcripción válida.');
  return result.text;
};

export const extractMemoryData = (
  text: string,
  existingEntitiesContext = '',
  timeContext = '',
  spaceContext = '',
): Promise<AICategorization> => requestBackend<AICategorization>({
  action: 'ai.extract', text, existingEntitiesContext, timeContext, spaceContext,
});

export const segmentMemoryText = async (text: string): Promise<string[]> => {
  const result = await requestBackend<{ fragments: string[] }>({ action: 'ai.segment', text });
  return result.fragments;
};
