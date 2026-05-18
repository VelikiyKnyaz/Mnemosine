import React, { useState, useEffect } from 'react';
import { View, StyleSheet, SectionList, KeyboardAvoidingView, Platform, Modal, Alert, TouchableOpacity } from 'react-native';
import { Text, Card, TextInput, Button, IconButton } from 'react-native-paper';
import { getDb } from '../../core/database';
import { Audio } from 'expo-av';
import MemoryEditModal from '../../components/MemoryEditModal';

interface EntityMemoriesViewProps {
  entityId: string;
  onRootNameLoaded?: (name: string) => void;
  style?: any;
}

const MemoryCardItem = ({ item, onEdit, onPlay, playingId, onLongPress, expanded, onToggleExpand, styles }: any) => {
  const [entities, setEntities] = useState<any[]>([]);

  useEffect(() => {
    if (expanded) {
      getDb().then(db => {
        db.getAllAsync<any>(
          "SELECT e.name, e.type FROM entities e JOIN memory_entities me ON e.id = me.entity_id WHERE me.memory_id = ?",
          item.memory_id || item.id
        ).then(setEntities);
      });
    }
  }, [expanded, item.id, item.memory_id]);

  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onToggleExpand} onLongPress={() => onLongPress(item.memory_id)} style={styles.card}>
      <Card.Content style={{ paddingTop: 10 }}>
        <Text style={styles.text}>{item.raw_text}</Text>
        
        {expanded && (
          <View style={{ marginTop: 12 }}>
            {entities.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {entities.map((e, idx) => (
                  <Text key={idx} style={{ fontSize: 12, color: '#6200ee', backgroundColor: '#f0f4ff', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                    #{e.name}
                  </Text>
                ))}
              </View>
            )}
            <Button mode="outlined" onPress={() => onEdit(item)} compact icon="pencil" style={{ alignSelf: 'flex-start' }}>
              Editar Recuerdo
            </Button>
          </View>
        )}
      </Card.Content>
      {item.audio_uri ? (
        <Card.Actions>
          <Button 
            icon={playingId === item.memory_id ? 'stop' : 'play'} 
            onPress={() => onPlay(item.audio_uri, item.memory_id)}
          >
            {playingId === item.memory_id ? 'Detener' : 'Escuchar Original'}
          </Button>
        </Card.Actions>
      ) : null}
    </TouchableOpacity>
  );
};

