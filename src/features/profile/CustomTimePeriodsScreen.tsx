import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, Modal, TouchableOpacity, Platform } from 'react-native';
import { Appbar, TextInput, Button, IconButton, Text, Portal } from 'react-native-paper';
import { getDb } from '../../core/database';
import { v4 as uuidv4 } from 'uuid';
import DateTimePicker from '@react-native-community/datetimepicker';

interface CustomTimePeriodsScreenProps {
  visible: boolean;
  onClose: () => void;
}

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

export default function CustomTimePeriodsScreen({ visible, onClose }: CustomTimePeriodsScreenProps) {
  const [periods, setPeriods] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Form State
  const [formVisible, setFormVisible] = useState(false);
  const [showPicker, setShowPicker] = useState<'start' | 'end' | null>(null);
  const [formData, setFormData] = useState({
    id: null as string | null,
    parent_id: null as string | null,
    name: '',
    startDate: new Date(),
    endDate: new Date()
  });

  useEffect(() => {
    if (visible) {
      loadPeriods();
    }
  }, [visible]);

  const loadPeriods = async () => {
    const db = await getDb();
    const entities = await db.getAllAsync<any>("SELECT * FROM entities WHERE type = 'TIME'");
    const custom = [];
    for (const e of entities) {
      if (e.metadata) {
        try {
          const meta = typeof e.metadata === 'string' ? JSON.parse(e.metadata) : e.metadata;
          if (meta.is_custom_period === 1) {
            custom.push({ 
              ...e, 
              start_date: meta.start_date, 
              end_date: meta.end_date,
              parent_id: meta.parent_id || null
            });
          }
        } catch (err) {}
      }
    }
    custom.sort((a,b) => a.start_date.localeCompare(b.start_date));
    setPeriods(custom);
  };

  const openCreateModal = (parentId: string | null = null) => {
    // Si tiene un padre, por defecto las fechas se inicializan en el rango del padre para facilitar la vida
    let defaultStart = new Date();
    let defaultEnd = new Date();
    if (parentId) {
       const parent = periods.find(p => p.id === parentId);
       if (parent) {
         defaultStart = parseDateLocal(parent.start_date);
         defaultEnd = parseDateLocal(parent.end_date);
       }
    }

    setFormData({
      id: null,
      parent_id: parentId,
      name: '',
      startDate: defaultStart,
      endDate: defaultEnd
    });
    setFormVisible(true);
  };

  const openEditModal = (period: any) => {
    setFormData({
      id: period.id,
      parent_id: period.parent_id,
      name: period.name,
      startDate: parseDateLocal(period.start_date),
      endDate: parseDateLocal(period.end_date)
    });
    setFormVisible(true);
  };

  const onDateChange = (event: any, selectedDate?: Date) => {
    const currentMode = showPicker;
    setShowPicker(null); // Ocultar picker nativo

    if (event.type === 'set' && selectedDate) {
      if (currentMode === 'start') {
        setFormData(prev => ({ ...prev, startDate: selectedDate }));
      } else if (currentMode === 'end') {
        setFormData(prev => ({ ...prev, endDate: selectedDate }));
      }
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      Alert.alert('Error', 'El nombre es obligatorio');
      return;
    }

    const sStr = formatDate(formData.startDate);
    const eStr = formatDate(formData.endDate);

    if (sStr > eStr) {
      Alert.alert('Error', 'La fecha de inicio no puede ser posterior a la fecha de fin');
      return;
    }

    if (formData.parent_id) {
      const parent = periods.find(p => p.id === formData.parent_id);
      if (parent) {
        if (sStr < parent.start_date || eStr > parent.end_date) {
          Alert.alert(
            'Fechas Inválidas', 
            `Las fechas deben estar dentro del límite de su padre "${parent.name}" (${parent.start_date} a ${parent.end_date})`
          );
          return;
        }
      }
    }

    setLoading(true);
    try {
      const db = await getDb();
      const metadata = JSON.stringify({
        start_date: sStr,
        end_date: eStr,
        is_custom_period: 1,
        parent_id: formData.parent_id
      });
      
      if (formData.id) {
        await db.runAsync(
          "UPDATE entities SET name = ?, metadata = ? WHERE id = ?",
          formData.name.trim(), metadata, formData.id
        );
      } else {
        await db.runAsync(
          "INSERT INTO entities (id, type, name, metadata, is_confirmed) VALUES (?, ?, ?, ?, 1)",
          uuidv4(), 'TIME', formData.name.trim(), metadata
        );
      }
      
      setFormVisible(false);
      loadPeriods();
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'No se pudo guardar el periodo');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    const hasChildren = periods.some(p => p.parent_id === id);
    if (hasChildren) {
      Alert.alert('Error', 'No puedes eliminar este periodo porque contiene sub-periodos. Elimina primero los sub-periodos.');
      return;
    }

    Alert.alert('Confirmar', '¿Eliminar este periodo?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: async () => {
        const db = await getDb();
        await db.runAsync("DELETE FROM entities WHERE id = ?", id);
        loadPeriods();
      }}
    ]);
  };

  const renderPeriodList = (parentIdFilter: string | null, depth: number = 0) => {
    const filtered = periods.filter(p => p.parent_id === parentIdFilter);
    return filtered.map(p => (
      <View key={p.id}>
        <View style={[styles.card, { marginLeft: depth * 15 }]}>
          <View style={styles.cardHeader}>
            <View style={{flex: 1}}>
              <Text style={[styles.cardTitle, { fontSize: depth === 0 ? 16 : 14 }]} numberOfLines={2}>
                {depth > 0 && '↳ '} {p.name}
              </Text>
              <Text style={styles.cardDates}>{p.start_date} a {p.end_date}</Text>
            </View>
            <View style={styles.cardActions}>
              <IconButton 
                icon="plus" 
                size={20} 
                iconColor="#2e7d32" 
                onPress={() => openCreateModal(p.id)} 
                style={styles.iconBtn}
              />
              <IconButton 
                icon="pencil" 
                size={20} 
                iconColor="#555" 
                onPress={() => openEditModal(p)} 
                style={styles.iconBtn}
              />
              <IconButton 
                icon="delete" 
                size={20} 
                iconColor="#d32f2f" 
                onPress={() => handleDelete(p.id)} 
                style={styles.iconBtn}
              />
            </View>
          </View>
        </View>
        {renderPeriodList(p.id, depth + 1)}
      </View>
    ));
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Appbar.Header style={{ backgroundColor: '#2e7d32' }}>
          <Appbar.Action icon="close" color="white" onPress={onClose} />
          <Appbar.Content title="Mi Árbol de Tiempo" color="white" />
        </Appbar.Header>
        
        <ScrollView style={styles.container}>
          <View style={styles.list}>
            <Button 
              icon="plus" 
              mode="contained" 
              onPress={() => openCreateModal(null)}
              style={styles.mainAddButton}
            >
              Nuevo Periodo Principal
            </Button>

            {periods.length === 0 && <Text style={{ color: '#888', textAlign: 'center', marginTop: 20 }}>No hay periodos guardados.</Text>}
            <View style={{marginTop: 15}}>
              {renderPeriodList(null, 0)}
            </View>
          </View>
        </ScrollView>

        {/* Modal Flotante de Formulario */}
        <Modal
          visible={formVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setFormVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.dialogContent}>
              <Text style={styles.dialogTitle}>
                {formData.id ? 'Editar Periodo' : formData.parent_id ? 'Nuevo Sub-periodo' : 'Nuevo Periodo Principal'}
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
                <Button onPress={() => setFormVisible(false)} style={{marginRight: 10}} textColor="#555">Cancelar</Button>
                <Button mode="contained" onPress={handleSave} loading={loading} style={{backgroundColor: '#2e7d32'}}>
                  Guardar
                </Button>
              </View>
            </View>
          </View>
        </Modal>

        {/* DateTimePicker nativo (solo se monta si showPicker es true) */}
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
    backgroundColor: '#f5f5f5',
  },
  list: {
    padding: 15,
  },
  mainAddButton: {
    backgroundColor: '#2e7d32',
    paddingVertical: 5,
    borderRadius: 8
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#2e7d32',
    elevation: 1
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 10,
    paddingLeft: 12
  },
  cardTitle: {
    fontWeight: 'bold',
    color: '#333'
  },
  cardDates: {
    fontSize: 12,
    color: '#888',
    marginTop: 2
  },
  cardActions: {
    flexDirection: 'row'
  },
  iconBtn: {
    margin: 0,
    padding: 0
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
