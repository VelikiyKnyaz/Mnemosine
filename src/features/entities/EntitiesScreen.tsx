import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Appbar, Card, Text, Button, TextInput, Menu, Chip, IconButton } from 'react-native-paper';
import { getDb } from '../../core/database';
import SmartDropdown from '../../components/SmartDropdown';
import { useIsFocused } from '@react-navigation/native';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

const TYPES = ['PERSON', 'LOCATION', 'EVENT', 'OBJECT'] as const;
type EntityType = typeof TYPES[number];

const typeEmoji: Record<string, string> = {
  PERSON: '👤', LOCATION: '📍', EVENT: '🎯', OBJECT: '📦',
};

export default function EntitiesScreen() {
  const [entities, setEntities] = useState<any[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<EntityType>('LOCATION');
  const [editParentId, setEditParentId] = useState<string | null>(null);
  const [typeMenuVisible, setTypeMenuVisible] = useState(false);
  const [filterType, setFilterType] = useState<string>('ALL');
  const isFocused = useIsFocused();

  const loadEntities = async () => {
    try {
      const db = await getDb();
      const rows = await db.getAllAsync<any>(`
        SELECT e.*, p.name as parent_name 
        FROM entities e 
        LEFT JOIN entities p ON e.parent_id = p.id
        ORDER BY e.type, e.name
      `);
      setEntities(rows);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (isFocused) loadEntities();
  }, [isFocused]);

  const startEdit = (entity: any) => {
    setEditingId(entity.id);
    setEditName(entity.name);
    setEditType(entity.type as EntityType);
    setEditParentId(entity.parent_id || null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditParentId(null);
  };

  const saveEdit = async () => {
    if (!editName.trim()) return;
    try {
      const db = await getDb();
      await db.runAsync(
        'UPDATE entities SET name = ?, type = ?, parent_id = ? WHERE id = ?',
        editName.trim(), editType, editParentId, editingId
      );
      cancelEdit();
      loadEntities();
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e?.message || 'No se pudo actualizar.');
    }
  };

  const deleteEntity = async (id: string) => {
    Alert.alert('Eliminar', '¿Eliminar esta entidad permanentemente?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar', style: 'destructive', onPress: async () => {
          try {
            const db = await getDb();
            await db.runAsync('DELETE FROM memory_entities WHERE entity_id = ?', id);
            await db.runAsync('UPDATE entities SET parent_id = NULL WHERE parent_id = ?', id);
            await db.runAsync('DELETE FROM entities WHERE id = ?', id);
            loadEntities();
          } catch (e) {
            console.error(e);
          }
        }
      }
    ]);
  };

  const getParentOptions = (excludeId?: string) => {
    return entities
      .filter(e => e.id !== excludeId)
      .map(e => ({
        id: e.id,
        name: `${typeEmoji[e.type] || ''} ${e.name}`,
        score: e.parent_id ? 0 : 1,
      }));
  };

  const filtered = filterType === 'ALL' ? entities : entities.filter(e => e.type === filterType);

  return (
    <View style={styles.container}>
      <Appbar.Header>
        <Appbar.Content title="Elementos" />
      </Appbar.Header>

      <View style={styles.filterRow}>
        {['ALL', ...TYPES].map(t => (
          <Chip 
            key={t} 
            selected={filterType === t}
            onPress={() => setFilterType(t)}
            style={styles.filterChip}
          >
            {t === 'ALL' ? 'Todos' : `${typeEmoji[t] || ''} ${t}`}
          </Chip>
        ))}
      </View>

      <ScrollView style={styles.list}>
        {filtered.map(entity => (
          <Card key={entity.id} style={styles.card}>
            {editingId === entity.id ? (
              <Card.Content>
                <TextInput
                  label="Nombre"
                  value={editName}
                  onChangeText={setEditName}
                  mode="outlined"
                  dense
                  style={{marginBottom: 8}}
                />

                <Menu
                  visible={typeMenuVisible}
                  onDismiss={() => setTypeMenuVisible(false)}
                  anchor={
                    <Button mode="outlined" onPress={() => setTypeMenuVisible(true)} style={{marginBottom: 8}}>
                      Tipo: {typeEmoji[editType]} {editType}
                    </Button>
                  }
                >
                  {TYPES.map(t => (
                    <Menu.Item 
                      key={t}
                      onPress={() => { setEditType(t); setTypeMenuVisible(false); }} 
                      title={`${typeEmoji[t]} ${t}`} 
                    />
                  ))}
                </Menu>

                <SmartDropdown
                  label="Es parte de (padre)"
                  value={entities.find(e => e.id === editParentId)?.name || ''}
                  items={getParentOptions(entity.id)}
                  onSelect={(item) => setEditParentId(item?.id || null)}
                  onCreateNew={async (name) => {
                    try {
                      const db = await getDb();
                      const newId = uuidv4();
                      await db.runAsync("INSERT INTO entities (id, type, name) VALUES (?, 'LOCATION', ?)", newId, name);
                      setEditParentId(newId);
                      loadEntities();
                    } catch (e) {
                      console.error(e);
                    }
                  }}
                  placeholder="Buscar o crear lugar padre..."
                />

                <View style={styles.editActions}>
                  <Button onPress={cancelEdit} style={{marginRight: 8}}>Cancelar</Button>
                  <Button mode="contained" onPress={saveEdit}>Guardar</Button>
                </View>
              </Card.Content>
            ) : (
              <Card.Content style={styles.entityRow}>
                <View style={{flex: 1}}>
                  <Text style={{fontWeight: 'bold'}}>{typeEmoji[entity.type] || '?'} {entity.name}</Text>
                  {entity.parent_name && (
                    <Text style={styles.parentHint}>↳ parte de: {entity.parent_name}</Text>
                  )}
                </View>
                <View style={styles.rowActions}>
                  <IconButton icon="pencil" size={18} onPress={() => startEdit(entity)} />
                  <IconButton icon="delete" size={18} iconColor="#B00020" onPress={() => deleteEntity(entity.id)} />
                </View>
              </Card.Content>
            )}
          </Card>
        ))}

        {filtered.length === 0 && (
          <View style={styles.empty}>
            <Text>No hay elementos registrados.</Text>
          </View>
        )}
        <View style={{height: 20}} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  filterRow: {
    flexDirection: 'row', padding: 10,
    flexWrap: 'wrap',
  },
  filterChip: { marginBottom: 4, marginRight: 6 },
  list: { flex: 1, padding: 10 },
  card: { marginBottom: 8, backgroundColor: '#fff' },
  entityRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
  },
  parentHint: { fontSize: 12, color: '#666', marginTop: 2 },
  rowActions: { flexDirection: 'row' },
  editActions: {
    flexDirection: 'row', justifyContent: 'flex-end',
    marginTop: 10,
  },
  empty: { padding: 20, alignItems: 'center' },
});

