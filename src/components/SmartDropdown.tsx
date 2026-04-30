import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, Keyboard, Modal, SafeAreaView, Platform, KeyboardAvoidingView } from 'react-native';
import { TextInput, Text, Chip, Appbar } from 'react-native-paper';

export interface NominatimSuggestion {
  display_name: string;
  lat: string;
  lon: string;
  address?: any;
}

interface SmartDropdownProps {
  label: string;
  value: string;
  onSelect: (item: { id: string; name: string } | null) => void;
  onCreateNew?: (name: string) => void;
  onSelectNominatim?: (suggestion: NominatimSuggestion) => void;
  enableNominatim?: boolean;
  items: { id: string; name: string; score?: number }[];
  placeholder?: string;
}

export default function SmartDropdown({ 
  label, value, onSelect, onCreateNew, onSelectNominatim, enableNominatim, items, placeholder 
}: SmartDropdownProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const [query, setQuery] = useState(value || '');
  const [nominatimResults, setNominatimResults] = useState<NominatimSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return items.slice(0, 15);
    const q = query.toLowerCase();
    return items
      .map(item => ({
        ...item,
        matchScore: item.name.toLowerCase().startsWith(q) ? 2 
          : item.name.toLowerCase().includes(q) ? 1 
          : 0
      }))
      .filter(item => item.matchScore > 0 || (item.score && item.score > 0))
      .sort((a, b) => {
        if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
        return (b.score || 0) - (a.score || 0);
      })
      .slice(0, 15);
  }, [query, items]);

  const exactMatch = items.find(i => i.name.toLowerCase() === query.toLowerCase());

  useEffect(() => {
    if (!enableNominatim || !query.trim() || query.trim().length < 3) {
      setNominatimResults([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      try {
        setSearching(true);
        const q = encodeURIComponent(query.trim());
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=5&addressdetails=1`,
          { headers: { 'User-Agent': 'MnemosineApp/1.0 (memory@app.com)' } }
        );
        const data = await res.json();
        setNominatimResults(data || []);
      } catch (e) {
        console.log('Nominatim autocomplete failed:', e);
        setNominatimResults([]);
      } finally {
        setSearching(false);
      }
    }, 500);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, enableNominatim]);

  const handleSubmit = () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    if (exactMatch) {
      onSelect(exactMatch);
      setModalVisible(false);
      return;
    }

    if (enableNominatim && nominatimResults.length > 0 && onSelectNominatim) {
      onSelectNominatim(nominatimResults[0]);
      setModalVisible(false);
      return;
    }

    if (filtered.length > 0 && filtered[0].matchScore > 0) {
      setQuery(filtered[0].name);
      onSelect(filtered[0]);
      setModalVisible(false);
      return;
    }

    if (onCreateNew) {
      onCreateNew(trimmed);
      setModalVisible(false);
    }
  };

  const shortName = (displayName: string) => {
    const parts = displayName.split(',').map(p => p.trim());
    return parts.slice(0, 3).join(', ');
  };

  const hasResults = filtered.length > 0 || nominatimResults.length > 0;

  return (
    <View style={styles.container}>
      {/* Fake input that opens the modal */}
      <TouchableOpacity activeOpacity={0.8} onPress={() => setModalVisible(true)}>
        <View pointerEvents="none">
          <TextInput
            label={label}
            value={value || query}
            placeholder={placeholder}
            mode="outlined"
            dense
            right={<TextInput.Icon icon="magnify" />}
          />
        </View>
      </TouchableOpacity>

      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalVisible(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <Appbar.Header style={{ backgroundColor: 'white', elevation: 0 }}>
            <Appbar.BackAction onPress={() => setModalVisible(false)} />
            <Appbar.Content title="Asignar Lugar Padre" titleStyle={{fontSize: 16}} />
          </Appbar.Header>

          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <View style={styles.searchHeader}>
              <TextInput
                autoFocus
                label={label}
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={handleSubmit}
                returnKeyType="done"
                mode="outlined"
                dense
                right={
                  searching ? (
                    <TextInput.Icon icon="loading" />
                  ) : query.trim() ? (
                    <TextInput.Icon icon="close" onPress={() => { setQuery(''); setNominatimResults([]); }} />
                  ) : undefined
                }
              />
            </View>

            <FlatList
              data={[
                ...filtered.map(item => ({ ...item, _type: 'local' as const })),
                ...(filtered.length > 0 && nominatimResults.length > 0 ? [{ _type: 'separator' as const, id: '__sep__', name: '' }] : []),
                ...nominatimResults.map((nr, i) => ({ 
                  id: `nom_${i}`, 
                  name: shortName(nr.display_name), 
                  _type: 'nominatim' as const,
                  _nominatim: nr 
                })),
              ]}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 20 }}
              renderItem={({ item }: { item: any }) => {
                if (item._type === 'separator') {
                  return (
                    <View style={styles.separatorRow}>
                      <Text style={styles.separatorText}>📍 Sugerencias del mapa</Text>
                    </View>
                  );
                }
                if (item._type === 'nominatim') {
                  return (
                    <TouchableOpacity 
                      style={styles.nominatimOption}
                      onPress={() => {
                        if (onSelectNominatim) onSelectNominatim(item._nominatim);
                        setQuery(item.name.split(',')[0]);
                        setModalVisible(false);
                      }}
                    >
                      <Text style={styles.nominatimIcon}>📍</Text>
                      <View style={{flex: 1}}>
                        <Text style={styles.nominatimName}>{item.name.split(',')[0]}</Text>
                        <Text style={styles.nominatimAddress} numberOfLines={1}>{item.name}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                }
                return (
                  <TouchableOpacity 
                    style={styles.option}
                    onPress={() => {
                      setQuery(item.name);
                      onSelect(item);
                      setModalVisible(false);
                    }}
                  >
                    <Text style={styles.localName}>{item.name}</Text>
                    {item.score && item.score > 0 && (
                      <Chip compact style={styles.suggestedChip} textStyle={{fontSize: 10}}>Guardado</Chip>
                    )}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                query.trim().length > 2 && !searching ? (
                  <View style={styles.emptyContainer}>
                    <Text style={{color: '#888', marginBottom: 10}}>No se encontraron resultados.</Text>
                    {onCreateNew && (
                      <TouchableOpacity onPress={() => { onCreateNew(query.trim()); setModalVisible(false); }} style={styles.createBtn}>
                        <Text style={styles.createBtnText}>+ Crear manualmente "{query.trim()}"</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : null
              }
            />
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 10 },
  modalContainer: { flex: 1, backgroundColor: 'white' },
  searchHeader: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  option: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  localName: { fontSize: 16, color: '#333' },
  suggestedChip: { backgroundColor: '#e8f5e9', height: 24 },
  separatorRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#f5f5f5',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  separatorText: { fontSize: 12, fontWeight: 'bold', color: '#888' },
  nominatimOption: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    flexDirection: 'row',
    alignItems: 'center',
  },
  nominatimIcon: { fontSize: 20, marginRight: 12 },
  nominatimName: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 2 },
  nominatimAddress: { fontSize: 12, color: '#888' },
  emptyContainer: { padding: 20, alignItems: 'center' },
  createBtn: {
    backgroundColor: '#f3e5f5',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  createBtnText: { color: '#6200ee', fontWeight: 'bold' },
});
