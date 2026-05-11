import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Modal, KeyboardAvoidingView, Platform, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { Text, TextInput, Button, IconButton, Chip } from 'react-native-paper';
import { getDb } from '../core/database';
import { v4 as uuidv4 } from 'uuid';
import { generateTerritorialHierarchy } from '../core/ai_processor';

interface MemoryEditModalProps {
  memory: any; // Requires at least { id/memory_id, raw_text }
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function MemoryEditModal({ memory, visible, onClose, onSaved }: MemoryEditModalProps) {
  const [editText, setEditText] = useState('');
  const [entities, setEntities] = useState<any[]>([]);
  const [allEntities, setAllEntities] = useState<any[]>([]);
  
  // Dropdown states
  const [showDropdown, setShowDropdown] = useState(false);
  const [newTagQuery, setNewTagQuery] = useState('');
  const [newTagType, setNewTagType] = useState('PERSON');
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (visible && memory) {
      setEditText(memory.raw_text || '');
      setShowDropdown(false);
      setNewTagQuery('');
      setNewTagType('PERSON');
      loadEntities();
    } else if (!visible) {
      setShowDropdown(false);
      setNewTagQuery('');
    }
  }, [visible, memory]);

  const loadEntities = async () => {
    if (!memory) return;
    const memId = memory.id || memory.memory_id;
    try {
      const db = await getDb();
      // Fetch associated entities
      const associated = await db.getAllAsync<any>(
        `SELECT e.id, e.name, e.type 
         FROM entities e 
         JOIN memory_entities me ON e.id = me.entity_id 
         WHERE me.memory_id = ?`,
        memId
      );
      setEntities(associated);

      // Fetch all entities for dropdown
      const all = await db.getAllAsync<any>("SELECT id, name FROM entities");
      setAllEntities(all);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveText = async () => {
    if (!memory) return;
    const memId = memory.id || memory.memory_id;
    try {
      const db = await getDb();
      await db.runAsync("UPDATE memories SET raw_text = ? WHERE id = ?", editText, memId);
      onSaved();
      onClose();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = () => {
    Alert.alert('Eliminar Recuerdo', '¿Eliminar este recuerdo permanentemente? Se perderán todas sus asociaciones.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: async () => {
        const memId = memory.id || memory.memory_id;
        try {
          const db = await getDb();
          await db.runAsync("DELETE FROM inbox_tasks WHERE memory_id = ?", memId);
          await db.runAsync("DELETE FROM memory_entities WHERE memory_id = ?", memId);
          
          let cleanupChanges = 1;
          while (cleanupChanges > 0) {
            const cleanupRes = await db.runAsync("DELETE FROM entities WHERE type = 'LOCATION' AND id NOT IN (SELECT entity_id FROM memory_entities) AND id NOT IN (SELECT parent_id FROM entities WHERE parent_id IS NOT NULL)");
            cleanupChanges = cleanupRes.changes;
          }
          
          await db.runAsync("DELETE FROM memories WHERE id = ?", memId);
          onSaved();
          onClose();
        } catch (e) {
          console.error(e);
        }
      }},
    ]);
  };

  const removeEntity = async (entityId: string) => {
    if (!memory) return;
    const memId = memory.id || memory.memory_id;
    try {
      const db = await getDb();
      await db.runAsync("DELETE FROM memory_entities WHERE memory_id = ? AND entity_id = ?", memId, entityId);
      loadEntities();
      onSaved(); // Trigger refresh in parent list
    } catch (e) {
      console.error(e);
    }
  };

  const addEntityRelation = async (entityId: string) => {
    if (!memory) return;
    const memId = memory.id || memory.memory_id;
    try {
      const db = await getDb();
      // Check if already exists
      const existing = await db.getFirstAsync("SELECT 1 FROM memory_entities WHERE memory_id = ? AND entity_id = ?", memId, entityId);
      if (!existing) {
        const pivotId = uuidv4();
        await db.runAsync("INSERT INTO memory_entities (id, memory_id, entity_id) VALUES (?, ?, ?)", pivotId, memId, entityId);
      }
      setShowDropdown(false);
      loadEntities();
      onSaved();
    } catch (e) {
      console.error(e);
    }
  };

  const createNewEntity = async (name: string, type: string) => {
    try {
      const db = await getDb();
      const newId = uuidv4();
      const isConfirmed = type === 'LOCATION' ? 0 : 1;
      await db.runAsync("INSERT INTO entities (id, type, name, is_confirmed) VALUES (?, ?, ?, ?)", newId, type, name, isConfirmed);
      await addEntityRelation(newId);
    } catch (e) {
      console.error(e);
    }
  };

  if (!memory) return null;

  const filteredEntities = allEntities.filter(e => e.name.toLowerCase().includes(newTagQuery.toLowerCase())).slice(0, 5);
  const exactMatch = allEntities.find(e => e.name.toLowerCase() === newTagQuery.trim().toLowerCase());

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBg}>
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <Text style={{fontSize: 18, fontWeight: 'bold'}}>Gestionar Recuerdo</Text>
            <IconButton icon="close" onPress={onClose} />
          </View>
          
          <ScrollView ref={scrollRef} style={{maxHeight: 400}}>
            <TextInput
              mode="outlined"
              multiline
              value={editText}
              onChangeText={setEditText}
              style={{minHeight: 100, marginBottom: 15}}
            />
            
            <Text style={styles.sectionTitle}>Etiquetas (Elementos)</Text>
            <View style={styles.chipsContainer}>
              {entities.map(e => (
                <Chip 
                  key={e.id} 
                  onClose={() => removeEntity(e.id)} 
                  style={styles.chip}
                  icon={e.type === 'LOCATION' ? 'map-marker' : e.type === 'PERSON' ? 'account' : 'tag'}
                >
                  {e.name}
                </Chip>
              ))}
              
              {!showDropdown && (
                <Chip icon="plus" onPress={() => {
                  setShowDropdown(true);
                  setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
                }} style={styles.addChip}>
                  Añadir
                </Chip>
              )}
            </View>

            {showDropdown && (
              <View style={styles.dropdownContainer}>
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                  {[
                    { id: 'LOCATION', label: '📍 Lugar' },
                    { id: 'PERSON', label: '👤 Persona' },
                    { id: 'EVENT', label: '📅 Evento' },
                    { id: 'OBJECT', label: '🏷️ Objeto' },
                  ].map(t => (
                    <Chip 
                      key={t.id} 
                      selected={newTagType === t.id}
                      onPress={() => setNewTagType(t.id)}
                      style={{ backgroundColor: newTagType === t.id ? '#e3f2fd' : '#f5f5f5' }}
                    >
                      {t.label}
                    </Chip>
                  ))}
                </View>

                <TextInput
                  mode="outlined"
                  label="Nombre de la etiqueta"
                  value={newTagQuery}
                  onChangeText={setNewTagQuery}
                  onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)}
                  autoFocus
                  dense
                  style={{ marginBottom: 10, backgroundColor: 'white' }}
                />

                <ScrollView style={{ maxHeight: 150 }} keyboardShouldPersistTaps="handled">
                   {filteredEntities.map(item => (
                     <TouchableOpacity 
                       key={item.id}
                       style={styles.suggestionItem}
                       onPress={() => {
                         addEntityRelation(item.id);
                         setNewTagQuery('');
                       }}
                     >
                       <Text>{item.name}</Text>
                     </TouchableOpacity>
                   ))}
                   
                   {newTagQuery.trim().length > 0 && !exactMatch && (
                     <TouchableOpacity
                       style={[styles.suggestionItem, { backgroundColor: '#f0f4ff' }]}
                       onPress={() => {
                         createNewEntity(newTagQuery.trim(), newTagType);
                         setNewTagQuery('');
                       }}
                     >
                       <Text style={{ color: '#6200ee', fontWeight: 'bold' }}>+ Crear "{newTagQuery.trim()}"</Text>
                     </TouchableOpacity>
                   )}
                </ScrollView>

                <Button onPress={() => { setShowDropdown(false); setNewTagQuery(''); }} style={{marginTop: 5}}>Cancelar Añadir</Button>
              </View>
            )}
          </ScrollView>

          <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 15}}>
            <Button mode="text" onPress={handleDelete} textColor="#B00020" icon="delete">Eliminar</Button>
            <Button mode="contained" onPress={handleSaveText}>Guardar Texto</Button>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: 'white', padding: 20, borderTopLeftRadius: 15, borderTopRightRadius: 15 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontWeight: 'bold', marginBottom: 8, color: '#555' },
  chipsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 15 },
  chip: { backgroundColor: '#eef2ff' },
  addChip: { backgroundColor: '#f0f0f0', borderStyle: 'dashed', borderWidth: 1, borderColor: '#ccc' },
  dropdownContainer: { marginTop: 10, padding: 10, backgroundColor: '#f9f9f9', borderRadius: 8, borderWidth: 1, borderColor: '#eee' },
  suggestionItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
});
