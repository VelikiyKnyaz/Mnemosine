import React, { useState, useEffect } from 'react';
import { View, StyleSheet, SectionList, TouchableOpacity, Modal, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Appbar, Text, Card, TextInput, Button, IconButton } from 'react-native-paper';
import { getDb } from '../../core/database';
import { Audio } from 'expo-av';

export default function EntityMemoriesScreen({ route, navigation }: any) {
  const { entityId } = route.params;
  const [rootEntityName, setRootEntityName] = useState('');
  const [sections, setSections] = useState<any[]>([]);
  
  // Audio playback state
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  // Edit state
  const [editingMemory, setEditingMemory] = useState<any>(null);
  const [editText, setEditText] = useState('');

  const loadMemories = async () => {
    try {
      const db = await getDb();
      
      const root = await db.getFirstAsync<{name: string}>("SELECT name FROM entities WHERE id = ?", entityId);
      if (root) setRootEntityName(root.name);

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
        if (a.title === rootEntityName) return -1;
        if (b.title === rootEntityName) return 1;
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
    setEditText(memory.raw_text || '');
  };

  const saveEdit = async () => {
    if (!editingMemory) return;
    try {
      const db = await getDb();
      await db.runAsync("UPDATE memories SET raw_text = ? WHERE id = ?", editText, editingMemory.memory_id);
      setEditingMemory(null);
      loadMemories();
    } catch (e) {
      console.error(e);
    }
  };

  const renderMemory = ({ item }: { item: any }) => (
    <Card style={styles.card} onPress={() => openEdit(item)}>
      <Card.Content>
        {item.fuzzy_date ? (
          <Text style={styles.date}>{item.fuzzy_date}</Text>
        ) : null}
        <Text style={styles.text}>{item.raw_text}</Text>
      </Card.Content>
      {item.audio_uri ? (
        <Card.Actions>
          <Button 
            icon={playingId === item.memory_id ? 'stop' : 'play'} 
            onPress={() => playAudio(item.audio_uri, item.memory_id)}
          >
            {playingId === item.memory_id ? 'Detener' : 'Escuchar Original'}
          </Button>
        </Card.Actions>
      ) : null}
    </Card>
  );

  return (
    <View style={styles.container}>
      <Appbar.Header>
        <Appbar.BackAction onPress={() => navigation.goBack()} />
        <Appbar.Content title={rootEntityName || 'Recuerdos'} />
      </Appbar.Header>

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

      <Modal visible={!!editingMemory} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBg}>
          <View style={styles.modalContent}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10}}>
              <Text style={{fontSize: 18, fontWeight: 'bold'}}>Editar Recuerdo</Text>
              <IconButton icon="close" onPress={() => setEditingMemory(null)} />
            </View>
            <TextInput
              mode="outlined"
              multiline
              value={editText}
              onChangeText={setEditText}
              style={{maxHeight: 200, marginBottom: 15}}
            />
            <Button mode="contained" onPress={saveEdit}>Guardar Cambios</Button>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
