import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Modal, KeyboardAvoidingView, Platform, ScrollView, Alert } from 'react-native';
import { Text, TextInput, Button, IconButton, Chip } from 'react-native-paper';
import { getDb } from '../core/database';
import SmartDropdown, { NominatimSuggestion } from './SmartDropdown';
import { v4 as uuidv4 } from 'uuid';
import { geocodeLocation, generateTerritorialHierarchy } from '../core/ai_processor';

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

  useEffect(() => {
    if (visible && memory) {
      setEditText(memory.raw_text || '');
      loadEntities();
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
          await db.runAsync("DELETE FROM memory_entities WHERE memory_id = ?", memId);
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
        await db.runAsync("INSERT INTO memory_entities (memory_id, entity_id) VALUES (?, ?)", memId, entityId);
      }
      setShowDropdown(false);
      loadEntities();
      onSaved();
    } catch (e) {
      console.error(e);
    }
  };

  const createNewEntity = async (name: string) => {
    try {
      const db = await getDb();
      const newId = uuidv4();
      // Assume 'PERSON' or 'OBJECT' if not nominatim? Let's default to OBJECT to be safe, 
      // or PERSON if it looks like a name. We will just use 'OBJECT' as fallback.
      await db.runAsync("INSERT INTO entities (id, type, name, is_confirmed) VALUES (?, 'OBJECT', ?, 1)", newId, name);
      await addEntityRelation(newId);
    } catch (e) {
      console.error(e);
    }
  };

  const createFromNominatim = async (suggestion: NominatimSuggestion) => {
    try {
      const db = await getDb();
      const name = suggestion.display_name.split(',')[0].trim();
      const lat = parseFloat(suggestion.lat);
      const lon = parseFloat(suggestion.lon);
      
      const newId = uuidv4();
      await db.runAsync(
        "INSERT INTO entities (id, type, name, latitude, longitude, is_confirmed) VALUES (?, 'LOCATION', ?, ?, ?, 0)",
        newId, name, lat, lon
      );
      
      if (suggestion.address) {
        await generateTerritorialHierarchy(db, newId, name, { lat, lon, address: suggestion.address });
      }
      await addEntityRelation(newId);
    } catch (e) {
      console.error(e);
    }
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
          
          <ScrollView style={{maxHeight: 400}}>
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
                <Chip icon="plus" onPress={() => setShowDropdown(true)} style={styles.addChip}>
                  Añadir
                </Chip>
              )}
            </View>

            {showDropdown && (
              <View style={styles.dropdownContainer}>
                <SmartDropdown
                  label="Buscar o crear elemento..."
                  value=""
                  items={allEntities}
                  enableNominatim={true}
                  onSelect={(item) => {
                    if (item) addEntityRelation(item.id);
                  }}
                  onCreateNew={createNewEntity}
                  onSelectNominatim={createFromNominatim}
                  placeholder="Escribe el nombre..."
                />
                <Button onPress={() => setShowDropdown(false)} style={{marginTop: 5}}>Cancelar Añadir</Button>
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
  dropdownContainer: { marginTop: 10, padding: 10, backgroundColor: '#f9f9f9', borderRadius: 8 },
});
