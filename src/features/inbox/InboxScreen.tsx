import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import { Appbar, Card, Title, Paragraph, Button, Text } from 'react-native-paper';
import DateTimePicker from '@react-native-community/datetimepicker';
import { getDb } from '../../core/database';
import SmartDropdown from '../../components/SmartDropdown';
import { useIsFocused } from '@react-navigation/native';
import 'react-native-get-random-values';

const toDateStr = (d: Date) => d.toISOString().split('T')[0];

const RELATIONSHIP_ITEMS = [
  { id: 'Padre', name: 'Padre' },
  { id: 'Madre', name: 'Madre' },
  { id: 'Hermano/a', name: 'Hermano/a' },
  { id: 'Hijo/a', name: 'Hijo/a' },
  { id: 'Abuelo/a', name: 'Abuelo/a' },
  { id: 'Tío/a', name: 'Tío/a' },
  { id: 'Primo/a', name: 'Primo/a' },
  { id: 'Pareja', name: 'Pareja' },
  { id: 'Amigo/a', name: 'Amigo/a' },
  { id: 'Otro', name: 'Otro' },
];

export default function InboxScreen({ navigation }: any) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [resolvingTask, setResolvingTask] = useState<any>(null);

  // For DATE_UNCLEAR resolution
  const [resolveDate, setResolveDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);

  // For RELATIONSHIP resolution
  const [selectedRelationship, setSelectedRelationship] = useState('');

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
    setSelectedRelationship('');
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

  const resolveRelationshipTask = async () => {
    if (!resolvingTask || !selectedRelationship) {
      Alert.alert('Falta Selección', 'Por favor selecciona un tipo de relación.');
      return;
    }
    try {
      const db = await getDb();
      const entity = await db.getFirstAsync<any>("SELECT metadata, name FROM entities WHERE id = ?", resolvingTask.entity_id);
      if (entity) {
        const currentMeta = JSON.parse(entity.metadata || '{}');
        const updatedMeta = {
          ...currentMeta,
          relationship: selectedRelationship,
        };
        await db.runAsync(
          "UPDATE entities SET metadata = ? WHERE id = ?",
          JSON.stringify(updatedMeta),
          resolvingTask.entity_id
        );
        await db.runAsync("UPDATE inbox_tasks SET status = 'RESOLVED' WHERE id = ?", resolvingTask.id);
        setResolvingTask(null);
        setSelectedRelationship('');
        loadTasks();
        Alert.alert('Resuelto', `Relación con ${entity.name} asignada como: ${selectedRelationship}`);
      } else {
        Alert.alert('Error', 'No se encontró la entidad correspondiente.');
      }
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
  const relationshipTasks = tasks.filter(t => t.ambiguity_type === 'RELATIONSHIP');

  const renderDateTask = (task: any) => (
    <Card key={task.id} style={styles.card} mode="flat">
      <Card.Content>
        <Title style={{ fontSize: 15, fontWeight: 'bold' }}>📅 ¿Cuándo fue?</Title>
        <Paragraph style={styles.questionText}>{task.question}</Paragraph>
        <View style={styles.contextBox}>
          <Text style={styles.contextLabel}>Fragmento del Recuerdo:</Text>
          <Text style={styles.contextText}>"{task.raw_text}"</Text>
        </View>
      </Card.Content>

      {resolvingTask?.id === task.id ? (
        <Card.Content style={{ marginTop: 10 }}>
          <View>
            <Button 
              mode="outlined" 
              onPress={() => setShowDatePicker(true)} 
              icon="calendar"
              style={{ marginBottom: 12 }}
              textColor="#6200ee"
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
            <Button mode="contained" buttonColor="#6200ee" onPress={resolveDate_task}>Asignar Fecha</Button>
          </View>
          <Button onPress={() => setResolvingTask(null)} style={{ marginTop: 8 }} textColor="#6c757d">Cancelar</Button>
        </Card.Content>
      ) : (
        <Card.Actions style={styles.cardActions}>
          <Button onPress={() => startResolve(task)} textColor="#6200ee">Resolver</Button>
          <Button textColor="#868e96" onPress={() => dismissTask(task.id)}>Ignorar</Button>
        </Card.Actions>
      )}
    </Card>
  );

  const renderRelationshipTask = (task: any) => (
    <Card key={task.id} style={styles.card} mode="flat">
      <Card.Content>
        <Title style={{ fontSize: 15, fontWeight: 'bold' }}>👥 Relación Familiar Pendiente</Title>
        <Paragraph style={styles.questionText}>{task.question}</Paragraph>
      </Card.Content>

      {resolvingTask?.id === task.id ? (
        <Card.Content style={{ marginTop: 10 }}>
          <View style={{ marginBottom: 16 }}>
            <SmartDropdown
              label="Tipo de Relación"
              value={selectedRelationship}
              items={RELATIONSHIP_ITEMS}
              onSelect={(item) => {
                if (item) setSelectedRelationship(item.name);
              }}
              onCreateNew={(name) => setSelectedRelationship(name)}
              placeholder="Elige parentesco..."
              enablePlaces={false}
            />
          </View>
          <Button mode="contained" buttonColor="#2e7d32" onPress={resolveRelationshipTask}>Confirmar Relación</Button>
          <Button onPress={() => { setResolvingTask(null); setSelectedRelationship(''); }} style={{ marginTop: 8 }} textColor="#6c757d">Cancelar</Button>
        </Card.Content>
      ) : (
        <Card.Actions style={styles.cardActions}>
          <Button onPress={() => startResolve(task)} textColor="#2e7d32">Resolver</Button>
          <Button textColor="#868e96" onPress={() => dismissTask(task.id)}>Ignorar</Button>
        </Card.Actions>
      )}
    </Card>
  );

  return (
    <View style={styles.container}>
      <Appbar.Header style={styles.appbar}>
        <Appbar.Content title={`Buzón (${tasks.length})`} titleStyle={styles.headerTitle} />
      </Appbar.Header>
      
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {tasks.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>✅</Text>
            <Text style={styles.emptyTitle}>¡Todo al día!</Text>
            <Text style={styles.emptySubtitle}>No tienes tareas ni ambigüedades pendientes por resolver.</Text>
          </View>
        ) : (
          <View>
            {dateTasks.length > 0 && (
              <View style={styles.section}>
                <Title style={styles.sectionTitle}>📅 Fechas por Aclarar</Title>
                {dateTasks.map(renderDateTask)}
              </View>
            )}

            {relationshipTasks.length > 0 && (
              <View style={styles.section}>
                <Title style={styles.sectionTitle}>👥 Relaciones por Aclarar</Title>
                {relationshipTasks.map(renderRelationshipTask)}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  appbar: {
    backgroundColor: '#ffffff',
    elevation: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f3f5',
  },
  headerTitle: {
    fontWeight: 'bold',
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 16,
  },
  card: {
    marginBottom: 16,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e9ecef',
    elevation: 0,
  },
  questionText: {
    fontSize: 14,
    color: '#495057',
    marginTop: 4,
  },
  contextBox: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#f1f3f9',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#6200ee',
  },
  contextLabel: {
    fontWeight: 'bold',
    fontSize: 11,
    color: '#6200ee',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  contextText: {
    fontStyle: 'italic',
    color: '#495057',
    fontSize: 13,
    lineHeight: 18,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212529',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  cardActions: {
    borderTopWidth: 1,
    borderTopColor: '#f1f3f5',
    justifyContent: 'flex-end',
    paddingHorizontal: 8,
  },
  empty: {
    paddingVertical: 80,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#212529',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#868e96',
    textAlign: 'center',
    lineHeight: 20,
  },
});
