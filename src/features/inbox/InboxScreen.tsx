import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Appbar, Card, Title, Paragraph, Button, Text } from 'react-native-paper';
import { getDb } from '../../core/database';
import { useIsFocused } from '@react-navigation/native';

export default function InboxScreen({ navigation }: any) {
  const [tasks, setTasks] = useState<any[]>([]);
  const isFocused = useIsFocused();

  const loadTasks = async () => {
    try {
      const db = await getDb();
      const rows = await db.getAllAsync(`
        SELECT it.*, m.raw_text, e.name as entity_name
        FROM inbox_tasks it
        LEFT JOIN memories m ON it.memory_id = m.id
        LEFT JOIN entities e ON it.entity_id = e.id
        WHERE it.status = 'PENDING'
      `);
      setTasks(rows);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (isFocused) loadTasks();
  }, [isFocused]);

  const resolveTask = async (taskId: string) => {
    // Aquí se abriría un modal para editar la fecha de la memoria o la entidad.
    // Para simplificar este MVP, marcaremos la tarea como resuelta.
    try {
      const db = await getDb();
      await db.runAsync("UPDATE inbox_tasks SET status = 'RESOLVED' WHERE id = ?", taskId);
      loadTasks();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <View style={styles.container}>
      <Appbar.Header>
        <Appbar.Content title="Buzón de Ambigüedades" />
      </Appbar.Header>
      
      <ScrollView style={styles.list}>
        {tasks.length === 0 ? (
          <View style={styles.empty}>
            <Text>No tienes preguntas pendientes de la IA.</Text>
          </View>
        ) : (
          tasks.map(task => (
            <Card key={task.id} style={styles.card}>
              <Card.Content>
                <Title>Duda de la IA</Title>
                <Paragraph>{task.question}</Paragraph>
                <View style={styles.contextBox}>
                  <Text style={styles.contextText}>"{task.raw_text}"</Text>
                </View>
              </Card.Content>
              <Card.Actions>
                <Button onPress={() => resolveTask(task.id)}>Resolver Ahora</Button>
              </Card.Actions>
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5'
  },
  list: {
    padding: 10,
  },
  card: {
    marginBottom: 10,
  },
  empty: {
    padding: 20,
    alignItems: 'center',
  },
  contextBox: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#f0f0f0',
    borderRadius: 5,
    borderLeftWidth: 3,
    borderLeftColor: '#6200ee'
  },
  contextText: {
    fontStyle: 'italic',
    color: '#555'
  }
});
