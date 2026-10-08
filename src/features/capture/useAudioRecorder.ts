import { useEffect, useRef, useState } from 'react';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder as useExpoAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';

export function useAudioRecorder() {
  const recorder = useExpoAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    // Los recuerdos guardados deben sobrevivir a la limpieza de la caché.
    directory: 'document',
  });
  const recorderState = useAudioRecorderState(recorder);
  const [isBusy, setIsBusy] = useState(false);
  const [recordUri, setRecordUri] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const mounted = useRef(true);
  const held = useRef(false);
  const cancelled = useRef(false);
  const startJob = useRef<Promise<void> | null>(null);
  const stopJob = useRef<Promise<void> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      held.current = false;
      cancelled.current = true;
      // El hook de Expo libera el grabador; restauramos la salida de audio.
      setAudioModeAsync({ allowsRecording: false }).catch(console.error);
    };
  }, []);

  const startRecording = async () => {
    if (startJob.current || stopJob.current || held.current || recorder.isRecording) return;
    held.current = true;
    cancelled.current = false;
    setIsBusy(true);
    setRecordingError(null);

    const job = (async () => {
      try {
        const permission = await requestRecordingPermissionsAsync();
        if (!mounted.current) return;
        if (!permission.granted) {
          setRecordingError('Permite el acceso al micrófono en Ajustes para grabar recuerdos.');
          return;
        }
        // Soltar mientras aparece el permiso no debe iniciar una grabación tardía.
        if (!held.current) return;
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
          interruptionMode: 'doNotMix',
          shouldPlayInBackground: false,
        });
        if (!mounted.current || !held.current) return;
        await recorder.prepareToRecordAsync();
        if (!mounted.current || !held.current) return;
        recorder.record();
      } catch (error) {
        console.error('Failed to start recording', error);
        if (mounted.current) setRecordingError('No se pudo iniciar la grabación. Intenta nuevamente.');
      } finally {
        if (mounted.current && !recorder.isRecording && !stopJob.current) {
          held.current = false;
          await setAudioModeAsync({ allowsRecording: false }).catch(console.error);
          if (mounted.current) setIsBusy(false);
        }
      }
    })();

    startJob.current = job;
    await job;
    startJob.current = null;
  };

  const stopRecording = async () => {
    held.current = false;
    if (stopJob.current) return stopJob.current;

    const job = (async () => {
      try {
        // Esperar también cubre el permiso y la preparación asíncrona en iOS.
        await startJob.current;
        if (!mounted.current) return;
        const wasRecording = recorder.isRecording;
        if (wasRecording) await recorder.stop();
        if (mounted.current && !cancelled.current && wasRecording && recorder.uri) {
          setRecordUri(recorder.uri);
        }
      } catch (error) {
        console.error('Failed to stop recording', error);
        if (mounted.current && !cancelled.current) {
          setRecordingError('No se pudo guardar el audio. Intenta grabarlo nuevamente.');
        }
      } finally {
        await setAudioModeAsync({ allowsRecording: false }).catch(console.error);
        if (mounted.current) setIsBusy(false);
      }
    })();

    stopJob.current = job;
    await job;
    stopJob.current = null;
  };

  const cancelRecording = async () => {
    cancelled.current = true;
    setRecordUri(null);
    setRecordingError(null);
    await stopRecording();
  };

  return {
    isRecording: recorderState.isRecording,
    isBusy,
    recordUri,
    recordingError,
    startRecording,
    stopRecording,
    cancelRecording,
    setRecordUri,
  };
}
