import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Dimensions, Modal, FlatList, TouchableOpacity, ScrollView } from 'react-native';
import { Text, Appbar } from 'react-native-paper';
import { EMOTIONS_HIERARCHY } from '../core/emotions';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COL_WIDTH = SCREEN_WIDTH / 2;
const ITEM_HEIGHT = 65;

interface EmotionCascadeSelectorProps {
  visible: boolean;
  onClose: () => void;
  onSelectEmotion: (emotionPath: string) => void;
}

interface ColumnData {
  id: string;
  title: string;
  items: EmotionItem[];
  activeIndex?: number;
}

interface EmotionItem {
  id: string;
  label: string;
  path: string;
  hasChildren: boolean;
  childrenKeys?: string[];
  level: number;
}

export default function EmotionCascadeSelector({ visible, onClose, onSelectEmotion }: EmotionCascadeSelectorProps) {
  const [columns, setColumns] = useState<ColumnData[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (visible) {
      // Build root column
      const rootItems: EmotionItem[] = Object.keys(EMOTIONS_HIERARCHY).map(key => ({
        id: `root_${key}`,
        label: key,
        path: key,
        hasChildren: true,
        childrenKeys: Object.keys(EMOTIONS_HIERARCHY[key]),
        level: 0
      }));

      setColumns([{
        id: 'col_root',
        title: 'Emociones Base',
        items: rootItems
      }]);
    } else {
      setColumns([]);
    }
  }, [visible]);

  const handleItemPress = (item: EmotionItem, colIndex: number, itemIndex: number) => {
    let newCols = columns.slice(0, colIndex + 1);
    newCols[colIndex].activeIndex = itemIndex;

    if (item.hasChildren && item.childrenKeys) {
      let nextItems: EmotionItem[] = [];

      if (item.level === 0) {
        // Level 1: Categories
        nextItems = item.childrenKeys.map(cat => ({
          id: `cat_${cat}`,
          label: cat,
          path: `${item.path} > ${cat}`,
          hasChildren: true,
          childrenKeys: EMOTIONS_HIERARCHY[item.label][cat],
          level: 1
        }));
      } else if (item.level === 1) {
        // Level 2: Specifics
        nextItems = item.childrenKeys.map(spec => ({
          id: `spec_${spec}`,
          label: spec,
          path: `${item.path} > ${spec}`,
          hasChildren: false,
          level: 2
        }));
      }

      newCols.push({
        id: `col_${item.id}`,
        title: item.label,
        items: nextItems
      });

      setColumns(newCols);

      setTimeout(() => {
        scrollRef.current?.scrollTo({ x: colIndex * COL_WIDTH, animated: true });
      }, 100);
    } else {
      setColumns(newCols);
    }
  };

  const renderColumn = (col: ColumnData, colIndex: number) => {
    return (
      <View key={col.id} style={styles.column}>
        <View style={styles.colHeader}>
          <Text style={styles.colHeaderText} numberOfLines={1}>{col.title}</Text>
        </View>
        <FlatList
          data={col.items}
          keyExtractor={item => item.id}
          renderItem={({ item, index }) => {
            const isActive = col.activeIndex === index;
            return (
              <View style={[styles.itemRow, isActive && styles.itemRowActive]}>
                <TouchableOpacity 
                  style={styles.itemTextContainer}
                  onPress={() => handleItemPress(item, colIndex, index)}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.itemText, isActive && styles.itemTextActive]} numberOfLines={2}>
                    {item.label}
                  </Text>
                  {item.hasChildren && <Text style={styles.chevron}>›</Text>}
                </TouchableOpacity>
                
                {isActive && (
                  <TouchableOpacity 
                    style={styles.selectBtn}
                    onPress={() => onSelectEmotion(item.path)}
                  >
                    <Text style={styles.selectBtnText}>ASIGNAR</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
          getItemLayout={(data, index) => ({ length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index })}
          showsVerticalScrollIndicator={false}
        />
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Appbar.Header style={{ backgroundColor: '#c2185b' }}>
        <Appbar.Action icon="close" color="white" onPress={onClose} />
        <Appbar.Content title="Sentimientos" color="white" />
      </Appbar.Header>

      <View style={styles.container}>
        <ScrollView 
          horizontal 
          ref={scrollRef}
          snapToInterval={COL_WIDTH}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          style={styles.horizontalScroll}
        >
          {columns.map((col, index) => renderColumn(col, index))}
          
          {columns.length === 1 && (
            <View style={[styles.column, { backgroundColor: '#f9f9f9', justifyContent: 'center', alignItems: 'center' }]}>
              <Text style={{ color: '#aaa', textAlign: 'center', padding: 20 }}>
                Toca una emoción para explorar más detalles.
              </Text>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fafafa' },
  horizontalScroll: { flex: 1 },
  column: {
    width: COL_WIDTH,
    borderRightWidth: 1,
    borderColor: '#e0e0e0',
    backgroundColor: '#fff'
  },
  colHeader: {
    backgroundColor: '#fce4ec',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#f8bbd0',
    alignItems: 'center',
    paddingHorizontal: 10
  },
  colHeaderText: {
    fontWeight: 'bold',
    color: '#c2185b',
    fontSize: 14
  },
  itemRow: {
    flexDirection: 'row',
    height: ITEM_HEIGHT,
    borderBottomWidth: 1,
    borderColor: '#f0f0f0',
    alignItems: 'center'
  },
  itemRowActive: {
    backgroundColor: '#fce4ec' 
  },
  itemTextContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    height: '100%'
  },
  itemText: {
    fontSize: 15,
    color: '#333',
    flex: 1
  },
  itemTextActive: {
    fontWeight: 'bold',
    color: '#880e4f'
  },
  chevron: {
    fontSize: 20,
    color: '#aaa',
    marginLeft: 5
  },
  selectBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    backgroundColor: '#c2185b',
    borderRadius: 4
  },
  selectBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold'
  }
});
