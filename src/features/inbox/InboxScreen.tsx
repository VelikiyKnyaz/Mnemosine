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

  const dismissTask = async (taskId: string) => {
    try {
      const db = await getDb();
      await db.runAsync("UPDATE inbox_tasks SET status = 'DISMISSED' WHERE id = ?", taskId);
      loadTasks();
    } catch (e) {
      console.error(e);
    }
  };

  const dateTasks = tasks.filter(t => t.ambiguity_type === 'DATE_UNCLEAR');

  const renderTask = (task: any) => (
    <Card key={task.id} style={styles.card}>
      <Card.Content>
        <Title style={{fontSize: 15}}>📅 ¿Cuándo fue?</Title>
        <Paragraph>{task.question}</Paragraph>
        <View style={styles.contextBox}>
          <Text style={styles.contextLabel}>Fragmento del Recuerdo:</Text>
          <Text style={styles.contextText}>"{task.raw_text}"</Text>
        </View>
      </Card.Content>

      {resolvingTask?.id === task.id ? (
        <Card.Content style={{marginTop: 10}}>
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
          <Button onPress={() => setResolvingTask(null)} style={{marginTop: 5}}>Cancelar</Button>
        </Card.Content>
      ) : (
        <Card.Actions>
          <Button onPress={() => startResolve(task)}>Resolver</Button>
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