export default function EntityMemoriesView({ entityId, onRootNameLoaded, style }: EntityMemoriesViewProps) {
  const [rootEntityName, setRootEntityName] = useState('');
  const [sections, setSections] = useState<any[]>([]);
  
  // Audio playback state
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  // Edit state
  const [editingMemory, setEditingMemory] = useState<any>(null);
  const [expandedMemoryId, setExpandedMemoryId] = useState<string | null>(null);

  const loadMemories = async () => {
    try {
      const db = await getDb();
      
      const root = await db.getFirstAsync<{name: string}>("SELECT name FROM entities WHERE id = ?", entityId);
      if (root) {
        setRootEntityName(root.name);
        if (onRootNameLoaded) onRootNameLoaded(root.name);
      }

      const query = `
        WITH RECURSIVE descendants AS (
          SELECT id, name, parent_id FROM entities WHERE id = ?
          UNION ALL
          SELECT e.id, e.name, e.parent_id
          FROM entities e
          JOIN descendants d ON e.parent_id = d.id
        )
        SELECT 
          m.id as memory_id, 
          m.raw_text, 
          m.audio_uri, 
          m.fuzzy_date, 
          d.id as entity_id, 
          d.name as entity_name
        FROM descendants d
        JOIN memory_entities me ON me.entity_id = d.id
        JOIN memories m ON m.id = me.memory_id
        ORDER BY d.name, m.created_at DESC
      `;
      
      const rows = await db.getAllAsync<any>(query, entityId);
      
      // Group by entity_name
      const grouped = rows.reduce((acc: any, row) => {
        if (!acc[row.entity_name]) {
          acc[row.entity_name] = [];
        }
        acc[row.entity_name].push(row);
        return acc;
      }, {});

      const sectionData = Object.keys(grouped).map(key => ({
        title: key,
        data: grouped[key]
      }));

      // Sort sections so root is first
      sectionData.sort((a, b) => {
        if (a.title === root?.name) return -1;
        if (b.title === root?.name) return 1;
        return a.title.localeCompare(b.title);
      });

      setSections(sectionData);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadMemories();
    return () => {
      if (sound) sound.unloadAsync();
    };
  }, [entityId]);

  const playAudio = async (uri: string, memoryId: string) => {
    try {
      if (sound) {
        await sound.unloadAsync();
        setSound(null);
        setPlayingId(null);
        if (playingId === memoryId) return; // Toggle off
      }
      const { sound: newSound } = await Audio.Sound.createAsync({ uri });
      setSound(newSound);
      setPlayingId(memoryId);
      await newSound.playAsync();
      newSound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.didJustFinish) {
          setPlayingId(null);
        }
      });
    } catch (e) {
      console.error("Error playing audio", e);
    }
  };

  const openEdit = (memory: any) => {
    setEditingMemory(memory);
  };

  const confirmDelete = (memoryId: string) => {
    Alert.alert(
      "Eliminar Recuerdo",
      "¿Estás seguro de eliminar este recuerdo permanentemente?",
      [
        { text: "Cancelar", style: "cancel" },
        { 
          text: "Eliminar", 
          style: "destructive", 
          onPress: async () => {
            try {
              const db = await getDb();
              await db.runAsync("DELETE FROM inbox_tasks WHERE memory_id = ?", memoryId);
              await db.runAsync("DELETE FROM memory_entities WHERE memory_id = ?", memoryId);
              
              // Cascade cleanup: delete orphaned location ancestors up the tree
              let cleanupChanges = 1;
              while (cleanupChanges > 0) {
                const cleanupRes = await db.runAsync("DELETE FROM entities WHERE type = 'LOCATION' AND id NOT IN (SELECT entity_id FROM memory_entities) AND id NOT IN (SELECT parent_id FROM entities WHERE parent_id IS NOT NULL)");
                cleanupChanges = cleanupRes.changes;
              }
              
              await db.runAsync("DELETE FROM memories WHERE id = ?", memoryId);
              loadMemories();
            } catch(e) {
              console.error(e);
            }
          }
        }
      ]
    );
  };

  const renderMemory = ({ item }: { item: any }) => (
    <MemoryCardItem 
      item={item} 
      onEdit={openEdit} 
      onPlay={playAudio} 
      playingId={playingId} 
      onLongPress={confirmDelete}
      expanded={expandedMemoryId === (item.memory_id || item.id)}
      onToggleExpand={() => setExpandedMemoryId(expandedMemoryId === (item.memory_id || item.id) ? null : (item.memory_id || item.id))}
      styles={styles} 
    />
  );

  return (
    <View style={[styles.container, style]}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.memory_id}
        renderItem={renderMemory}
        renderSectionHeader={({ section: { title } }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{title}</Text>
          </View>
        )}
        ListEmptyComponent={
          <View style={{padding: 20, alignItems: 'center'}}>
            <Text style={{color: '#888'}}>No hay recuerdos en este lugar ni en sus subdivisiones.</Text>
          </View>
        }
        contentContainerStyle={{ padding: 15 }}
      />

      <MemoryEditModal
        visible={!!editingMemory}
        memory={editingMemory}
        onClose={() => setEditingMemory(null)}
        onSaved={loadMemories}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  sectionHeader: {
    backgroundColor: '#e0e0e0',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 5,
    marginVertical: 10,
  },
  sectionTitle: { fontWeight: 'bold', color: '#333' },
  card: { marginBottom: 10, backgroundColor: 'white' },
  date: { fontSize: 12, color: '#888', marginBottom: 5, fontWeight: 'bold' },
  text: { fontSize: 15, lineHeight: 22 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: 'white', padding: 20, borderTopLeftRadius: 15, borderTopRightRadius: 15 },
});
