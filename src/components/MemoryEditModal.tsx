import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Modal, KeyboardAvoidingView, Platform, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { Text, TextInput, Button, IconButton, Chip } from 'react-native-paper';
import { getDb } from '../core/database';
import { v4 as uuidv4 } from 'uuid';
import TimeCascadeSelector from './TimeCascadeSelector';
import CustomTimePeriodsScreen from '../features/profile/CustomTimePeriodsScreen';
import EmotionCascadeSelector from './EmotionCascadeSelector';

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
  
  // Tagging states
  const [addingType, setAddingType] = useState<string | null>(null);
  const [newTagQuery, setNewTagQuery] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  
  // Custom Time Selector States
  const [timeSelectorVisible, setTimeSelectorVisible] = useState(false);
  const [customPeriodsVisible, setCustomPeriodsVisible] = useState(false);
  const [emotionSelectorVisible, setEmotionSelectorVisible] = useState(false);

  useEffect(() => {
    if (visible && memory) {
      setEditText(memory.raw_text || '');
      setAddingType(null);
      setNewTagQuery('');
      loadEntities();
    } else if (!visible) {
      setAddingType(null);
      setNewTagQuery('');
    }
  }, [visible, memory]);

  const loadEntities = async () => {
    if (!memory) return;
    const memId = memory.id || memory.memory_id;
    try {
      const db = await getDb();
      const associated = await db.getAllAsync<any>(
        `SELECT e.id, e.name, e.type 
         FROM entities e 
         JOIN memory_entities me ON e.id = me.entity_id 
         WHERE me.memory_id = ?`,
        memId
      );
      setEntities(associated);

      const all = await db.getAllAsync<any>("SELECT id, name, type FROM entities");
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
      onSaved();
    } catch (e) {
      console.error(e);
    }
  };

  const addEntityRelation = async (entityId: string) => {
    if (!memory) return;
    const memId = memory.id || memory.memory_id;
    try {
      const db = await getDb();
      const existing = await db.getFirstAsync("SELECT 1 FROM memory_entities WHERE memory_id = ? AND entity_id = ?", memId, entityId);
      if (!existing) {
        const pivotId = uuidv4();
        await db.runAsync("INSERT INTO memory_entities (id, memory_id, entity_id) VALUES (?, ?, ?)", pivotId, memId, entityId);
      }
      setAddingType(null);
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
      const isConfirmed = (type === 'LOCATION') ? 0 : 1;
      await db.runAsync("INSERT INTO entities (id, type, name, is_confirmed) VALUES (?, ?, ?, ?)", newId, type, name, isConfirmed);
      await addEntityRelation(newId);
    } catch (e) {
      console.error(e);
    }
  };

  const renderSection = (title: string, type: string, icon: string, isSingle: boolean) => {
    const items = entities.filter(e => e.type === type);
    const canAdd = !isSingle || items.length === 0;

    const filteredSuggestions = allEntities
      .filter(e => e.type === type && e.name.toLowerCase().includes(newTagQuery.toLowerCase()))
      .slice(0, 5);
    const exactMatch = allEntities.find(e => e.type === type && e.name.toLowerCase() === newTagQuery.trim().toLowerCase());

    return (
      <View style={{ marginBottom: 15 }} key={type}>
        <Text style={styles.sectionTitle}>{icon} {title}</Text>
        <View style={styles.chipsContainer}>
          {items.map(e => (
            <Chip key={e.id} onClose={() => removeEntity(e.id)} style={styles.chip}>
              {e.name}
            </Chip>
          ))}
          {canAdd && addingType !== type && (
            <Chip icon="plus" onPress={() => {
              if (type === 'TIME') {
                setTimeSelectorVisible(true);
              } else if (type === 'EMOTION') {
                setEmotionSelectorVisible(true);
              } else {
                setAddingType(type);
                setNewTagQuery('');
                setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
              }
            }} style={styles.addChip}>
              Añadir
            </Chip>
          )}
        </View>

        {addingType === type && (
          <View style={styles.dropdownContainer}>
            <TextInput
              mode="outlined"
              label={`Nombre (${title})`}
              value={newTagQuery}
              onChangeText={setNewTagQuery}
              autoFocus
              dense
              style={{ marginBottom: 10, backgroundColor: 'white' }}
            />
            <ScrollView style={{ maxHeight: 150 }} keyboardShouldPersistTaps="handled">
               {filteredSuggestions.map(item => (
                 <TouchableOpacity 
                   key={item.id}
                   style={styles.suggestionItem}
                   onPress={() => {
                     addEntityRelation(item.id);
                     setAddingType(null);
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
                     createNewEntity(newTagQuery.trim(), type);
                     setAddingType(null);
                     setNewTagQuery('');
                   }}
                 >
                   <Text style={{ color: '#6200ee', fontWeight: 'bold' }}>+ Crear "{newTagQuery.trim()}"</Text>
                 </TouchableOpacity>
               )}
            </ScrollView>
            <Button onPress={() => { setAddingType(null); setNewTagQuery(''); }} style={{marginTop: 5}}>Cancelar Añadir</Button>
          </View>
        )}
      </View>
    );
  };

  if (!memory) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBg}>
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <Text style={{fontSize: 18, fontWeight: 'bold'}}>Gestionar Recuerdo</Text>
            <IconButton icon="close" onPress={onClose} />
          </View>
          
          <ScrollView ref={scrollRef} style={{maxHeight: 500}}>
            <TextInput
              mode="outlined"
              multiline
              value={editText}
              onChangeText={setEditText}
              style={{minHeight: 100, marginBottom: 20}}
            />
            
            {renderSection('Personas', 'PERSON', '👤', false)}
            {renderSection('Eventos', 'EVENT', '🎯', false)}
            {renderSection('Objetos', 'OBJECT', '📦', false)}
            {renderSection('Sentimientos', 'EMOTION', '❤️', false)}
            {renderSection('Lugar', 'LOCATION', '📍', true)}
            {renderSection('Momento/Fecha', 'TIME', '⏳', true)}

          </ScrollView>

          <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 15}}>
            <Button mode="text" onPress={handleDelete} textColor="#B00020" icon="delete">Eliminar</Button>
            <Button mode="contained" onPress={handleSaveText}>Guardar Texto</Button>
          </View>
        </View>
        
        {/* Modales de Tiempo */}
        <TimeCascadeSelector
          visible={timeSelectorVisible}
          onClose={() => setTimeSelectorVisible(false)}
          onManageCustom={() => {
            setTimeSelectorVisible(false);
            setCustomPeriodsVisible(true);
          }}
          onSelectTime={async (timeEntity) => {
            // If selected, add relation (only for STAGE) and update memory dates
            try {
              const db = await getDb();
              
              // Update Memory start/end dates
              await db.runAsync(
                "UPDATE memories SET start_date = ?, end_date = ? WHERE id = ?",
                timeEntity.start_date, timeEntity.end_date, memory.id || memory.memory_id
              );

              if (timeEntity.type === 'STAGE') {
                await addEntityRelation(timeEntity.id);
              }
            } catch (e) {
              console.error('Error saving selected time:', e);
            }
            setTimeSelectorVisible(false);
          }}
        />
        <CustomTimePeriodsScreen
          visible={customPeriodsVisible}
          onClose={() => {
            setCustomPeriodsVisible(false);
            setTimeSelectorVisible(true);
          }}
        />

        <EmotionCascadeSelector
          visible={emotionSelectorVisible}
          onClose={() => setEmotionSelectorVisible(false)}
          onSelectEmotion={async (emotionPath) => {
            try {
              const db = await getDb();
              const existing = await db.getFirstAsync<{id: string}>("SELECT id FROM entities WHERE type = 'EMOTION' AND name = ?", emotionPath);
              let entityId = existing?.id;
              
              if (!entityId) {
                entityId = uuidv4();
                await db.runAsync("INSERT INTO entities (id, type, name, is_confirmed) VALUES (?, 'EMOTION', ?, 1)", entityId, emotionPath);
              }

              const memId = memory.id || memory.memory_id;
              const pivot = await db.getFirstAsync("SELECT id FROM memory_entities WHERE memory_id = ? AND entity_id = ?", memId, entityId);
              if (!pivot) {
                await db.runAsync("INSERT INTO memory_entities (id, memory_id, entity_id) VALUES (?, ?, ?)", uuidv4(), memId, entityId);
              }
              
              loadEntities();
              onSaved();
            } catch (e) {
              console.error(e);
            }
            setEmotionSelectorVisible(false);
          }}
        />

      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: 'white', padding: 20, borderTopLeftRadius: 15, borderTopRightRadius: 15 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontWeight: 'bold', marginBottom: 8, color: '#555', fontSize: 14 },
  chipsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: '#eef2ff' },
  addChip: { backgroundColor: '#f0f0f0', borderStyle: 'dashed', borderWidth: 1, borderColor: '#ccc' },
  dropdownContainer: { marginTop: 10, padding: 10, backgroundColor: '#f9f9f9', borderRadius: 8, borderWidth: 1, borderColor: '#eee' },
  suggestionItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
});
