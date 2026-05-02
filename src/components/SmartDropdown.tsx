import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, Keyboard, Modal, SafeAreaView, Platform, KeyboardAvoidingView } from 'react-native';
import { TextInput, Text, Chip, Appbar } from 'react-native-paper';
import { getConfig } from '../core/config';

export interface PlaceSuggestion {
  displayName: string;
  lat: number;
  lon: number;
  addressComponents?: any[];
}

interface SmartDropdownProps {
  label: string;
  value: string;
  onSelect: (item: { id: string; name: string } | null) => void;
  onCreateNew?: (name: string) => void;
  onSelectPlace?: (suggestion: PlaceSuggestion) => void;
  enablePlaces?: boolean;
  items: { id: string; name: string; score?: number }[];
  placeholder?: string;
}

export default function SmartDropdown({ 
  label, value, onSelect, onCreateNew, onSelectPlace, enablePlaces, items, placeholder 
}: SmartDropdownProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const [query, setQuery] = useState(value || '');
  const [placeResults, setPlaceResults] = useState<PlaceSuggestion[]>([]);
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
    if (!enablePlaces || !query.trim() || query.trim().length < 3) {
      setPlaceResults([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      try {
        setSearching(true);
        const apiKey = await getConfig('GOOGLE_MAPS_KEY');
        if (!apiKey) {
          setPlaceResults([]);
          return;
        }

        const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'places.displayName,places.location,places.addressComponents',
          },
          body: JSON.stringify({ textQuery: query.trim(), maxResultCount: 5 }),
        });

        const data = await res.json();
        if (data.places && data.places.length > 0) {
          const mapped: PlaceSuggestion[] = data.places.map((p: any) => ({
            displayName: p.displayName?.text || '',
            lat: p.location?.latitude || 0,
            lon: p.location?.longitude || 0,
            addressComponents: p.addressComponents || [],
          }));
          setPlaceResults(mapped);
        } else {
          setPlaceResults([]);
        }
      } catch (e) {
        console.log('Places search failed:', e);
        setPlaceResults([]);
      } finally {
        setSearching(false);
      }
    }, 500);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, enablePlaces]);

  const handleSubmit = () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    if (exactMatch) {
      onSelect(exactMatch);
      setModalVisible(false);
      return;
    }

    if (onCreateNew) {
      onCreateNew(trimmed);
      setModalVisible(false);
      return;
    }

    if (filtered.length > 0 && filtered[0].matchScore > 0) {
      setQuery(filtered[0].name);
      onSelect(filtered[0]);
      setModalVisible(false);
    }
  };

  const getPlaceAddress = (place: PlaceSuggestion) => {
    if (!place.addressComponents || place.addressComponents.length === 0) return '';
    const parts = place.addressComponents
      .filter((c: any) => c.types?.some((t: string) => ['locality', 'administrative_area_level_1', 'country'].includes(t)))
      .map((c: any) => c.longText);
    return parts.join(', ');
  };

  const hasResults = filtered.length > 0 || placeResults.length > 0;

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
            <Appbar.Content title={label} titleStyle={{fontSize: 16}} />
            <Appbar.Action icon="check" onPress={handleSubmit} />
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
                    <TextInput.Icon icon="close" onPress={() => { setQuery(''); setPlaceResults([]); }} />
                  ) : undefined
                }
              />
            </View>

            <FlatList
              data={[
                ...(query.trim() && !exactMatch && onCreateNew ? [{ _type: 'create' as const, id: '__create__', name: query.trim() }] : []),
                ...filtered.map(item => ({ ...item, _type: 'local' as const })),
                ...(filtered.length > 0 && placeResults.length > 0 ? [{ _type: 'separator' as const, id: '__sep__', name: '' }] : []),
                ...placeResults.map((pr, i) => ({ 
                  id: `place_${i}`, 
                  name: pr.displayName, 
                  _type: 'place' as const,
                  _place: pr 
                })),
              ]}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 20 }}
              renderItem={({ item }: { item: any }) => {
                if (item._type === 'create') {
                  return (
                    <TouchableOpacity 
                      style={[styles.option, { backgroundColor: '#f0f4ff' }]}
                      onPress={() => {
                        if (onCreateNew) onCreateNew(item.name);
                        setModalVisible(false);
                      }}
                    >
                      <Text style={{color: '#6200ee', fontWeight: 'bold'}}>+ Crear nuevo "{item.name}"</Text>
                    </TouchableOpacity>
                  );
                }
                if (item._type === 'separator') {
                  return (
                    <View style={styles.separatorRow}>
                      <Text style={styles.separatorText}>📍 Sugerencias del mapa</Text>
                    </View>
                  );
                }
                if (item._type === 'place') {
                  const place = item._place as PlaceSuggestion;
                  return (
                    <TouchableOpacity 
                      style={styles.placeOption}
                      onPress={() => {
                        if (onSelectPlace) onSelectPlace(place);
                        setQuery(place.displayName);
                        setModalVisible(false);
                      }}
                    >
                      <Text style={styles.placeIcon}>📍</Text>
                      <View style={{flex: 1}}>
                        <Text style={styles.placeName}>{place.displayName}</Text>
                        <Text style={styles.placeAddress} numberOfLines={1}>{getPlaceAddress(place)}</Text>
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
                query.trim().length > 2 && !searching && !onCreateNew ? (
                  <View style={styles.emptyContainer}>
                    <Text style={{color: '#888', marginBottom: 10}}>No se encontraron resultados.</Text>
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
  placeOption: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    flexDirection: 'row',
    alignItems: 'center',
  },
  placeIcon: { fontSize: 20, marginRight: 12 },
  placeName: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 2 },
  placeAddress: { fontSize: 12, color: '#888' },
  emptyContainer: { padding: 20, alignItems: 'center' },
  createBtn: {
    backgroundColor: '#f3e5f5',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  createBtnText: { color: '#6200ee', fontWeight: 'bold' },
});
