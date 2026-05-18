import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Dimensions, Modal, ActivityIndicator, FlatList, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { Text, Appbar, IconButton, TextInput, Button } from 'react-native-paper';
import { getDb } from '../core/database';
import { v4 as uuidv4 } from 'uuid';
import DateTimePicker from '@react-native-community/datetimepicker';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COL_WIDTH = SCREEN_WIDTH / 2;
const ITEM_HEIGHT = 65;

const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const formatDate = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const parseDateLocal = (dateStr: string) => {
  const [yyyy, mm, dd] = dateStr.split('-');
  return new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
};

const getBounds = (dateStr: string) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { y, m: m - 1, d };
};

interface TimeCascadeSelectorProps {
  visible: boolean;
  onClose: () => void;
  onSelectTime: (entity: any) => void;
  onManageCustom: () => void;
}

type ColumnType = 'ROOT' | 'YEARS' | 'MONTHS' | 'DAYS' | 'SUBPERIODS';

interface ColumnData {
  id: string;
  type: ColumnType;
  title: string;
  items: any[];
  activeIndex?: number; // Para mantener el color del item seleccionado
  stageId?: string; // Para saber a qué etapa pertenece la columna
}

export default function TimeCascadeSelector({ visible, onClose, onSelectTime, onManageCustom }: TimeCascadeSelectorProps) {
  const [loading, setLoading] = useState(true);
  const [columns, setColumns] = useState<ColumnData[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  const [startYear, setStartYear] = useState(1990);
  const [endYear, setEndYear] = useState(new Date().getFullYear());
  
  const [allStages, setAllStages] = useState<any[]>([]);

  // Inline Form State
  const [inlineFormVisible, setInlineFormVisible] = useState(false);
  const [showPicker, setShowPicker] = useState<'start' | 'end' | null>(null);
  const [formData, setFormData] = useState({
    parent_id: null as string | null,
    name: '',
    startDate: new Date(),
    endDate: new Date()
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      loadData();
    } else {
      setColumns([]);
    }
  }, [visible]);

  const loadData = async () => {
    setLoading(true);
    const db = await getDb();
    
    const profile = await db.getFirstAsync<any>('SELECT birth_date FROM user_profile LIMIT 1');
    let bYear = 1990;
    if (profile?.birth_date) {
      bYear = parseInt(profile.birth_date.split('-')[0]);
    }
    
    if (bYear && !isNaN(bYear)) {
       const { generateLifecycleStages } = require('../core/chrono_engine');
       await generateLifecycleStages(bYear);
    }

    const currentYear = new Date().getFullYear();
    setStartYear(bYear);
    setEndYear(currentYear + 5);

    const entities = await db.getAllAsync<any>("SELECT id, name, metadata FROM entities WHERE type = 'TIME'");
    
    const rootItems: any[] = [
      { id: 'all_years', type: 'ALL_YEARS', label: 'Toda mi vida (Años)', name: 'Toda mi vida', start_date: `${bYear}-01-01`, end_date: `${currentYear + 5}-12-31` }
    ];
    
    const gen: any[] = [];
    const rootCust: any[] = [];
    const allStg: any[] = [];
    
    for (const e of entities) {
      if (e.metadata) {
        try {
          const meta = typeof e.metadata === 'string' ? JSON.parse(e.metadata) : e.metadata;
          if (meta.start_date && meta.end_date) {
            const payload = {
              id: e.id,
              type: 'STAGE',
              label: e.name,
              name: e.name,
              start_date: meta.start_date,
              end_date: meta.end_date,
              baseYear: parseInt(meta.start_date.split('-')[0]),
              parent_id: meta.parent_id || null
            };
            
            allStg.push(payload);

            if (meta.is_custom_period === 1) {
              if (!meta.parent_id) {
                rootCust.push({ ...payload, label: `🌟 ${e.name}` });
              }
            } else {
              gen.push(payload);
            }
          }
        } catch (err) {}
      }
    }

    setAllStages(allStg);

    gen.sort((a,b) => a.baseYear - b.baseYear);
    rootCust.sort((a,b) => a.baseYear - b.baseYear);

    const rootItemsList: any[] = [...rootItems];
    
    if (gen.length > 0) {
      rootItemsList.push({ id: 'h_bio', isHeader: true, label: 'Etapas Biológicas / Generales' });
      rootItemsList.push(...gen);
    }
    
    if (rootCust.length > 0) {
      rootItemsList.push({ id: 'h_cust', isHeader: true, label: 'Periodos Personales' });
      rootItemsList.push(...rootCust);
    }

    rootItemsList.push({ id: 'btn_add_root', type: 'ADD_BUTTON', label: '+ Nuevo Periodo Principal', parentId: null });

    const initialCol: ColumnData = {
      id: 'col_0_root',
      type: 'ROOT',
      title: 'Etapas Principales',
      items: rootItemsList
    };

    setColumns([initialCol]);
    setLoading(false);
  };

  const reloadDataInPlace = async () => {
    const db = await getDb();
    const entities = await db.getAllAsync<any>("SELECT id, name, metadata FROM entities WHERE type = 'TIME'");
    
    const gen: any[] = [];
    const rootCust: any[] = [];
    const allStg: any[] = [];
    
    for (const e of entities) {
      if (e.metadata) {
        try {
          const meta = typeof e.metadata === 'string' ? JSON.parse(e.metadata) : e.metadata;
          if (meta.start_date && meta.end_date) {
            const payload = {
              id: e.id, type: 'STAGE', label: e.name, name: e.name,
              start_date: meta.start_date, end_date: meta.end_date,
              baseYear: parseInt(meta.start_date.split('-')[0]),
              parent_id: meta.parent_id || null
            };
            allStg.push(payload);
            if (meta.is_custom_period === 1) {
              if (!meta.parent_id) rootCust.push({ ...payload, label: `🌟 ${e.name}` });
            } else {
              gen.push(payload);
            }
          }
        } catch (err) {}
      }
    }

    setAllStages(allStg);
    gen.sort((a,b) => a.baseYear - b.baseYear);
    rootCust.sort((a,b) => a.baseYear - b.baseYear);

    setColumns(prevCols => {
       return prevCols.map(col => {
          if (col.type === 'ROOT') {
             const rootItemsList: any[] = [
               { id: 'all_years', type: 'ALL_YEARS', label: 'Toda mi vida (Años)', name: 'Toda mi vida', start_date: `${startYear}-01-01`, end_date: `${endYear}-12-31` }
             ];
             if (gen.length > 0) {
               rootItemsList.push({ id: 'h_bio', isHeader: true, label: 'Etapas Biológicas / Generales' });
               rootItemsList.push(...gen);
             }
             if (rootCust.length > 0) {
               rootItemsList.push({ id: 'h_cust', isHeader: true, label: 'Periodos Personales' });
               rootItemsList.push(...rootCust);
             }
             rootItemsList.push({ id: 'btn_add_root', type: 'ADD_BUTTON', label: '+ Nuevo Periodo Principal', parentId: null });
             return { ...col, items: rootItemsList };
          } else if (col.type === 'SUBPERIODS') {
             const children = allStg.filter(s => s.parent_id === col.stageId).map(s => ({ ...s, label: `🌟 ${s.name}` }));
             children.sort((a,b) => a.baseYear - b.baseYear);
             const itemsList = [...children];
             itemsList.push({ id: `btn_add_sub_${col.stageId}`, type: 'ADD_BUTTON', label: '+ Añadir Sub-periodo', parentId: col.stageId });
             return { ...col, items: itemsList };
          }
          return col;
       });
    });
  };

  const generateYears = (startStr: string, endStr: string) => {
    const s = getBounds(startStr);
    const e = getBounds(endStr);
    const arr = [];
    for (let y = s.y; y <= e.y; y++) {
      arr.push({ id: `y_${y}`, type: 'YEAR', label: `Año ${y}`, name: `Año ${y}`, year: y, start_date: `${y}-01-01`, end_date: `${y}-12-31`, limitStart: startStr, limitEnd: endStr });
    }
    return arr;
  };

  const generateMonths = (y: number, limitStart: string, limitEnd: string) => {
    const s = getBounds(limitStart);
    const e = getBounds(limitEnd);
    let startMonth = 0;
    let endMonth = 11;
    if (y === s.y) startMonth = s.m;
    if (y === e.y) endMonth = e.m;
    
    const arr = [];
    for (let m = startMonth; m <= endMonth; m++) {
      const mm = String(m + 1).padStart(2, '0');
      arr.push({ id: `m_${y}_${m}`, type: 'MONTH', label: monthNames[m], name: `${monthNames[m]} ${y}`, year: y, month: m, start_date: `${y}-${mm}-01`, end_date: `${y}-${mm}-28`, limitStart, limitEnd });
    }
    return arr;
  };

  const generateDays = (y: number, m: number, limitStart: string, limitEnd: string) => {
    const s = getBounds(limitStart);
    const e = getBounds(limitEnd);
    let startDay = 1;
    let endDay = new Date(y, m + 1, 0).getDate();
    if (y === s.y && m === s.m) startDay = s.d;
    if (y === e.y && m === e.m) endDay = e.d;
    
    const arr = [];
    const mm = String(m + 1).padStart(2, '0');
    const mName = monthNames[m];
    for (let d = startDay; d <= endDay; d++) {
      const dd = String(d).padStart(2, '0');
      arr.push({ id: `d_${y}_${m}_${d}`, type: 'DAY', label: `${d}`, name: `${d} de ${mName} ${y}`, year: y, month: m, day: d, start_date: `${y}-${mm}-${dd}`, end_date: `${y}-${mm}-${dd}` });
    }
    return arr;
  };

  const handleItemPress = (item: any, colIndex: number, itemIndex: number) => {
    let newCols = columns.slice(0, colIndex + 1);
    newCols[colIndex].activeIndex = itemIndex;

    let newCol: ColumnData | null = null;

    if (item.type === 'ALL_YEARS') {
      newCol = { id: `years_all`, type: 'YEARS', title: 'Años', items: generateYears(item.start_date, item.end_date) };
    } else if (item.type === 'STAGE') {
      const sStr = item.start_date;
      const eStr = item.end_date;
      
      const children = allStages.filter(s => s.parent_id === item.id).map(s => ({ ...s, label: `🌟 ${s.name}` }));
      children.sort((a,b) => a.baseYear - b.baseYear);

      if (children.length > 0) {
         const itemsList = [...children];
         itemsList.push({ id: `btn_add_sub_${item.id}`, type: 'ADD_BUTTON', label: '+ Añadir Sub-periodo', parentId: item.id });
         newCol = { id: `col_${item.id}`, type: 'SUBPERIODS', title: item.name, items: itemsList, stageId: item.id };
      } else {
         const s = getBounds(sStr);
         const e = getBounds(eStr);
         let colTitle = item.name;
         
         if (s.y === e.y) {
            if (s.m === e.m) {
               colType = 'DAYS';
               itemsList = generateDays(s.y, s.m, sStr, eStr);
               colTitle = `${item.name} (${monthNames[s.m]} ${s.y})`;
            } else {
               colType = 'MONTHS';
               itemsList = generateMonths(s.y, sStr, eStr);
               colTitle = `${item.name} (${s.y})`;
            }
         } else {
            colType = 'YEARS';
            itemsList = generateYears(sStr, eStr);
            colTitle = `Años en ${item.name}`;
         }
         
         itemsList.push({ id: `btn_add_sub_${item.id}`, type: 'ADD_BUTTON', label: '+ Añadir Sub-periodo', parentId: item.id });
         newCol = { id: `col_${item.id}`, type: colType, title: colTitle, items: itemsList, stageId: item.id };
      }
    } else if (item.type === 'YEAR') {
      newCol = { id: `months_${item.year}`, type: 'MONTHS', title: `Meses de ${item.year}`, items: generateMonths(item.year, item.limitStart, item.limitEnd) };
    } else if (item.type === 'MONTH') {
      newCol = { id: `days_${item.year}_${item.month}`, type: 'DAYS', title: `Días de ${item.label}`, items: generateDays(item.year, item.month, item.limitStart, item.limitEnd) };
    } else if (item.type === 'DAY') {
      // Día es el nivel más profundo, solo lo marcamos como activo
    }

    if (newCol) {
      const finalCols = [...newCols, newCol];
      setColumns(finalCols);
      
      // Auto-scroll to show the new column completely
      setTimeout(() => {
        scrollRef.current?.scrollTo({ x: colIndex * COL_WIDTH, animated: true });
      }, 100);
    } else {
      setColumns(newCols);
    }
  };

  const handleItemLongPress = (item: any) => {
    if (item.type === 'STAGE' && item.label.startsWith('🌟')) {
      Alert.alert('Confirmar', `¿Eliminar "${item.name}" y todos sus sub-periodos?`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: async () => {
          const db = await getDb();
          
          const idsToDelete = [item.id];
          let currentIndex = 0;
          while (currentIndex < idsToDelete.length) {
             const currentId = idsToDelete[currentIndex];
             const children = allStages.filter(s => s.parent_id === currentId).map(s => s.id);
             idsToDelete.push(...children);
             currentIndex++;
          }
          
          for (const id of idsToDelete) {
             await db.runAsync("DELETE FROM entities WHERE id = ?", id);
          }
          
          await reloadDataInPlace();
        }}
      ]);
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
            if (item.type === 'ADD_BUTTON') {
              return (
                <TouchableOpacity style={styles.itemRow} onPress={() => openInlineCreate(item.parentId)}>
                  <View style={styles.itemTextContainer}>
                    <Text style={[styles.itemText, { color: '#2e7d32', fontWeight: 'bold' }]} numberOfLines={1}>
                      {item.label}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            }

            if (item.isHeader) {
              return (
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionHeaderText}>{item.label}</Text>
                </View>
              );
            }

            const isActive = col.activeIndex === index;
            const isDeepestLevel = item.type === 'DAY';
            
            return (
              <View style={[styles.itemRow, isActive && styles.itemRowActive]}>
                <TouchableOpacity 
                  style={styles.itemTextContainer}
                  onPress={() => handleItemPress(item, colIndex, index)}
                  onLongPress={() => handleItemLongPress(item)}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.itemText, isActive && styles.itemTextActive]} numberOfLines={2}>
                    {item.label}
                  </Text>
                  {!isDeepestLevel && <Text style={styles.chevron}>›</Text>}
                </TouchableOpacity>
                
                {/* Botón de Fijar Momento */}
                {isActive && (
                  <TouchableOpacity 
                    style={styles.selectBtn}
                    onPress={() => onSelectTime(item)}
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

  const openInlineCreate = (parentId: string | null = null) => {
    let defaultStart = new Date();
    let defaultEnd = new Date();
    if (parentId) {
       const parent = allStages.find(p => p.id === parentId);
       if (parent) {
         defaultStart = parseDateLocal(parent.start_date);
         defaultEnd = parseDateLocal(parent.end_date);
       }
    }
    setFormData({
      parent_id: parentId,
      name: '',
      startDate: defaultStart,
      endDate: defaultEnd
    });
    setInlineFormVisible(true);
  };

  const onDateChange = (event: any, selectedDate?: Date) => {
    const currentMode = showPicker;
    setShowPicker(null);
    if (event.type === 'set' && selectedDate) {
      if (currentMode === 'start') {
        setFormData(prev => ({ ...prev, startDate: selectedDate }));
      } else if (currentMode === 'end') {
        setFormData(prev => ({ ...prev, endDate: selectedDate }));
      }
    }
  };

  const handleInlineSave = async () => {
    if (!formData.name.trim()) return;
    const sStr = formatDate(formData.startDate);
    const eStr = formatDate(formData.endDate);
    
    if (sStr > eStr) {
      Alert.alert('Error', 'La fecha de inicio no puede ser posterior a la fecha de fin');
      return;
    }

    if (formData.parent_id) {
      const parent = allStages.find(p => p.id === formData.parent_id);
      if (parent && (sStr < parent.start_date || eStr > parent.end_date)) {
        Alert.alert('Fechas Inválidas', `Debe estar entre ${parent.start_date} y ${parent.end_date}`);
        return;
      }
    }
    
    setSaving(true);
    try {
      const db = await getDb();
      const metadata = JSON.stringify({
        start_date: sStr,
        end_date: eStr,
        is_custom_period: 1,
        parent_id: formData.parent_id
      });
      await db.runAsync(
        "INSERT INTO entities (id, type, name, metadata, is_confirmed) VALUES (?, ?, ?, ?, 1)", 
        uuidv4(), 'TIME', formData.name.trim(), metadata
      );
      
      setInlineFormVisible(false);
      await reloadDataInPlace();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Appbar.Header style={{ backgroundColor: '#2e7d32' }}>
          <Appbar.Action icon="close" color="white" onPress={onClose} />
          <Appbar.Content title="Seleccionar Momento" color="white" />
          <Appbar.Action icon="pencil-outline" color="white" onPress={onManageCustom} />
        </Appbar.Header>

        {loading ? (
          <View style={styles.center}><ActivityIndicator size="large" color="#2e7d32" /></View>
        ) : (
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
              
              {/* Filler column if only 1 column exists, to maintain UI structure */}
              {columns.length === 1 && (
                <View style={[styles.column, { backgroundColor: '#f9f9f9', justifyContent: 'center', alignItems: 'center' }]}>
                  <Text style={{ color: '#aaa', textAlign: 'center', padding: 20 }}>
                    Toca una etapa para ver sus detalles aquí.
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>
        )}

        {/* Modal Flotante de Formulario Inline */}
        <Modal
          visible={inlineFormVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setInlineFormVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.dialogContent}>
              <Text style={styles.dialogTitle}>
                {formData.parent_id ? 'Nuevo Sub-periodo' : 'Nuevo Periodo Principal'}
              </Text>
              
              <TextInput
                label="Nombre (ej. Colegio, Semestre 1)"
                value={formData.name}
                onChangeText={(t) => setFormData(prev => ({...prev, name: t}))}
                mode="outlined"
                style={{ backgroundColor: 'white', marginBottom: 20 }}
              />

              <View style={styles.datesRow}>
                <View style={{flex: 1, marginRight: 5}}>
                  <Text style={styles.dateLabel}>Desde:</Text>
                  <TouchableOpacity style={styles.dateButton} onPress={() => setShowPicker('start')}>
                    <Text style={styles.dateButtonText}>{formatDate(formData.startDate)}</Text>
                  </TouchableOpacity>
                </View>
                <View style={{flex: 1, marginLeft: 5}}>
                  <Text style={styles.dateLabel}>Hasta:</Text>
                  <TouchableOpacity style={styles.dateButton} onPress={() => setShowPicker('end')}>
                    <Text style={styles.dateButtonText}>{formatDate(formData.endDate)}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.dialogActions}>
                <Button onPress={() => setInlineFormVisible(false)} style={{marginRight: 10}} textColor="#555">Cancelar</Button>
                <Button mode="contained" onPress={handleInlineSave} loading={saving} style={{backgroundColor: '#2e7d32'}}>
                  Crear
                </Button>
              </View>
            </View>
          </View>
        </Modal>

        {/* DateTimePicker nativo */}
        {showPicker && (
          <DateTimePicker
            value={showPicker === 'start' ? formData.startDate : formData.endDate}
            mode="date"
            display="default"
            onChange={onDateChange}
          />
        )}
      </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fafafa'
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  horizontalScroll: {
    flex: 1
  },
  column: {
    width: COL_WIDTH,
    borderRightWidth: 1,
    borderColor: '#e0e0e0',
    backgroundColor: '#fff'
  },
  colHeader: {
    backgroundColor: '#e8f5e9',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#c8e6c9',
    alignItems: 'center',
    paddingHorizontal: 10
  },
  colHeaderText: {
    fontWeight: 'bold',
    color: '#2e7d32',
    fontSize: 14
  },
  sectionHeader: {
    backgroundColor: '#f5f5f5',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderColor: '#e0e0e0',
    marginTop: 5
  },
  sectionHeaderText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#757575',
    textTransform: 'uppercase'
  },
  itemRow: {
    flexDirection: 'row',
    height: ITEM_HEIGHT,
    borderBottomWidth: 1,
    borderColor: '#f0f0f0',
    alignItems: 'center'
  },
  itemRowActive: {
    backgroundColor: '#e3f2fd' // Azul claro para indicar el camino seleccionado
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
    color: '#1565c0'
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
    backgroundColor: '#2e7d32',
    borderRadius: 4
  },
  selectBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold'
  },
  inlineAddBtn: {
    backgroundColor: '#e8f5e9',
    padding: 12,
    alignItems: 'center',
    borderTopWidth: 1,
    borderColor: '#c8e6c9'
  },
  inlineAddBtnText: {
    color: '#2e7d32',
    fontWeight: 'bold'
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20
  },
  dialogContent: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    elevation: 5
  },
  dialogTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15
  },
  datesRow: {
    flexDirection: 'row',
    marginBottom: 20
  },
  dateLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 5,
    fontWeight: 'bold'
  },
  dateButton: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    backgroundColor: '#fafafa'
  },
  dateButtonText: {
    fontSize: 16,
    color: '#333'
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end'
  }
});
