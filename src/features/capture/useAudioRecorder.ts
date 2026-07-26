import { useState, useEffect } from 'react';
import { Audio } from 'expo-av';
import { Directory, File, Paths } from 'expo-file-system';

export function useAudioRecorder() {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordUri, setRecordUri] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (recording) {
        recording.stopAndUnloadAsync().catch(console.error);
      }
    };
  }, [recording]);

  const startRecording = async () => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (permission.status === 'granted') {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        });

        const { recording } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY
        );
        setRecording(recording);
        setIsRecording(true);
      }
    } catch (err) {
      console.error('Failed to start recording', err);
    }
  };

  const stopRecording = async () => {
    if (!recording) return;

    try {
      setIsRecording(false);
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();

      if (uri) {
        try {
          const recordingsDirectory = new Directory(Paths.document, 'recordings');
          recordingsDirectory.create({ idempotent: true, intermediates: true });

          const source = new File(uri);
          const extension = source.extension || '.m4a';
          const destination = new File(
            recordingsDirectory,
            `memory-${Date.now()}${extension}`
          );
          source.move(destination);
          setRecordUri(destination.uri);
        } catch (fileError) {
          // Keep capture usable in Snack even if a platform cannot move the file.
          console.warn('Could not persist recording; using temporary URI.', fileError);
          setRecordUri(uri);
        }
      }
      setRecording(null);
    } catch (err) {
      console.error('Failed to stop recording', err);
    }
  };

  const cancelRecording = async () => {
    let uriToDelete = recordUri;
    if (recording) {
      setIsRecording(false);
      await recording.stopAndUnloadAsync();
      uriToDelete = uriToDelete || recording.getURI();
    }
    if (uriToDelete) {
      try {
        const file = new File(uriToDelete);
        if (file.exists) {
          file.delete();
        }
      } catch (fileError) {
        console.warn('Could not discard recording file.', fileError);
      }
    }
    setRecording(null);
    setRecordUri(null);
  };

  return {
    isRecording,
    recordUri,
    startRecording,
    stopRecording,
    cancelRecording,
    setRecordUri
  };
}
