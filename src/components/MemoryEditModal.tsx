import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Modal, KeyboardAvoidingView, Platform, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { Text, TextInput, Button, IconButton, Chip, Checkbox } from 'react-native-paper';
import { getDb } from '../core/database';
import { v4 as uuidv4 } from 'uuid';
import TimeCascadeSelector from './TimeCascadeSelector';
import CustomTimePeriodsScreen from '../features/profile/CustomTimePeriodsScreen';
import EmotionCascadeSelector from './EmotionCascadeSelector';
import { shareMemoryWithFriend, checkAndCreateShareTasks } from '../core/socialSync';
import { useAuthStore } from '../core/store';

interface MemoryEditModalProps {
  memory: any; // Requires at least { id/memory_id, raw_text }
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function MemoryEditModal({ memory, visible, onClose, onSaved }: MemoryEditModalProps) {
  const session = useAuthStore((state) => state.session);
  const myId = session?.user?.id;
  const isShared = !!(memory && memory.author_id && memory.author_id !== myId);

  const [editTitle, setEditTitle] = useState('');
  const [editText, setEditText] = useState('');
  const [entities, setEntities] = useState<any[]>([]);
  const [allEntities, setAllEntities] = useState<any[]>([]);
  const [memoryDates, setMemoryDates] = useState<{ start_date: string | null, end_date: string | null } | null>(null);
  const [refiningEntity, setRefiningEntity] = useState<any | null>(null);
  
  // Tagging states
  const [addingType, setAddingType] = useState<string | null>(null);
  const [newTagQuery, setNewTagQuery] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  
  // Custom Time Selector States
  const [timeSelectorVisible, setTimeSelectorVisible] = useState(false);
  const [customPeriodsVisible, setCustomPeriodsVisible] = useState(false);
  const [emotionSelectorVisible, setEmotionSelectorVisible] = useState(false);

  // Sharing states
  const [connectedFriends, setConnectedFriends] = useState<any[]>([]);
  const [selectedShareUserIds, setSelectedShareUserIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (visible && memory) {
      setEditTitle(memory.title || '');
      setEditText(memory.raw_text || '');
      setAddingType(null);
      setNewTagQuery('');
      setRefiningEntity(null);
      setSelectedShareUserIds(new Set());
      loadEntities();
    } else if (!visible) {
      setAddingType(null);
      setNewTagQuery('');
      setRefiningEntity(null);
      setSelectedShareUserIds(new Set());
    }
  }, [visible, memory]);

