import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, Keyboard } from 'react-native';
import { TextInput, Text, Chip, Divider } from 'react-native-paper';

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
  const [query, setQuery] = useState(value || '');
  const [showDropdown, setShowDropdown] = useState(false);
  const [nominatimResults, setNominatimResults] = useState<NominatimSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return items.slice(0, 5);
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
      .slice(0, 5);
  }, [query, items]);

  const exactMatch = items.find(i => i.name.toLowerCase() === query.toLowerCase());

  // Debounced Nominatim autocomplete
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
      setShowDropdown(false);
      Keyboard.dismiss();
      return;
    }

    // If there's a Nominatim result, select the first one
    if (enableNominatim && nominatimResults.length > 0 && onSelectNominatim) {
      onSelectNominatim(nominatimResults[0]);
      setShowDropdown(false);
      Keyboard.dismiss();
      return;
    }

    if (filtered.length > 0 && filtered[0].matchScore > 0) {
      setQuery(filtered[0].name);
      onSelect(filtered[0]);
      setShowDropdown(false);
      Keyboard.dismiss();
      return;
    }

    if (onCreateNew) {
      onCreateNew(trimmed);
      setShowDropdown(false);
      Keyboard.dismiss();
    }
  };

  // Extract a short, readable name from display_name
  const shortName = (displayName: string) => {
    const parts = displayName.split(',').map(p => p.trim());
    return parts.slice(0, 3).join(', ');
  };

  const hasResults = filtered.length > 0 || nominatimResults.length > 0;

  return (
    <View style={styles.container}>
      <TextInput
        label={label}
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          setShowDropdown(true);
          if (!text.trim()) { onSelect(null); setNominatimResults([]); }
        }}
        onFocus={() => setShowDropdown(true)}
        onSubmitEditing={handleSubmit}
        returnKeyType="done"
        blurOnSubmit={false}
        placeholder={placeholder}
        mode="outlined"
        dense
        right={
          searching ? (
            <TextInput.Icon icon="loading" />
          ) : query.trim() ? (
            <TextInput.Icon icon="close" onPress={() => { setQuery(''); onSelect(null); setNominatimResults([]); }} />
          ) : undefined
        }
      />
      
      {showDropdown && (query.trim() || items.length > 0) && hasResults && (
        <View style={styles.dropdown}>
          <FlatList
            data={[
              // Local items first
              ...filtered.map(item => ({ ...item, _type: 'local' as const })),
              // Separator
              ...(filtered.length > 0 && nominatimResults.length > 0 ? [{ _type: 'separator' as const, id: '__sep__', name: '' }] : []),
              // Nominatim results
              ...nominatimResults.map((nr, i) => ({ 
                id: `nom_${i}`, 
                name: shortName(nr.display_name), 
                _type: 'nominatim' as const,
                _nominatim: nr 
              })),
            ]}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
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
                      if (onSelectNominatim) {
                        onSelectNominatim(item._nominatim);
                      }
                      setQuery(item.name.split(',')[0]);
                      setShowDropdown(false);
                      Keyboard.dismiss();
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
              // Local item
              return (
                <TouchableOpacity 
                  style={styles.option}
                  onPress={() => {
                    setQuery(item.name);
                    onSelect(item);
                    setShowDropdown(false);
                    Keyboard.dismiss();
                  }}
                >
                  <Text>{item.name}</Text>
                  {item.score && item.score > 0 && (
                    <Chip compact style={styles.suggestedChip} textStyle={{fontSize: 10}}>Guardado</Chip>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'relative', zIndex: 10, marginBottom: 10 },
  dropdown: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    maxHeight: 200,
    elevation: 20,
    zIndex: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  list: { maxHeight: 195 },
  option: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  suggestedChip: {
    backgroundColor: '#e8f5e9',
    height: 24,
  },
  separatorRow: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f5f5f5',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  separatorText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#888',
  },
  nominatimOption: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    flexDirection: 'row',
    alignItems: 'center',
  },
  nominatimIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  nominatimName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  nominatimAddress: {
    fontSize: 11,
    color: '#888',
  },
  createOption: {
    padding: 12,
    backgroundColor: '#f3e5f5',
  },
  createText: {
    color: '#6200ee',
    fontWeight: 'bold',
  },
});
