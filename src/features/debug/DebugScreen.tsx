import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Button, Text, Card, Title, Paragraph, Divider, TextInput } from 'react-native-paper';
import { getDb } from '../../core/database';
import { processPendingMemories } from '../../core/ai_processor';
import { useAuthStore } from '../../core/store';
import { getAllConfig, setConfig } from '../../core/config';

export default function DebugScreen() {
  const [memories, setMemories] = useState<any[]>([]);
  const [entities, setEntities] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const setSession = useAuthStore(state => state.setSession);

  // Config keys state
  const [openaiKey, setOpenaiKey] = useState('');
  const [googleMapsKey, setGoogleMapsKey] = useState('');
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState('');
  const [configSaved, setConfigSaved] = useState(false);

  // Variables de entorno de Expo activas
  const isEnvOpenai = !!process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  const isEnvGoogleMaps = !!process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY;
  const isEnvSupabaseUrl = !!process.env.EXPO_PUBLIC_SUPABASE_URL;
  const isEnvSupabaseKey = !!process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

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

  const loadConfig = async () => {
    const cfg = await getAllConfig();
    setOpenaiKey(cfg.OPENAI_API_KEY || '');
    setGoogleMapsKey(cfg.GOOGLE_MAPS_KEY || '');
    setSupabaseUrl(cfg.SUPABASE_URL || '');
    setSupabaseAnonKey(cfg.SUPABASE_ANON_KEY || '');
    setConfigSaved(!!cfg.OPENAI_API_KEY);
  };

  useEffect(() => {
    loadData();
    loadConfig();
  }, []);

  const handleSaveConfig = async () => {
    await setConfig('OPENAI_API_KEY', openaiKey.trim());
    await setConfig('GOOGLE_MAPS_KEY', googleMapsKey.trim());
    await setConfig('SUPABASE_URL', supabaseUrl.trim());
    await setConfig('SUPABASE_ANON_KEY', supabaseAnonKey.trim());
    setConfigSaved(true);
    Alert.alert('Guardado', 'Claves guardadas localmente en el dispositivo.');
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
      await processPendingMemories();
      Alert.alert('IA Procesada', 'Se procesaron las memorias pendientes con éxito.');
      loadData();
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e.message || 'Fallo al procesar IA.');
    } finally {
      setLoading(false);
    }
  };
  
  const handleLogout = () => {
    setSession(null);
  };

  const maskKey = (key: string) => key ? key.slice(0, 8) + '...' + key.slice(-4) : '(vacía)';

  return (
    <ScrollView style={styles.container}>
      <Title style={styles.title}>Panel Técnico (Admin)</Title>

      {/* ── SECCIÓN: CONFIGURACIÓN DE CLAVES ── */}
      <Card style={styles.configCard}>
        <Card.Content>
          <Title style={{fontSize: 16}}>🔑 Configuración de Claves</Title>
          
          {(isEnvOpenai || isEnvGoogleMaps || isEnvSupabaseUrl || isEnvSupabaseKey) && (
            <View style={styles.envActiveBanner}>
              <Text style={styles.envActiveBannerText}>
                🎉 Variables de entorno de Expo detectadas. Las claves marcadas con [Entorno] se cargan automáticamente desde la consola de Expo.
              </Text>
            </View>
          )}

          {configSaved ? (
            <View>
              <Text style={styles.savedKey}>
                OpenAI: {maskKey(openaiKey)} {isEnvOpenai && <Text style={styles.envTag}>[Entorno]</Text>}
              </Text>
              <Text style={styles.savedKey}>
                Google Maps: {maskKey(googleMapsKey)} {isEnvGoogleMaps && <Text style={styles.envTag}>[Entorno]</Text>}
              </Text>
              <Text style={styles.savedKey}>
                Supabase URL: {maskKey(supabaseUrl)} {isEnvSupabaseUrl && <Text style={styles.envTag}>[Entorno]</Text>}
              </Text>
              <Text style={styles.savedKey}>
                Supabase Key: {maskKey(supabaseAnonKey)} {isEnvSupabaseKey && <Text style={styles.envTag}>[Entorno]</Text>}
              </Text>
              <Button mode="text" onPress={() => setConfigSaved(false)} style={{marginTop: 5}}>
                Editar / Sobrescribir Claves
              </Button>
            </View>
          ) : (
            <View>
              <TextInput
                label={`OpenAI API Key (sk-proj-...)${isEnvOpenai ? ' [Entorno]' : ''}`}
                value={openaiKey}
                onChangeText={setOpenaiKey}
                style={styles.input}
                secureTextEntry
                dense
                disabled={isEnvOpenai}
              />
              <TextInput
                label={`Google Maps API Key${isEnvGoogleMaps ? ' [Entorno]' : ''}`}
                value={googleMapsKey}
                onChangeText={setGoogleMapsKey}
                style={styles.input}
                secureTextEntry
                dense
                disabled={isEnvGoogleMaps}
              />
              <TextInput
                label={`Supabase URL${isEnvSupabaseUrl ? ' [Entorno]' : ''}`}
                value={supabaseUrl}
                onChangeText={setSupabaseUrl}
                style={styles.input}
                dense
                disabled={isEnvSupabaseUrl}
              />
              <TextInput
                label={`Supabase Anon Key${isEnvSupabaseKey ? ' [Entorno]' : ''}`}
                value={supabaseAnonKey}
                onChangeText={setSupabaseAnonKey}
                style={styles.input}
                secureTextEntry
                dense
                disabled={isEnvSupabaseKey}
              />
              <Button mode="contained" onPress={handleSaveConfig} style={{marginTop: 10}} buttonColor="#2e7d32">
                Guardar Sobrescritura en Dispositivo
              </Button>
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
        <Button mode="outlined" onPress={handleClearDb} disabled={loading} style={[styles.actionBtn, {borderColor: '#B00020'}]} textColor="#B00020">
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
            <Paragraph><Text style={{fontWeight: 'bold'}}>Padre:</Text> {e.parent_id || 'Raíz'}</Paragraph>
            {e.type === 'LOCATION' && (
              <Paragraph><Text style={{fontWeight: 'bold'}}>Coords:</Text> {e.latitude ? `${e.latitude}, ${e.longitude}` : 'Sin ubicar'}</Paragraph>
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
    color: '#666',
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

