import React, { useState, useMemo } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, Keyboard } from 'react-native';
import { TextInput, Text, Chip } from 'react-native-paper';

interface SmartDropdownProps {
  label: string;
  value: string;
  onSelect: (item: { id: string; name: string } | null) => void;
  onCreateNew?: (name: string) => void;
  items: { id: string; name: string; score?: number }[];
  placeholder?: string;
}

export default function SmartDropdown({ label, value, onSelect, onCreateNew, items, placeholder }: SmartDropdownProps) {
  const [query, setQuery] = useState(value || '');
  const [showDropdown, setShowDropdown] = useState(false);

  const filtered = useMemo(() => {
    if (!query.trim()) return items.slice(0, 8);
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
        // Prioritize: match score, then pre-assigned relevance score
        if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
        return (b.score || 0) - (a.score || 0);
      })
      .slice(0, 8);
  }, [query, items]);

  const exactMatch = items.find(i => i.name.toLowerCase() === query.toLowerCase());

  return (
    <View style={styles.container}>
      <TextInput
        label={label}
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          setShowDropdown(true);
          if (!text.trim()) onSelect(null);
        }}
        onFocus={() => setShowDropdown(true)}
        placeholder={placeholder}
        mode="outlined"
        dense
        right={
          query.trim() ? (
            <TextInput.Icon icon="close" onPress={() => { setQuery(''); onSelect(null); }} />
          ) : undefined
        }
      />
      
      {showDropdown && (query.trim() || items.length > 0) && (
        <View style={styles.dropdown}>
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            renderItem={({ item }) => (
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
                  <Chip compact style={styles.suggestedChip} textStyle={{fontSize: 10}}>Sugerido</Chip>
                )}
              </TouchableOpacity>
            )}
            ListFooterComponent={
              query.trim() && !exactMatch && onCreateNew ? (
                <TouchableOpacity 
                  style={styles.createOption}
                  onPress={() => {
                    onCreateNew(query.trim());
                    setShowDropdown(false);
                    Keyboard.dismiss();
                  }}
                >
                  <Text style={styles.createText}>+ Crear "{query.trim()}"</Text>
                </TouchableOpacity>
              ) : null
            }
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
    borderRadius: 4,
    maxHeight: 200,
    elevation: 5,
    marginTop: 2,
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
  createOption: {
    padding: 12,
    backgroundColor: '#f3e5f5',
  },
  createText: {
    color: '#6200ee',
    fontWeight: 'bold',
  },
});
