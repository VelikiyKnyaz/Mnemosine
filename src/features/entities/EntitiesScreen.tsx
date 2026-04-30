import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { Appbar, Card, Text, Button, TextInput, Chip, IconButton } from 'react-native-paper';
import { getDb, inheritCoordinatesFromParent } from '../../core/database';
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
  const [parentSearch, setParentSearch] = useState('');
  const [showParentList, setShowParentList] = useState(false);
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
    setParentSearch(entity.parent_name || '');
    setShowParentList(false);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditParentId(null);
    setParentSearch('');
    setShowParentList(false);
  };

  const saveEdit = async () => {
    if (!editName.trim()) return;
    try {
      const db = await getDb();
      await db.runAsync(
        'UPDATE entities SET name = ?, type = ?, parent_id = ? WHERE id = ?',
        editName.trim(), editType, editParentId, editingId
      );
      
      if (editParentId && editType === 'LOCATION' && editingId) {
        await inheritCoordinatesFromParent(editingId, editParentId);
      }
      
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
            if (editingId === id) cancelEdit();
            loadEntities();
          } catch (e) {
            console.error(e);
          }
        }
      }
    ]);
  };

  const parentOptions = useMemo(() => {
    const q = parentSearch.toLowerCase();
    return entities
      .filter(e => e.id !== editingId)
      .filter(e => !q || e.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [entities, editingId, parentSearch]);

  const selectParent = (entity: any) => {
    setEditParentId(entity.id);
    setParentSearch(entity.name);
    setShowParentList(false);
  };

  const clearParent = () => {
    setEditParentId(null);
    setParentSearch('');
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
            {t === 'ALL' ? 'Todos' : `${typeEmoji[t]} ${t}`}
          </Chip>
        ))}
      </View>

      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
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
                  style={{marginBottom: 10}}
                />

                <Text style={{fontSize: 12, color: '#666', marginBottom: 6}}>Tipo:</Text>
                <View style={styles.typeRow}>
                  {TYPES.map(t => (
                    <Chip
                      key={t}
                      selected={editType === t}
                      onPress={() => setEditType(t)}
                      style={styles.typeChip}
                    >
                      {typeEmoji[t]} {t}
                    </Chip>
                  ))}
                </View>

                <Text style={{fontSize: 12, color: '#666', marginTop: 10, marginBottom: 6}}>Es parte de:</Text>
                <View style={{flexDirection: 'row', alignItems: 'center'}}>
                  <TextInput
                    value={parentSearch}
                    onChangeText={(text) => {
                      setParentSearch(text);
                      setShowParentList(true);
                      if (!text.trim()) setEditParentId(null);
                    }}
                    onFocus={() => setShowParentList(true)}
                    placeholder="Buscar lugar padre..."
                    mode="outlined"
                    dense
                    style={{flex: 1}}
                  />
                  {parentSearch.trim() !== '' && (
                    <IconButton icon="close" size={18} onPress={clearParent} />
                  )}
                </View>

                {showParentList && parentOptions.length > 0 && (
                  <View style={styles.suggestionBox}>
                    {parentOptions.map(opt => (
                      <TouchableOpacity 
                        key={opt.id} 
                        style={styles.suggestionItem}
                        onPress={() => selectParent(opt)}
                      >
                        <Text>{typeEmoji[opt.type] || ''} {opt.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

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
  typeRow: { flexDirection: 'row', flexWrap: 'wrap' },
  typeChip: { marginRight: 6, marginBottom: 4 },
  suggestionBox: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    marginTop: 4,
    maxHeight: 180,
  },
  suggestionItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  editActions: {
    flexDirection: 'row', justifyContent: 'flex-end',
    marginTop: 15,
  },
  empty: { padding: 20, alignItems: 'center' },
});
