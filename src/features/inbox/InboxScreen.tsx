import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import { Appbar, Card, Title, Paragraph, Button, Text, TextInput } from 'react-native-paper';
import DateTimePicker from '@react-native-community/datetimepicker';
import { getDb, inheritCoordinatesFromParent } from '../../core/database';
import SmartDropdown from '../../components/SmartDropdown';
import { useIsFocused } from '@react-navigation/native';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

const toDateStr = (d: Date) => d.toISOString().split('T')[0];

export default function InboxScreen({ navigation }: any) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [resolvingTask, setResolvingTask] = useState<any>(null);

  // For DATE_UNCLEAR resolution
  const [resolveDate, setResolveDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);

  // For LOCATION_UNCLEAR resolution
  const [resolveParentId, setResolveParentId] = useState<string | null>(null);

  const isFocused = useIsFocused();

  const loadTasks = async () => {
    try {
      const db = await getDb();
      const rows = await db.getAllAsync<any>(`
        SELECT it.*, m.raw_text
        FROM inbox_tasks it
        LEFT JOIN memories m ON it.memory_id = m.id
        WHERE it.status = 'PENDING'
        ORDER BY it.created_at DESC
      `);
      setTasks(rows);

      const locs = await db.getAllAsync<any>(
        "SELECT id, name FROM entities WHERE type = 'LOCATION' ORDER BY name"
      );
      setLocations(locs.map(l => ({ id: l.id, name: l.name, score: 0 })));
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (isFocused) loadTasks();
  }, [isFocused]);

  const startResolve = (task: any) => {
    setResolvingTask(task);
    setResolveDate(new Date());
    setResolveParentId(null);
    setShowDatePicker(false);
  };

  const resolveDate_task = async () => {
    if (!resolvingTask) return;
    try {
      const db = await getDb();
      const dateStr = toDateStr(resolveDate);
      await db.runAsync(
        "UPDATE memories SET start_date = ?, end_date = ? WHERE id = ?",
        dateStr, dateStr, resolvingTask.memory_id
      );
      await db.runAsync("UPDATE inbox_tasks SET status = 'RESOLVED' WHERE id = ?", resolvingTask.id);
      setResolvingTask(null);
      loadTasks();
      Alert.alert('Resuelto', `Fecha asignada: ${dateStr}`);
    } catch (e) {
      console.error(e);
    }
  };

  const resolveLocation_task = async () => {
    if (!resolvingTask || !resolveParentId) {
      Alert.alert('Atención', 'Selecciona o crea un lugar padre.');
      return;
    }
    try {
      const db = await getDb();
      // resolvingTask for LOCATION_UNCLEAR has entity_id
      if (resolvingTask.entity_id) {
        await db.runAsync("UPDATE entities SET parent_id = ? WHERE id = ?", resolveParentId, resolvingTask.entity_id);
        await inheritCoordinatesFromParent(resolvingTask.entity_id, resolveParentId);
      } else if (resolvingTask.ambiguity_type === 'MEMORY_LOCATION_UNCLEAR') {
        // If it's a memory location unclear, and user selects a parent? 
        // No, for memory location unclear, they are selecting a general location for the memory.
        // So we link the selected 'parent' (which is just a location) to the memory.
        const pivotId = uuidv4();
        await db.runAsync(
          "INSERT INTO memory_entities (id, memory_id, entity_id, relationship_type) VALUES (?, ?, ?, ?)",
          pivotId, resolvingTask.memory_id, resolveParentId, 'MENTIONED'
        );
      }

      await db.runAsync("UPDATE inbox_tasks SET status = 'RESOLVED' WHERE id = ?", resolvingTask.id);
      setResolvingTask(null);
      loadTasks();
      Alert.alert('Resuelto', 'Jerarquía de lugar asignada.');
    } catch (e) {
      console.error(e);
    }
  };

  const dismissTask = async (taskId: string) => {
    try {
      const db = await getDb();
      await db.runAsync("UPDATE inbox_tasks SET status = 'DISMISSED' WHERE id = ?", taskId);
      loadTasks();
    } catch (e) {
      console.error(e);
    }
  };

  const acceptConfirmation_task = async (taskId: string) => {
    try {
      const db = await getDb();
      await db.runAsync("UPDATE inbox_tasks SET status = 'RESOLVED' WHERE id = ?", taskId);
      loadTasks();
    } catch (e) {
      console.error(e);
    }
  };

  const dateTasks = tasks.filter(t => t.ambiguity_type === 'DATE_UNCLEAR');
  const locationTasks = tasks.filter(t => t.ambiguity_type === 'LOCATION_UNCLEAR' || t.ambiguity_type === 'MEMORY_LOCATION_UNCLEAR');
  const confirmationTasks = tasks.filter(t => t.ambiguity_type === 'LOCATION_CONFIRMATION');

  const renderTask = (task: any) => (
    <Card key={task.id} style={styles.card}>
      <Card.Content>
        <Title style={{fontSize: 15}}>
          {task.ambiguity_type === 'DATE_UNCLEAR' ? '📅 ¿Cuándo fue?' 
            : task.ambiguity_type === 'MEMORY_LOCATION_UNCLEAR' ? '🗺️ ¿Dónde ocurrió?'
            : task.ambiguity_type === 'LOCATION_CONFIRMATION' ? '✅ Confirmar Ubicación'
            : '📍 Lugar sin ubicar'}
        </Title>
        <Paragraph>{task.question}</Paragraph>
        <View style={styles.contextBox}>
          <Text style={styles.contextLabel}>Fragmento del Recuerdo:</Text>
          <Text style={styles.contextText}>"{task.raw_text}"</Text>
        </View>
      </Card.Content>

      {resolvingTask?.id === task.id ? (
        <Card.Content style={{marginTop: 10}}>
          {task.ambiguity_type === 'DATE_UNCLEAR' ? (
            <View>
              <Button 
                mode="outlined" 
                onPress={() => setShowDatePicker(true)} 
                icon="calendar"
                style={{marginBottom: 8}}
              >
                Fecha: {toDateStr(resolveDate)}
              </Button>
              {showDatePicker && (
                <DateTimePicker
                  value={resolveDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(event, date) => {
                    if (Platform.OS === 'android') setShowDatePicker(false);
                    if (date) setResolveDate(date);
                  }}
                />
              )}
              <Button mode="contained" onPress={resolveDate_task}>Asignar Fecha</Button>
            </View>
          ) : (
            <View>
              <Text style={{marginBottom: 8, color: '#666'}}>
                {task.ambiguity_type === 'MEMORY_LOCATION_UNCLEAR' 
                  ? 'Selecciona el lugar donde ocurrió este recuerdo, o crea uno nuevo.'
                  : '¿A qué lugar mayor pertenece? (Ej: "Arenero" pertenece a "Colegio")'}
              </Text>
              <SmartDropdown
                label={task.ambiguity_type === 'MEMORY_LOCATION_UNCLEAR' ? "Lugar del recuerdo" : "Lugar padre (ej: Colegio, Casa...)"}
                value=""
                items={locations}
                onSelect={(item) => setResolveParentId(item?.id || null)}
                onCreateNew={async (name) => {
                  const db = await getDb();
                  const newId = uuidv4();
                  await db.runAsync("INSERT INTO entities (id, type, name) VALUES (?, 'LOCATION', ?)", newId, name);
                  setResolveParentId(newId);
                  loadTasks(); // refresh locations list
                }}
                placeholder="Buscar lugar existente..."
              />
              <Button mode="contained" onPress={resolveLocation_task} style={{marginTop: 8}}>
                {task.ambiguity_type === 'MEMORY_LOCATION_UNCLEAR' ? 'Asignar Lugar' : 'Asignar Lugar Padre'}
              </Button>
              
              {(task.ambiguity_type === 'LOCATION_UNCLEAR' || task.ambiguity_type === 'LOCATION_CONFIRMATION') && (
                <Button 
                  mode="outlined" 
                  icon="map"
                  onPress={() => {
                    setResolvingTask(null);
                    navigation.navigate('Atlas', { placingEntityId: task.entity_id });
                  }} 
                  style={{marginTop: 8}}
                >
                  Ubicar en el Mapa directamente
                </Button>
              )}
            </View>
          )}
          <Button onPress={() => setResolvingTask(null)} style={{marginTop: 5}}>Cancelar</Button>
        </Card.Content>
      ) : (
        <Card.Actions>
          {task.ambiguity_type === 'LOCATION_CONFIRMATION' && (
            <Button mode="contained" onPress={() => acceptConfirmation_task(task.id)}>
              Sí, es correcto
            </Button>
          )}
          <Button onPress={() => startResolve(task)}>
            {task.ambiguity_type === 'LOCATION_CONFIRMATION' ? 'Cambiar / Reubicar' : 'Resolver'}
          </Button>
          <Button textColor="#999" onPress={() => dismissTask(task.id)}>Ignorar</Button>
        </Card.Actions>
      )}
    </Card>
  );

  return (
    <View style={styles.container}>
      <Appbar.Header>
        <Appbar.Content title={`Buzón (${tasks.length})`} />
      </Appbar.Header>
      
      <ScrollView style={styles.list}>
        {tasks.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>✅</Text>
            <Text>No tienes tareas pendientes.</Text>
          </View>
        ) : (
          <View>
            {confirmationTasks.length > 0 && (
              <View style={styles.section}>
                <Title style={styles.sectionTitle}>✅ Confirmaciones del Sistema</Title>
                {confirmationTasks.map(renderTask)}
              </View>
            )}

            {locationTasks.length > 0 && (
              <View style={styles.section}>
                <Title style={styles.sectionTitle}>🗺️ Ubicaciones Pendientes</Title>
                {locationTasks.map(renderTask)}
              </View>
            )}

            {dateTasks.length > 0 && (
              <View style={styles.section}>
                <Title style={styles.sectionTitle}>📅 Fechas por Aclarar</Title>
                {dateTasks.map(renderTask)}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  list: { padding: 10 },
  card: { marginBottom: 12, backgroundColor: '#fff' },
  empty: { padding: 40, alignItems: 'center' },
  emptyIcon: { fontSize: 40, marginBottom: 10 },
  contextBox: {
    marginTop: 10, padding: 10,
    backgroundColor: '#f8f8f8', borderRadius: 5,
    borderLeftWidth: 3, borderLeftColor: '#6200ee',
  },
  contextLabel: { fontWeight: 'bold', fontSize: 12, color: '#6200ee', marginBottom: 4 },
  contextText: { fontStyle: 'italic', color: '#555', fontSize: 13 },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#333', marginBottom: 10, paddingHorizontal: 5 },
});

