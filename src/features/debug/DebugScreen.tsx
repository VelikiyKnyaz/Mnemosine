import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Button, Text, Card, Title, Paragraph, Divider } from 'react-native-paper';
import { getDb } from '../../core/database';
import { processPendingMemories } from '../../core/ai_processor';
import { useAuthStore } from '../../core/store';
import { getBackendStatus } from '../../core/backend';
import { SUPABASE_URL } from '../../core/config';
import { supabase } from '../../core/supabase';
import type { BackendStatus } from '../../../shared/api';

export default function DebugScreen() {
  const [memories, setMemories] = useState<any[]>([]);
  const [entities, setEntities] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const setSession = useAuthStore(state => state.setSession);
  const session = useAuthStore(state => state.session);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [backendError, setBackendError] = useState('');
  const [checkingBackend, setCheckingBackend] = useState(false);
  const isDiagnostic = session?.access_token === 'debug';

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

  const checkBackend = async () => {
    setCheckingBackend(true);
    setBackendError('');
    setBackendStatus(null);
    try {
      setBackendStatus(await getBackendStatus());
    } catch (error: any) {
      setBackendError(error.message || 'No se pudo consultar el backend.');
    } finally {
      setCheckingBackend(false);
    }
  };

  const handleClearDb = async () => {
    try {
      const db = await getDb();
      await db.execAsync(`
        DELETE FROM memory_entities;
        DELETE FROM entities;
        DELETE FROM memories;
        DELETE FROM inbox_tasks;
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
      const status = await getBackendStatus();
      setBackendStatus(status);
      if (!status.quotaReady || !status.secrets.openai) {
        throw new Error('Falta activar las cuotas o configurar OpenAI en Supabase.');
      }
      await processPendingMemories();
      const db = await getDb();
      const remaining = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM memories WHERE sync_status IN ('PENDING_AI', 'PROCESSING_AI')"
      );
      Alert.alert(
        remaining?.count ? 'Procesamiento pendiente' : 'IA procesada',
        remaining?.count
          ? `Quedan ${remaining.count} memorias pendientes. Revisa tu conexión y el estado del servicio antes de reintentar.`
          : 'No quedan memorias pendientes de procesar.'
      );
      await loadData();
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e.message || 'Fallo al procesar IA.');
    } finally {
      setLoading(false);
    }
  };
  
  const handleLogout = async () => {
    if (!isDiagnostic) {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) {
        Alert.alert('Error', 'No se pudo cerrar la sesión. Vuelve a intentarlo.');
        return;
      }
    }
    setSession(null);
  };

  return (
    <ScrollView style={styles.container}>
      <Title style={styles.title}>Panel Técnico (Admin)</Title>

      {/* Las claves privadas se administran únicamente en Supabase. */}
      <Card style={styles.configCard}>
        <Card.Content>
          <Title style={{fontSize: 16}}>Backend seguro</Title>
          <Text style={styles.configHint}>
            OpenAI y Google se consultan mediante una función de Supabase. Administra las claves en Edge Functions → Secrets, no en este dispositivo.
          </Text>
          <Text style={styles.savedKey}>Proyecto: {SUPABASE_URL}</Text>
          <Text style={styles.savedKey}>
            Sesión: {isDiagnostic ? 'diagnóstico local (66)' : session ? 'cuenta de Supabase' : 'sin sesión'}
          </Text>
          {isDiagnostic && (
            <Text style={styles.configHint}>
              El acceso 66 conserva el diagnóstico local. Para usar las APIs o comprobar el backend, sal e inicia sesión con una cuenta real.
            </Text>
          )}
          <Button mode="outlined" onPress={checkBackend} loading={checkingBackend} disabled={checkingBackend || loading} style={{marginVertical: 10}}>
            Comprobar backend
          </Button>
          {!!backendError && <Text style={styles.configHint}>{backendError}</Text>}
          {backendStatus && (
            <View>
              <Text style={styles.savedKey}>Función: conectada · versión {backendStatus.version}</Text>
              <Text style={styles.savedKey}>Cuotas: {backendStatus.quotaReady ? 'activas' : 'falta aplicar la migración'}</Text>
              <Text style={styles.savedKey}>Secreto OpenAI: {backendStatus.secrets.openai ? 'configurado' : 'falta configurar'}</Text>
              <Text style={styles.savedKey}>Secreto Google: {backendStatus.secrets.googleMaps ? 'configurado' : 'falta configurar'}</Text>
              <Text style={styles.configHint}>
                Esta comprobación no consume las APIs y no verifica si las claves son válidas. Las claves antiguas locales se conservan, pero la app ya no las usa.
              </Text>
            </View>
          )}
        </Card.Content>
      </Card>

      <Divider style={styles.divider} />

      {/* ── SECCIÓN: ACCIONES ── */}
      <View style={styles.buttonRow}>
        <Button mode="contained" onPress={loadData} disabled={loading} style={styles.actionBtn}>
          Refrescar
        </Button>
        <Button mode="contained" onPress={handleProcessAI} disabled={loading} style={styles.actionBtn} buttonColor="#6200ee">
          Forzar IA
        </Button>
      </View>
      <View style={styles.buttonRow}>
        <Button mode="outlined" onPress={() => Alert.alert('Borrar datos locales', 'Esta acción borra las memorias, entidades y tareas de este dispositivo. No se puede deshacer.', [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Borrar', style: 'destructive', onPress: handleClearDb },
        ])} disabled={loading} style={[styles.actionBtn, {borderColor: '#B00020'}]} textColor="#B00020">
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
            <Paragraph><Text style={{fontWeight: 'bold'}}>Inicio:</Text> {m.start_date || 'N/A'}</Paragraph>
            <Paragraph><Text style={{fontWeight: 'bold'}}>Fin:</Text> {m.end_date || 'N/A'}</Paragraph>
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
            <Paragraph><Text style={{fontWeight: 'bold'}}>Padre:</Text> {e.parent_id || 'Raíz'}</Paragraph>
            {e.type === 'LOCATION' && (
              <Paragraph><Text style={{fontWeight: 'bold'}}>Coords:</Text> {e.latitude != null && e.longitude != null ? `${e.latitude}, ${e.longitude}` : 'Sin ubicar'}</Paragraph>
            )}
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
  configCard: {
    backgroundColor: '#fff',
    marginBottom: 10,
    elevation: 2,
  },
  configHint: {
    fontSize: 12,
    color: '#8a3b00',
    marginBottom: 10,
    fontStyle: 'italic',
  },
  savedKey: {
    fontSize: 13,
    color: '#333',
    marginVertical: 2,
  },
  input: {
    marginBottom: 8,
    backgroundColor: '#fafafa',
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
  },
  envActiveBanner: {
    backgroundColor: '#e8f5e9',
    padding: 10,
    borderRadius: 6,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#a5d6a7',
  },
  envActiveBannerText: {
    fontSize: 12,
    color: '#2e7d32',
    lineHeight: 16,
    fontWeight: '500',
  },
  envTag: {
    color: '#2e7d32',
    fontWeight: 'bold',
    fontSize: 11,
  },
});

