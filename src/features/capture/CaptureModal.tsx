import React, { useState, useRef, useEffect } from 'react';
import { View, StyleSheet, Modal, TouchableOpacity, TextInput as RNTextInput } from 'react-native';
import { TextInput, Button, Text, IconButton } from 'react-native-paper';
import { getDb } from '../../core/database';
import { processPendingMemories } from '../../core/ai_processor';
import { useAudioRecorder } from './useAudioRecorder';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

interface CaptureModalProps {
  visible: boolean;
  onDismiss: () => void;
  initialQuestion?: string;
}

export default function CaptureModal({ visible, onDismiss, initialQuestion }: CaptureModalProps) {
  const [text, setText] = useState('');
  const { isRecording, recordUri, startRecording, stopRecording, cancelRecording, setRecordUri } = useAudioRecorder();
  const inputRef = useRef<RNTextInput>(null);

  // Force keyboard open when modal becomes visible
  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => inputRef.current?.focus(), 300);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  const handleSave = async () => {
    if (!text.trim() && !recordUri) return;

    try {
      const db = await getDb();
      const id = uuidv4();
      const rawText = initialQuestion ? `${initialQuestion}\n\n${text}` : text;
      
      await db.runAsync(
        'INSERT INTO memories (id, raw_text, audio_uri, sync_status) VALUES (?, ?, ?, ?)',
        id, rawText, recordUri, 'PENDING_AI'
      );
      
      // Reset and close
      setText('');
      setRecordUri(null);
      onDismiss();
      
      // Trigger AI background job
      processPendingMemories().catch(console.error);
    } catch (err) {
      console.error('Error saving memory', err);
    }
  };

  const handleClose = () => {
    cancelRecording();
    setText('');
    setRecordUri(null);
    onDismiss();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text variant="titleLarge">Nuevo Recuerdo</Text>
          <IconButton icon="close" onPress={handleClose} />
        </View>

        {initialQuestion && (
          <View style={styles.questionContainer}>
            <Text variant="bodyLarge" style={styles.questionText}>{initialQuestion}</Text>
          </View>
        )}

        <TextInput
          ref={inputRef}
          mode="flat"
          placeholder="¿Qué tienes en mente?"
          multiline
          value={text}
          onChangeText={setText}
          style={styles.input}
          autoFocus
        />

        {recordUri && (
          <View style={styles.audioContainer}>
            <Text>Audio grabado listo para procesar.</Text>
            <IconButton icon="delete" onPress={() => setRecordUri(null)} />
          </View>
        )}

        <View style={styles.footer}>
          {!recordUri && (
            <TouchableOpacity 
              onPressIn={startRecording} 
              onPressOut={stopRecording}
              style={[styles.micButton, isRecording && styles.micRecording]}
            >
              <IconButton icon="microphone" iconColor={isRecording ? '#fff' : '#000'} size={32} />
              {isRecording && <Text style={{color: 'white'}}>Grabando...</Text>}
            </TouchableOpacity>
          )}

          <Button mode="contained" onPress={handleSave} disabled={(!text.trim() && !recordUri) || isRecording}>
            Guardar
          </Button>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  questionContainer: {
    padding: 15,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    marginBottom: 20,
  },
  questionText: {
    fontStyle: 'italic',
    color: '#444',
  },
  input: {
    flex: 1,
    backgroundColor: 'transparent',
    fontSize: 18,
  },
  audioContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#e6f7ff',
    padding: 10,
    borderRadius: 8,
    marginVertical: 10,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  micButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eee',
    borderRadius: 30,
    paddingRight: 15,
  },
  micRecording: {
    backgroundColor: 'red',
  },
});
