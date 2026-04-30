import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import { Appbar, Card, Title, Paragraph, Button, Text, TextInput } from 'react-native-paper';
import DateTimePicker from '@react-native-community/datetimepicker';
import { getDb } from '../../core/database';
import SmartDropdown from '../../components/SmartDropdown';
import { useIsFocused } from '@react-navigation/native';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

const toDateStr = (d: Date) => d.toISOString().split('T')[0];

export default function InboxScreen() {
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
        SELECT it.*, m.raw_text, m.title as memory_title
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
      // Find entities linked to this memory that are LOCATIONs without parents
      const memEntities = await db.getAllAsync<any>(`
        SELECT e.id FROM entities e
        JOIN memory_entities me ON me.entity_id = e.id
        WHERE me.memory_id = ? AND e.type = 'LOCATION' AND e.parent_id IS NULL
      `, resolvingTask.memory_id);

      for (const ent of memEntities) {
        await db.runAsync("UPDATE entities SET parent_id = ? WHERE id = ?", resolveParentId, ent.id);
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

  return (
    <View style={styles.container}>
      <Appbar.Header>
        <Appbar.Content title={`Buzón (${tasks.length})`} />
      </Appbar.Header>
      
      <ScrollView style={styles.list}>
        {tasks.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>✅</Text>
            <Text>No tienes preguntas pendientes.</Text>
          </View>
        ) : (
          tasks.map(task => (
            <Card key={task.id} style={styles.card}>
              <Card.Content>
                <Title style={{fontSize: 15}}>
                  {task.ambiguity_type === 'DATE_UNCLEAR' ? '📅 ¿Cuándo fue?' 
                    : task.ambiguity_type === 'ENTITY_AMBIGUOUS' ? '🧩 ¿Dónde pertenece?'
                    : '📍 ¿Dónde fue?'}
                </Title>
                <Paragraph>{task.question}</Paragraph>
                <View style={styles.contextBox}>
                  <Text style={styles.contextLabel}>{task.memory_title || 'Recuerdo'}</Text>
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
                        ¿A qué lugar pertenece? Selecciona el lugar padre o crea uno nuevo.
                      </Text>
                      <SmartDropdown
                        label="Lugar padre (ej: Colegio, Casa...)"
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
                        Asignar Lugar Padre
                      </Button>
                    </View>
                  )}
                  <Button onPress={() => setResolvingTask(null)} style={{marginTop: 5}}>Cancelar</Button>
                </Card.Content>
              ) : (
                <Card.Actions>
                  <Button onPress={() => startResolve(task)}>Resolver</Button>
                  <Button textColor="#999" onPress={() => dismissTask(task.id)}>Ignorar</Button>
                </Card.Actions>
              )}
            </Card>
          ))
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
});