  const loadEntities = async () => {
    if (!memory) return;
    const memId = memory.id || memory.memory_id;
    try {
      const db = await getDb();
      const associated = await db.getAllAsync<any>(
        `SELECT e.id, e.name, e.type, e.metadata 
         FROM entities e 
         JOIN memory_entities me ON e.id = me.entity_id 
         WHERE me.memory_id = ?`,
        memId
      );
      setEntities(associated);

      // Extract connected friends
      const friends: any[] = [];
      for (const e of associated) {
        if (e.type === 'PERSON' && e.metadata) {
          try {
            const meta = JSON.parse(e.metadata);
            if (meta.is_linked && meta.user_id) {
              friends.push({
                id: e.id,
                name: e.name,
                userId: meta.user_id,
                username: meta.username || '',
              });
            }
          } catch (_) {}
        }
      }

      // Check which ones are already shared
      const sharedRows = await db.getAllAsync<any>(
        "SELECT friend_user_id FROM shared_memories_log WHERE memory_id = ?",
        memId
      );
      const sharedUserIds = new Set(sharedRows.map(r => r.friend_user_id));

      const processedFriends = friends.map(f => ({
        ...f,
        alreadyShared: sharedUserIds.has(f.userId)
      }));

      setConnectedFriends(processedFriends);

      const memRecord = await db.getFirstAsync("SELECT start_date, end_date FROM memories WHERE id = ?", memId) as { start_date: string | null, end_date: string | null } | null;
      if (memRecord) {
        setMemoryDates({
          start_date: memRecord.start_date,
          end_date: memRecord.end_date
        });
      } else {
        setMemoryDates(null);
      }

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
      await db.runAsync("UPDATE memories SET title = ?, raw_text = ? WHERE id = ?", editTitle.trim() || null, editText, memId);

      // Perform sharing if any new friends are selected
      if (selectedShareUserIds.size > 0) {
        let sharedCount = 0;
        for (const friendUserId of selectedShareUserIds) {
          const success = await shareMemoryWithFriend(memId, friendUserId);
          if (success) {
            sharedCount++;
            const friend = connectedFriends.find(f => f.userId === friendUserId);
            if (friend) {
              await db.runAsync(
                "DELETE FROM inbox_tasks WHERE memory_id = ? AND entity_id = ? AND ambiguity_type = 'SHARE_PROMPT'",
                memId,
                friend.id
              );
            }
          }
        }
        if (sharedCount > 0) {
          Alert.alert('Compartido', `Recuerdo compartido con ${sharedCount} persona(s).`);
        }
      }

      // Check and create share tasks for any other connected friends mentioned
      await checkAndCreateShareTasks(db, memId);

      onSaved();
      onClose();
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'No se pudieron guardar los cambios.');
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
      if (entityId === 'virtual_time') {
        await db.runAsync("UPDATE memories SET start_date = NULL, end_date = NULL WHERE id = ?", memId);
        setMemoryDates(null);
      } else {
        await db.runAsync("DELETE FROM memory_entities WHERE memory_id = ? AND entity_id = ?", memId, entityId);
      }
      loadEntities();
      onSaved();
    } catch (e) {
      console.error(e);
    }
  };

  const handleChipPress = (entity: any, type: string) => {
    setRefiningEntity(entity);
    if (type === 'TIME') {
      setTimeSelectorVisible(true);
    } else if (type === 'EMOTION') {
      setEmotionSelectorVisible(true);
    } else {
      setAddingType(type);
      setNewTagQuery(entity.name);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  const addEntityRelation = async (entityId: string) => {
    if (!memory) return;
    const memId = memory.id || memory.memory_id;
    try {
      const db = await getDb();

      // If we are refining an entity, delete the old relation first
      if (refiningEntity) {
        await db.runAsync(
          "DELETE FROM memory_entities WHERE memory_id = ? AND entity_id = ?",
          memId, refiningEntity.id
        );
        setRefiningEntity(null);
      }

      // Also, if the entity type is single-value (TIME or LOCATION), enforce single relation
      const entityInfo = await db.getFirstAsync("SELECT type FROM entities WHERE id = ?", entityId) as {type: string} | null;
      if (entityInfo && (entityInfo.type === 'LOCATION' || entityInfo.type === 'TIME')) {
        await db.runAsync(
          `DELETE FROM memory_entities 
           WHERE memory_id = ? 
           AND entity_id IN (SELECT id FROM entities WHERE type = ? AND id != ?)`,
          memId, entityInfo.type, entityId
        );
      }

      const existing = await db.getFirstAsync("SELECT 1 FROM memory_entities WHERE memory_id = ? AND entity_id = ?", memId, entityId);
      if (!existing) {
        const pivotId = uuidv4();
        await db.runAsync("INSERT INTO memory_entities (id, memory_id, entity_id) VALUES (?, ?, ?)", pivotId, memId, entityId);
      }

      // Check and create share tasks for any connected friends mentioned
      await checkAndCreateShareTasks(db, memId);

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

  const toggleShareUser = (userId: string) => {
    setSelectedShareUserIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    const unsharedFriends = connectedFriends.filter(f => !f.alreadyShared);
    const isAllSelected = unsharedFriends.length > 0 && unsharedFriends.every(f => selectedShareUserIds.has(f.userId));

    setSelectedShareUserIds(prev => {
      const next = new Set(prev);
      if (isAllSelected) {
        for (const f of unsharedFriends) {
          next.delete(f.userId);
        }
      } else {
        for (const f of unsharedFriends) {
          next.add(f.userId);
        }
      }
      return next;
    });
  };

  const renderSharingSection = () => {
    if (connectedFriends.length === 0) return null;

    const unsharedFriends = connectedFriends.filter(f => !f.alreadyShared);
    const isAllSelected = unsharedFriends.length > 0 && unsharedFriends.every(f => selectedShareUserIds.has(f.userId));

    return (
      <View style={styles.shareSection}>
        <Text style={styles.shareSectionTitle}>👥 Compartir con amigos mencionados</Text>
        
        {unsharedFriends.length > 1 && (
          <TouchableOpacity style={styles.checkboxRow} onPress={toggleSelectAll}>
            <Checkbox.Android
              status={isAllSelected ? 'checked' : 'unchecked'}
              onPress={toggleSelectAll}
              color="#6200ee"
            />
            <Text style={styles.checkboxLabel}>Compartir con todos</Text>
          </TouchableOpacity>
        )}

        {connectedFriends.map(friend => {
          const isShared = friend.alreadyShared;
          const isChecked = isShared || selectedShareUserIds.has(friend.userId);

          return (
            <TouchableOpacity 
              key={friend.userId} 
              style={styles.checkboxRow} 
              onPress={() => !isShared && toggleShareUser(friend.userId)}
              disabled={isShared}
            >
              <Checkbox.Android
                status={isChecked ? 'checked' : 'unchecked'}
                onPress={() => !isShared && toggleShareUser(friend.userId)}
                disabled={isShared}
                color="#6200ee"
              />
              <Text style={[styles.checkboxLabel, isShared && styles.sharedLabel]}>
                {friend.name} (@{friend.username}){isShared ? ' (Ya compartido)' : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  const renderSection = (title: string, type: string, icon: string, isSingle: boolean) => {
    let items = entities.filter(e => e.type === type);

    if (type === 'TIME' && items.length === 0 && memoryDates && memoryDates.start_date) {
      const dateName = memoryDates.start_date === memoryDates.end_date
        ? memoryDates.start_date
        : `${memoryDates.start_date} a ${memoryDates.end_date}`;
      items = [{ id: 'virtual_time', name: dateName, type: 'TIME', isVirtual: true }];
    }
    const canAdd = !isShared && (!isSingle || items.length === 0);

    const filteredSuggestions = allEntities
      .filter(e => e.type === type && e.name.toLowerCase().includes(newTagQuery.toLowerCase()))
      .slice(0, 5);
    const exactMatch = allEntities.find(e => e.type === type && e.name.toLowerCase() === newTagQuery.trim().toLowerCase());

    return (
      <View style={{ marginBottom: 15 }} key={type}>
        <Text style={styles.sectionTitle}>{icon} {title}</Text>
        <View style={styles.chipsContainer}>
          {items.map(e => (
            <Chip 
              key={e.id} 
              onClose={isShared ? undefined : () => removeEntity(e.id)} 
              onPress={isShared ? undefined : () => handleChipPress(e, type)}
              style={styles.chip}
            >
              {e.name}
            </Chip>
          ))}
          {canAdd && addingType !== type && (
            <Chip icon="plus" onPress={() => {
              setRefiningEntity(null);
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
            <Button onPress={() => { setAddingType(null); setNewTagQuery(''); setRefiningEntity(null); }} style={{marginTop: 5}}>Cancelar Añadir</Button>
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
              label="Título"
              value={editTitle}
              onChangeText={setEditTitle}
              style={{marginBottom: 10}}
              dense
              disabled={isShared}
            />
            <TextInput
              mode="outlined"
              label="Contenido"
              multiline
              value={editText}
              onChangeText={setEditText}
              style={{minHeight: 100, marginBottom: 20}}
              disabled={isShared}
            />
            
            {renderSection('Personas', 'PERSON', '👤', false)}
            {renderSection('Eventos', 'EVENT', '🎯', false)}
            {renderSection('Objetos', 'OBJECT', '📦', false)}
            {renderSection('Sentimientos', 'EMOTION', '❤️', false)}
            {renderSection('Lugar', 'LOCATION', '📍', true)}
            {renderSection('Momento/Fecha', 'TIME', '⏳', true)}
            
            {isShared ? null : renderSharingSection()}

          </ScrollView>

          <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 15}}>
            <Button mode="text" onPress={handleDelete} textColor="#B00020" icon="delete">Eliminar</Button>
            {isShared ? (
              <Button mode="contained" onPress={onClose}>Cerrar</Button>
            ) : (
              <Button mode="contained" onPress={handleSaveText}>Guardar</Button>
            )}
          </View>
        </View>
        
        {/* Modales de Tiempo */}
        <TimeCascadeSelector
          visible={timeSelectorVisible}
          onClose={() => { setTimeSelectorVisible(false); setRefiningEntity(null); }}
          onManageCustom={() => {
            setTimeSelectorVisible(false);
            setCustomPeriodsVisible(true);
          }}
          onSelectTime={async (timeEntity) => {
            // If selected, add relation (only for STAGE) and update memory dates
            try {
              const db = await getDb();

              // If refining, delete the old stage relation
              if (refiningEntity) {
                if (refiningEntity.id !== 'virtual_time') {
                  await db.runAsync(
                    "DELETE FROM memory_entities WHERE memory_id = ? AND entity_id = ?",
                    memory.id || memory.memory_id, refiningEntity.id
                  );
                }
                setRefiningEntity(null);
              }
              
              // Update Memory start/end dates
              await db.runAsync(
                "UPDATE memories SET start_date = ?, end_date = ? WHERE id = ?",
                timeEntity.start_date, timeEntity.end_date, memory.id || memory.memory_id
              );

              if (timeEntity.type === 'STAGE') {
                await addEntityRelation(timeEntity.id);
              } else {
                // If they selected a specific date, remove any existing TIME stage entity relations
                await db.runAsync(
                  `DELETE FROM memory_entities 
                   WHERE memory_id = ? 
                   AND entity_id IN (SELECT id FROM entities WHERE type = 'TIME')`,
                  memory.id || memory.memory_id
                );
                setMemoryDates({
                  start_date: timeEntity.start_date,
                  end_date: timeEntity.end_date
                });
                loadEntities();
                onSaved();
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
          onClose={() => { setEmotionSelectorVisible(false); setRefiningEntity(null); }}
          onSelectEmotion={async (emotionPath) => {
            try {
              const db = await getDb();

              if (refiningEntity) {
                await db.runAsync(
                  "DELETE FROM memory_entities WHERE memory_id = ? AND entity_id = ?",
                  memory.id || memory.memory_id, refiningEntity.id
                );
                setRefiningEntity(null);
              }

              const existing = await db.getFirstAsync<{id: string}>("SELECT id FROM entities WHERE type = 'EMOTION' AND name = ?", emotionPath);
              const entityId = (existing?.id || uuidv4()) as string;
              
              if (!existing?.id) {
                await db.runAsync("INSERT INTO entities (id, type, name, is_confirmed) VALUES (?, 'EMOTION', ?, 1)", entityId, emotionPath);
              }

              const memId = (memory.id || memory.memory_id || '') as string;
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
  shareSection: {
    marginTop: 20,
    marginBottom: 10,
    padding: 14,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  shareSectionTitle: {
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#495057',
    fontSize: 14,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  checkboxLabel: {
    fontSize: 14,
    color: '#212529',
    marginLeft: 8,
  },
  sharedLabel: {
    color: '#868e96',
    textDecorationLine: 'line-through',
  },
});
