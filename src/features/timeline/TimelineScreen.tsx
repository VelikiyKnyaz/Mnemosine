import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, SectionList, Platform, Alert, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text, FAB, Appbar, IconButton, Button, TextInput } from 'react-native-paper';
import { supabase } from '../../core/supabase';
import { useAuthStore } from '../../core/store';
import { useIsFocused } from '@react-navigation/native';
import BiographerCard from '../biographer/BiographerCard';
import CaptureModal from '../capture/CaptureModal';
import MemoryEditModal from '../../components/MemoryEditModal';
import { getDb } from '../../core/database';
import { calculateDatesFromMarkers } from '../../core/chrono_engine';
import { getConfig } from '../../core/config';

// ── Helpers ──

const parseYear = (dateStr: string | null): number | null => {
  if (!dateStr) return null;
  const y = parseInt(dateStr.split('-')[0]);
  return isNaN(y) ? null : y;
};

const isFullYear = (start: string | null, end: string | null): boolean => {
  if (!start || !end) return false;
  return start.endsWith('-01-01') && end.endsWith('-12-31');
};

const formatSmartDate = (start: string | null, end: string | null): string | null => {
  if (!start && !end) return null;
  
  // Same date or exact date
  if (start && (!end || start === end)) {
    if (start.endsWith('-01-01')) return null; // Year-only, shown in section header
    const d = new Date(start + 'T12:00:00');
    return d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
  }
  
  // Range within same year and both full-year → null (year header covers it)
  if (isFullYear(start, end)) return null;
  
  // Range
  if (start && end && start !== end) {
    const s = new Date(start + 'T12:00:00');
    const e = new Date(end + 'T12:00:00');
    const sYear = s.getFullYear();
    const eYear = e.getFullYear();
    
    if (sYear === eYear) {
      if (start.endsWith('-01-01') && end.endsWith('-12-31')) return null;
      return `${s.toLocaleDateString('es', { day: 'numeric', month: 'short' })} - ${e.toLocaleDateString('es', { day: 'numeric', month: 'short' })}`;
    }
    return null; // Cross-year range, placed at midpoint year
  }
  
  return null;
};

const getMemoryYear = (mem: any): number | null => {
  const startY = parseYear(mem.start_date);
  const endY = parseYear(mem.end_date);
  
  if (startY && endY && startY !== endY) {
    return Math.round((startY + endY) / 2);
  }
  return startY || endY;
};

// ── Local date parsing (regex first, AI fallback) ──

const parseTimeMarkersLocal = (text: string): string[] => {
  const markers: string[] = [];
  const t = text.toLowerCase().trim();
  
  // "en 2018", "en el 2018", "año 2018"
  const yearMatch = t.match(/(?:en(?:\s+el)?\s+|año\s+)(\d{4})/);
  if (yearMatch) markers.push(`exact_year:${yearMatch[1]}`);
  
  // "a los 14 años", "cuando tenía 14", "tenía 14 años"
  const ageMatch = t.match(/(?:a los|ten[ií]a|con)\s+(\d{1,2})\s*(?:años?)?/);
  if (ageMatch) markers.push(`exact_age:${ageMatch[1]}`);
  
  // "hace 3 años"
  const agoMatch = t.match(/hace\s+(\d{1,2})\s*años?/);
  if (agoMatch) markers.push(`relative_years:-${agoMatch[1]}`);
  
  // "2015-06-20" or "20/06/2015"
  const dateMatch = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (dateMatch) markers.push(`exact_date:${dateMatch[0]}`);
  
  const dateMatch2 = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dateMatch2) markers.push(`exact_date:${dateMatch2[3]}-${dateMatch2[2].padStart(2,'0')}-${dateMatch2[1].padStart(2,'0')}`);
  
  // "infancia", "adolescencia"  
  if (/infancia|niñez|childhood/.test(t)) markers.push('life_stage:childhood');
  if (/adolescencia|teenage/.test(t)) markers.push('life_stage:teenage');
  
  return markers;
};

const resolveTimeMarkersWithAI = async (text: string): Promise<string[]> => {
  const apiKey = await getConfig('OPENAI_API_KEY');
  if (!apiKey) throw new Error('API Key no configurada');
  
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Extract time_markers from user text. Return JSON: {"time_markers": [...]}. Formats: "exact_year:YYYY", "exact_date:YYYY-MM-DD", "exact_age:N", "age_range:N-M", "relative_years:-N", "life_stage:childhood|teenage|adulthood".' },
        { role: 'user', content: text },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }),
  });
  
  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  return parsed.time_markers || [];
};

// ── Component ──

const MemoryCardItem = ({ item, onEdit, expanded, onToggleExpand, styles }: any) => {
  const [entities, setEntities] = useState<any[]>([]);

  useEffect(() => {
    if (expanded) {
      getDb().then(db => {
        db.getAllAsync<any>(
          "SELECT e.name, e.type FROM entities e JOIN memory_entities me ON e.id = me.entity_id WHERE me.memory_id = ?",
          item.id || item.memory_id
        ).then(setEntities);
      });
    }
  }, [expanded, item.id, item.memory_id]);

  const hasNoDate = !item.start_date && !item.end_date;

  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onToggleExpand} style={styles.memoryCard}>
      <View style={styles.cardHeader}>
        <Text variant="titleMedium" style={styles.titleText}>{item.title || 'Recuerdo'}</Text>
        <View style={styles.dateContainer}>
          {item.sync_status !== 'PROCESSED_LOCAL' && (
            <View style={[styles.dateAlert, { backgroundColor: '#E3F2FD' }]}>
              <ActivityIndicator size={12} color="#1976D2" />
              <Text style={{fontSize: 11, color: '#1976D2', marginLeft: 4}}>Procesando</Text>
            </View>
          )}
        </View>
      </View>
      
      {item.raw_text ? (
        <Text style={styles.bodyText}>
          {item.raw_text}
        </Text>
      ) : null}

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
      
      <View style={styles.cardFooter}>
        {item.audio_uri ? <Text style={styles.audioHint}>🎤 Audio</Text> : <View />}
        <Text style={styles.statusHint}>
          {item.sync_status === 'PROCESSED_LOCAL' ? '✨ IA' : '⏳ Procesando'}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

