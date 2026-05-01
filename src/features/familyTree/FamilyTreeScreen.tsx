import React, { useState, useEffect } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Appbar, Card, Avatar } from 'react-native-paper';
import { getDb } from '../../core/database';
import { useIsFocused } from '@react-navigation/native';

export default function FamilyTreeScreen({ navigation }: any) {
  const [people, setPeople] = useState<any[]>([]);
  const isFocused = useIsFocused();

  const loadPeople = async () => {
    try {
      const db = await getDb();
      // Fetch all entities of type PERSON and count how many memories they have
      // We will eventually use the recursive CTE here as well once groups are implemented
      const rows = await db.getAllAsync(`
        SELECT e.id, e.name, COUNT(me.memory_id) as mentions
        FROM entities e
        LEFT JOIN memory_entities me ON e.id = me.entity_id
        WHERE e.type = 'PERSON'
        GROUP BY e.id
        ORDER BY mentions DESC
      `);
      setPeople(rows);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (isFocused) {
      loadPeople();
    }
  }, [isFocused]);

  return (
    <View style={styles.container}>
      <Appbar.Header>
        <Appbar.Content title="Árbol Relacional" />
      </Appbar.Header>

      <FlatList
        data={people}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Card style={styles.card} onPress={() => navigation.navigate('EntityMemories', { entityId: item.id })}>
            <Card.Title
              title={item.name}
              subtitle={`${item.mentions} recuerdos`}
              left={(props) => <Avatar.Icon {...props} icon="account" />}
            />
          </Card>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text>No hay personas registradas aún. La IA extraerá los nombres de tus historias automáticamente.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  list: {
    padding: 16,
  },
  card: {
    marginBottom: 12,
  },
  empty: {
    padding: 20,
    alignItems: 'center',
  }
});
