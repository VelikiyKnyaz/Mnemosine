import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Button, Text, Card, Title, Paragraph, Divider } from 'react-native-paper';
import { getDb } from '../../core/database';
import { processPendingMemories } from '../../core/ai_processor';
import { useAuthStore } from '../../core/store';

export default function DebugScreen() {
  const [memories, setMemories] = useState<any[]>([]);
  const [entities, setEntities] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const setSession = useAuthStore(state => state.setSession);

  const loadData = async () => {
    try {
      const db = await getDb();
      const mems = await db.getAllAsync('SELECT * FROM memories ORDER BY created_at DESC');
      const ents = await db.getAllAsync('SELECT * FROM entities');
      setMemories(mems);
      setEntities(ents);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleClearDb = async () => {
    try {
      const db = await getDb();
      await db.execAsync(`
        DELETE FROM memory_entities;
        DELETE FROM entities;
        DELETE FROM memories;
      `);
      Alert.alert('Éxito', 'Base de datos borrada exitosamente.');
      loadData();
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'No se pudo borrar la base de datos.');
    }
  };

  const handleProcessAI = async () => {
    setLoading(true);
    try {
      await processPendingMemories();
      Alert.alert('IA Procesada', 'Se procesaron las memorias pendientes con éxito.');
      loadData();
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Fallo al procesar IA.');
    } finally {
      setLoading(false);
    }
  };
  
  const handleLogout = () => {
    setSession(null);
  };

  return (
    <ScrollView style={styles.container}>
      <Title style={styles.title}>Panel Técnico (Admin)</Title>
      
      <View style={styles.buttonRow}>
        <Button mode="contained" onPress={loadData} disabled={loading} style={styles.actionBtn}>
          Refrescar
        </Button>
        <Button mode="contained" onPress={handleProcessAI} disabled={loading} style={styles.actionBtn} buttonColor="#6200ee">
          Forzar IA
        </Button>
      </View>
      <View style={styles.buttonRow}>
        <Button mode="outlined" onPress={handleClearDb} disabled={loading} style={styles.actionBtn} textColor="#B00020" style={{borderColor: '#B00020'}}>
          Borrar BD
        </Button>
        <Button mode="text" onPress={handleLogout} disabled={loading} style={styles.actionBtn}>
          Salir a Login
        </Button>
      </View>

      <Divider style={styles.divider} />

      <Title>Memorias Registradas ({memories.length})</Title>
      {memories.map(m => (
        <Card key={m.id} style={styles.card}>
          <Card.Content>
            <Paragraph><Text style={{fontWeight: 'bold'}}>ID:</Text> {m.id}</Paragraph>
            <Paragraph><Text style={{fontWeight: 'bold'}}>Texto (Raw):</Text> {m.raw_text}</Paragraph>
            <Paragraph><Text style={{fontWeight: 'bold'}}>Estado de Sync:</Text> {m.sync_status}</Paragraph>
            <Paragraph><Text style={{fontWeight: 'bold'}}>Fecha Difusa:</Text> {m.fuzzy_date || 'N/A'}</Paragraph>
            <Paragraph><Text style={{fontWeight: 'bold'}}>Sentimiento (IA):</Text> {m.sentiment_score}</Paragraph>
            <Paragraph><Text style={{fontWeight: 'bold'}}>Audio URI:</Text> {m.audio_uri || 'Ninguno'}</Paragraph>
          </Card.Content>
        </Card>
      ))}

      <Divider style={styles.divider} />

      <Title>Entidades Detectadas por IA ({entities.length})</Title>
      {entities.map(e => (
        <Card key={e.id} style={styles.card}>
          <Card.Content>
            <Paragraph><Text style={{fontWeight: 'bold'}}>Nombre:</Text> {e.name}</Paragraph>
            <Paragraph><Text style={{fontWeight: 'bold'}}>Tipo:</Text> {e.type}</Paragraph>
          </Card.Content>
        </Card>
      ))}
      
      <View style={{height: 50}} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 15,
    backgroundColor: '#f5f5f5',
  },
  title: {
    textAlign: 'center',
    marginVertical: 15,
    fontWeight: 'bold',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  actionBtn: {
    flex: 1,
    marginHorizontal: 5,
  },
  divider: {
    marginVertical: 20,
    height: 2,
  },
  card: {
    marginBottom: 15,
    backgroundColor: '#ffffff',
  }
});
