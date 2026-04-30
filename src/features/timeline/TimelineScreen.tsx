import React, { useState, useEffect } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, FAB, Appbar } from 'react-native-paper';
import { supabase } from '../../core/supabase';
import { useAuthStore } from '../../core/store';
import BiographerCard from '../biographer/BiographerCard';
import CaptureModal from '../capture/CaptureModal';
import { getDb } from '../../core/database';

export default function TimelineScreen() {
  const setSession = useAuthStore((state) => state.setSession);
  const [modalVisible, setModalVisible] = useState(false);
  const [initialQuestion, setInitialQuestion] = useState<string | undefined>(undefined);
  const [memories, setMemories] = useState<any[]>([]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  const loadMemories = async () => {
    try {
      const db = await getDb();
      const allRows = await db.getAllAsync('SELECT * FROM memories ORDER BY created_at DESC');
      setMemories(allRows);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadMemories();
  }, [modalVisible]); // reload when modal closes

  const handleQuestionPress = (q: string) => {
    setInitialQuestion(q);
    setModalVisible(true);
  };

  const handleFabPress = () => {
    setInitialQuestion(undefined);
    setModalVisible(true);
  };

  return (
    <View style={styles.container}>
      <Appbar.Header>
        <Appbar.Content title="Línea de Tiempo" />
        <Appbar.Action icon="logout" onPress={handleLogout} />
      </Appbar.Header>

      <FlatList
        data={memories}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={<BiographerCard onPressQuestion={handleQuestionPress} />}
        renderItem={({ item }) => (
          <View style={styles.memoryCard}>
            <View style={styles.cardHeader}>
              <Text variant="titleMedium" style={styles.titleText}>{item.title || 'Recuerdo'}</Text>
              {item.fuzzy_date && <Text variant="labelSmall" style={styles.dateText}>{item.fuzzy_date}</Text>}
            </View>
            {item.raw_text ? <Text style={styles.bodyText}>{item.raw_text}</Text> : null}
            
            <View style={styles.cardFooter}>
              {item.audio_uri ? <Text style={styles.audioHint}>🎤 Audio</Text> : <View />}
              <Text style={styles.statusHint}>
                {item.sync_status === 'PROCESSED_LOCAL' ? '✨ IA' : '⏳ Procesando'} 
                {item.sentiment_score !== null && ` • Sentimiento: ${(item.sentiment_score > 0 ? '+' : '')}${item.sentiment_score}`}
              </Text>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text>No hay recuerdos aún. ¡Escribe el primero!</Text>
          </View>
        }
      />

      <FAB
        icon="plus"
        style={styles.fab}
        onPress={handleFabPress}
      />

      <CaptureModal 
        visible={modalVisible} 
        onDismiss={() => setModalVisible(false)} 
        initialQuestion={initialQuestion}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  fab: {
    position: 'absolute',
    margin: 16,
    right: 0,
    bottom: 0,
  },
  memoryCard: {
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 8,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  titleText: {
    fontWeight: 'bold',
    flex: 1,
  },
  dateText: {
    color: '#8b5cf6',
    fontWeight: 'bold',
    marginLeft: 8,
  },
  bodyText: {
    color: '#333',
    lineHeight: 20,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 8,
  },
  audioHint: {
    color: '#0284c7',
    fontWeight: 'bold',
    fontSize: 12,
  },
  statusHint: {
    fontSize: 12,
    color: '#888',
  },
  empty: {
    padding: 20,
    alignItems: 'center',
  }
});
