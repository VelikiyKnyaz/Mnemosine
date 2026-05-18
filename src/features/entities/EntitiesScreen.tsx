import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Alert, TouchableOpacity, Modal } from 'react-native';
import { Appbar, Card, Text, Button, TextInput, Chip, IconButton } from 'react-native-paper';
import { getDb, inheritCoordinatesFromParent } from '../../core/database';
import { useIsFocused } from '@react-navigation/native';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

const TYPES = ['PERSON', 'LOCATION', 'EVENT', 'OBJECT', 'TIME'] as const;
type EntityType = typeof TYPES[number];

const typeEmoji: Record<string, string> = {
  PERSON: '👤', LOCATION: '📍', EVENT: '🎯', OBJECT: '📦', TIME: '⏳'
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

  // Merge state
  const [selectedForMerge, setSelectedForMerge] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<any | null>(null);
  const [mergeSource, setMergeSource] = useState<any | null>(null);
  const [mergeName, setMergeName] = useState('');
  const [showMergeModal, setShowMergeModal] = useState(false);

  // Aliases state
  const [editAliases, setEditAliases] = useState<{id: string, alias: string}[]>([]);
  const [newAlias, setNewAlias] = useState('');

  const loadEntities = async () => {
    try {
      const db = await getDb();
      const rows = await db.getAllAsync<any>(`
        SELECT e.*, p.name as parent_name,
          (SELECT COUNT(*) FROM memory_entities me WHERE me.entity_id = e.id) as mem_count
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

  const loadAliases = async (entityId: string) => {
    try {
      const db = await getDb();
      const rows = await db.getAllAsync<{id: string, alias: string}>(
        "SELECT id, alias FROM entity_aliases WHERE entity_id = ?", entityId
      );
      setEditAliases(rows);
    } catch (e) {
      console.error(e);
    }
  };

  const addAlias = async () => {
    if (!newAlias.trim() || !editingId) return;
    try {
      const db = await getDb();
      const id = uuidv4();
      await db.runAsync(
        "INSERT INTO entity_aliases (id, alias, entity_id) VALUES (?, ?, ?)",
        id, newAlias.trim(), editingId
      );
      setNewAlias('');
      loadAliases(editingId);
    } catch (e: any) {
      Alert.alert('Error', 'Ese alias ya está en uso por otra entidad.');
    }
  };

  const deleteAlias = async (aliasId: string) => {
    try {
      const db = await getDb();
      await db.runAsync("DELETE FROM entity_aliases WHERE id = ?", aliasId);
      if (editingId) loadAliases(editingId);
    } catch (e) {
      console.error(e);
    }
  };

  const startEdit = (entity: any) => {
    setEditingId(entity.id);
    setEditName(entity.name);
    setEditType(entity.type as EntityType);
    setEditParentId(entity.parent_id || null);
    setParentSearch(entity.parent_name || '');
    setShowParentList(false);
    loadAliases(entity.id);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditParentId(null);
    setParentSearch('');
    setShowParentList(false);
    setEditAliases([]);
    setNewAlias('');
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
            await db.runAsync('DELETE FROM entity_aliases WHERE entity_id = ?', id);
            await db.runAsync('DELETE FROM entities WHERE id = ?', id);
            if (editingId === id) cancelEdit();
            if (selectedForMerge === id) setSelectedForMerge(null);
            loadEntities();
          } catch (e) {
            console.error(e);
          }
        }
      }
    ]);
  };

  // --- Merge Logic ---
  const handleLongPress = (entity: any) => {
    if (editingId) return; // Don't allow merge while editing
    if (selectedForMerge === entity.id) {
      setSelectedForMerge(null);
      return;
    }
    setSelectedForMerge(entity.id);
  };

  const handleTapWhileMerging = (entity: any) => {
    if (!selectedForMerge || selectedForMerge === entity.id) return;
    
    const source = entities.find(e => e.id === selectedForMerge);
    const target = entity;
    if (!source) return;

    setMergeSource(source);
    setMergeTarget(target);
    setMergeName(target.name); // Default to target name
    setShowMergeModal(true);
  };

  const executeMerge = async () => {
    if (!mergeSource || !mergeTarget || !mergeName.trim()) return;
    try {
      const db = await getDb();
      const sourceId = mergeSource.id;
      const targetId = mergeTarget.id;
      const sourceName = mergeSource.name;

      // 1. Move all memory links from source to target (avoid duplicates)
      const existingLinks = await db.getAllAsync<{memory_id: string}>(
        "SELECT memory_id FROM memory_entities WHERE entity_id = ?", targetId
      );
      const existingMemIds = new Set(existingLinks.map(l => l.memory_id));

      const sourceLinks = await db.getAllAsync<{id: string, memory_id: string}>(
        "SELECT id, memory_id FROM memory_entities WHERE entity_id = ?", sourceId
      );
      for (const link of sourceLinks) {
        if (existingMemIds.has(link.memory_id)) {
          await db.runAsync("DELETE FROM memory_entities WHERE id = ?", link.id);
        } else {
          await db.runAsync("UPDATE memory_entities SET entity_id = ? WHERE id = ?", targetId, link.id);
        }
      }

      // 2. Move children of source to target
      await db.runAsync("UPDATE entities SET parent_id = ? WHERE parent_id = ?", targetId, sourceId);

      // 3. Create alias from source name → target
      try {
        const aliasId = uuidv4();
        await db.runAsync(
          "INSERT INTO entity_aliases (id, alias, entity_id) VALUES (?, ?, ?)",
          aliasId, sourceName, targetId
        );
      } catch (_) { /* alias already exists, ignore */ }

      // 4. Move aliases from source to target
      await db.runAsync("UPDATE entity_aliases SET entity_id = ? WHERE entity_id = ?", targetId, sourceId);

      // 5. Copy coordinates if target lacks them
      if (mergeTarget.latitude == null && mergeSource.latitude != null) {
        await db.runAsync(
          "UPDATE entities SET latitude = ?, longitude = ? WHERE id = ?",
          mergeSource.latitude, mergeSource.longitude, targetId
        );
      }

      // 6. Rename target to the chosen name
      await db.runAsync("UPDATE entities SET name = ? WHERE id = ?", mergeName.trim(), targetId);

      // 7. Delete source entity
      await db.runAsync("DELETE FROM entities WHERE id = ?", sourceId);

      setShowMergeModal(false);
      setSelectedForMerge(null);
      setMergeSource(null);
      setMergeTarget(null);
      setMergeName('');
      loadEntities();
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e?.message || 'No se pudo fusionar.');
    }
  };

  const cancelMerge = () => {
    setShowMergeModal(false);
    setMergeSource(null);
    setMergeTarget(null);
    setMergeName('');
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
        {selectedForMerge && (
          <Appbar.Action icon="close" onPress={() => setSelectedForMerge(null)} />
        )}
      </Appbar.Header>

      {selectedForMerge && (
        <View style={styles.mergeBanner}>
          <Text style={styles.mergeBannerText}>
            Seleccionado: "{entities.find(e => e.id === selectedForMerge)?.name}". Toca otro elemento para fusionar.
          </Text>
        </View>
      )}

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
        {filtered.map(entity => {
          const isSelected = selectedForMerge === entity.id;
          return (
            <Card 
              key={entity.id} 
              style={[styles.card, isSelected && styles.cardSelected]}
            >
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

                  {/* Aliases Section */}
                  <Text style={{fontSize: 12, color: '#666', marginTop: 14, marginBottom: 6}}>
                    Alias (sinónimos que apuntan aquí):
                  </Text>
                  <View style={styles.aliasRow}>
                    {editAliases.map(a => (
                      <Chip 
                        key={a.id} 
                        onClose={() => deleteAlias(a.id)} 
                        style={styles.aliasChip}
                        textStyle={{fontSize: 12}}
                      >
                        {a.alias}
                      </Chip>
                    ))}
                    {editAliases.length === 0 && (
                      <Text style={{color: '#aaa', fontSize: 12}}>Sin alias</Text>
                    )}
                  </View>
                  <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 6}}>
                    <TextInput
                      value={newAlias}
                      onChangeText={setNewAlias}
                      placeholder="Añadir alias..."
                      mode="outlined"
                      dense
                      style={{flex: 1}}
                      onSubmitEditing={addAlias}
                    />
                    <IconButton icon="plus" size={20} onPress={addAlias} />
                  </View>

                  <View style={styles.editActions}>
                    <Button onPress={cancelEdit} style={{marginRight: 8}}>Cancelar</Button>
                    <Button mode="contained" onPress={saveEdit}>Guardar</Button>
                  </View>
                </Card.Content>
              ) : (
                <TouchableOpacity
                  onPress={() => {
                    if (selectedForMerge && selectedForMerge !== entity.id) {
                      handleTapWhileMerging(entity);
                    } else {
                      startEdit(entity);
                    }
                  }}
                  onLongPress={() => handleLongPress(entity)}
                  delayLongPress={400}
                >
                  <Card.Content style={styles.entityRow}>
                    <View style={{flex: 1}}>
                      <Text style={{fontWeight: 'bold'}}>
                        {typeEmoji[entity.type] || '?'} {entity.name}
                        <Text style={{fontWeight: 'normal', color: '#999'}}> ({entity.mem_count})</Text>
                      </Text>
                      {entity.parent_name && (
                        <Text style={styles.parentHint}>↳ parte de: {entity.parent_name}</Text>
                      )}
                    </View>
                    <View style={styles.rowActions}>
                      <IconButton icon="delete" size={18} iconColor="#B00020" onPress={() => deleteEntity(entity.id)} />
                    </View>
                  </Card.Content>
                </TouchableOpacity>
              )}
            </Card>
          );
        })}

        {filtered.length === 0 && (
          <View style={styles.empty}>
            <Text>No hay elementos registrados.</Text>
          </View>
        )}
        <View style={{height: 20}} />
      </ScrollView>

      {/* Merge Confirmation Modal */}
      <Modal visible={showMergeModal} transparent animationType="fade">
        <View style={styles.mergeOverlay}>
          <View style={styles.mergeDialog}>
            <Text style={styles.mergeTitle}>Fusionar Elementos</Text>
            
            <View style={styles.mergePreview}>
              <Text style={styles.mergeEntityLabel}>
                {typeEmoji[mergeSource?.type] || ''} {mergeSource?.name}
              </Text>
              <Text style={styles.mergeArrow}>→</Text>
              <Text style={styles.mergeEntityLabel}>
                {typeEmoji[mergeTarget?.type] || ''} {mergeTarget?.name}
              </Text>
            </View>

            <Text style={{fontSize: 12, color: '#666', marginBottom: 4}}>
              Los recuerdos, hijos y alias se unirán. "{mergeSource?.name}" se convertirá en alias.
            </Text>

            <TextInput
              label="Nombre definitivo"
              value={mergeName}
              onChangeText={setMergeName}
              mode="outlined"
              dense
              style={{marginTop: 12}}
            />

            <View style={styles.mergeActions}>
              <Button onPress={cancelMerge}>Cancelar</Button>
              <Button mode="contained" onPress={executeMerge}>Fusionar</Button>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  mergeBanner: {
    backgroundColor: '#e8eaf6',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#c5cae9',
  },
  mergeBannerText: { fontSize: 13, color: '#283593', fontWeight: '500' },
  filterRow: {
    flexDirection: 'row', padding: 10,
    flexWrap: 'wrap',
  },
  filterChip: { marginBottom: 4, marginRight: 6 },
  list: { flex: 1, padding: 10 },
  card: { marginBottom: 8, backgroundColor: '#fff' },
  cardSelected: { 
    borderWidth: 2, borderColor: '#5c6bc0',
    backgroundColor: '#e8eaf6',
  },
  entityRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
  },
  parentHint: { fontSize: 12, color: '#666', marginTop: 2 },
  rowActions: { flexDirection: 'row' },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap' },
  typeChip: { marginRight: 6, marginBottom: 4 },
  aliasRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  aliasChip: { backgroundColor: '#e3f2fd', marginBottom: 2 },
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
  // Merge Modal
  mergeOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center',
  },
  mergeDialog: {
    backgroundColor: 'white', borderRadius: 12,
    padding: 20, width: '85%',
    elevation: 10,
  },
  mergeTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  mergePreview: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12, paddingVertical: 10,
    backgroundColor: '#fafafa', borderRadius: 8,
  },
  mergeEntityLabel: { fontSize: 14, fontWeight: '600', flex: 1, textAlign: 'center' },
  mergeArrow: { fontSize: 20, marginHorizontal: 8, color: '#5c6bc0' },
  mergeActions: {
    flexDirection: 'row', justifyContent: 'flex-end',
    marginTop: 16, gap: 8,
  },
});