export default function TimelineScreen() {
  const setSession = useAuthStore((state) => state.setSession);
  const [modalVisible, setModalVisible] = useState(false);
  const [initialQuestion, setInitialQuestion] = useState<string | undefined>(undefined);
  const [memories, setMemories] = useState<any[]>([]);

  // Text editing state
  const [editingTextMemory, setEditingTextMemory] = useState<any>(null);
  const [expandedMemoryId, setExpandedMemoryId] = useState<string | null>(null);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  const loadMemories = async () => {
    try {
      const db = await getDb();
      const allRows = await db.getAllAsync('SELECT * FROM memories ORDER BY start_date ASC, created_at DESC');
      setMemories(allRows);
    } catch (err) {
      console.error(err);
    }
  };

  const isFocused = useIsFocused();

  useEffect(() => {
    loadMemories();
  }, [modalVisible]);

  // Auto-refresh while any memories are still processing
  useEffect(() => {
    if (!isFocused) return;
    const hasProcessing = memories.some(m => m.sync_status !== 'PROCESSED_LOCAL');
    if (!hasProcessing) return;
    
    const interval = setInterval(loadMemories, 5000);
    return () => clearInterval(interval);
  }, [isFocused, memories]);

  const handleQuestionPress = (q: string) => {
    setInitialQuestion(q);
    setModalVisible(true);
  };

  const handleFabPress = () => {
    setInitialQuestion(undefined);
    setModalVisible(true);
  };


  // ── Build sections by year ──

  const sections = React.useMemo(() => {
    const noDate: any[] = [];
    const byYear: Record<number, any[]> = {};
    
    for (const mem of memories) {
      const year = getMemoryYear(mem);
      if (!year) {
        noDate.push(mem);
      } else {
        if (!byYear[year]) byYear[year] = [];
        byYear[year].push(mem);
      }
    }
    
    const result: { title: string; data: any[] }[] = [];
    
    if (noDate.length > 0) {
      result.push({ title: 'Sin Fecha', data: noDate });
    }
    
    const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
    for (const y of years) {
      result.push({ title: String(y), data: byYear[y] });
    }
    
    return result;
  }, [memories]);

  // ── Render ──

  return (
    <View style={styles.container}>
      <Appbar.Header>
        <Appbar.Content title="Línea de Tiempo" />
        <Appbar.Action icon="logout" onPress={handleLogout} />
      </Appbar.Header>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={true}
        ListHeaderComponent={<BiographerCard onPressQuestion={handleQuestionPress} />}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionYear}>{section.title}</Text>
            <View style={styles.sectionLine} />
          </View>
        )}
        renderItem={({ item }) => (
          <MemoryCardItem 
            item={item} 
            onEdit={setEditingTextMemory} 
            expanded={expandedMemoryId === (item.id || item.memory_id)}
            onToggleExpand={() => setExpandedMemoryId(expandedMemoryId === (item.id || item.memory_id) ? null : (item.id || item.memory_id))}
            styles={styles} 
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text>No hay recuerdos aún. ¡Escribe el primero!</Text>
          </View>
        }
      />

      <FAB icon="plus" style={styles.fab} onPress={handleFabPress} />

      <CaptureModal 
        visible={modalVisible} 
        onDismiss={() => setModalVisible(false)} 
        initialQuestion={initialQuestion}
      />

      <MemoryEditModal
        visible={!!editingTextMemory}
        memory={editingTextMemory}
        onClose={() => setEditingTextMemory(null)}
        onSaved={loadMemories}
      />


    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  fab: { position: 'absolute', margin: 16, right: 0, bottom: 0 },
  
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#f5f5f5',
  },
  sectionYear: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#6200ee',
    marginRight: 12,
  },
  sectionLine: {
    flex: 1,
    height: 2,
    backgroundColor: '#e0e0e0',
    borderRadius: 1,
  },
  
  memoryCard: {
    marginHorizontal: 16, marginVertical: 6, padding: 14,
    backgroundColor: '#fff', borderRadius: 10, elevation: 1,
    borderLeftWidth: 3, borderLeftColor: '#e0e0e0',
  },
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 6,
  },
  titleText: { fontWeight: 'bold', flex: 1, fontSize: 15 },
  dateText: { color: '#8b5cf6', fontWeight: 'bold', fontSize: 12 },
  dateContainer: { flexDirection: 'row', alignItems: 'center' },
  dateAlert: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 2, backgroundColor: '#FFF3E0', borderRadius: 12 },
  bodyText: { color: '#333', lineHeight: 20, fontSize: 14 },
  cardFooter: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginTop: 10, borderTopWidth: 1,
    borderTopColor: '#f0f0f0', paddingTop: 6,
  },
  audioHint: { color: '#0284c7', fontWeight: 'bold', fontSize: 12 },
  statusHint: { fontSize: 11, color: '#888' },
  empty: { padding: 20, alignItems: 'center' },
  
  resolveOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center', zIndex: 10,
  },
  resolveModal: {
    backgroundColor: 'white', padding: 20,
    borderRadius: 12, width: '88%',
    elevation: 5,
  },
});
