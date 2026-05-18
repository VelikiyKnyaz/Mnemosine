import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, Modal } from 'react-native';
import { Appbar, TextInput, Button, IconButton, Text, Card } from 'react-native-paper';
import { getDb } from '../../core/database';
import { v4 as uuidv4 } from 'uuid';

interface CustomTimePeriodsScreenProps {
  visible: boolean;
  onClose: () => void;
}

export default function CustomTimePeriodsScreen({ visible, onClose }: CustomTimePeriodsScreenProps) {
  const [periods, setPeriods] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);

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
            custom.push({ ...e, start_date: meta.start_date, end_date: meta.end_date });
          }
        } catch (err) {}
      }
    }
    setPeriods(custom);
  };

  const handleSave = async () => {
    if (!name.trim() || !startDate.trim() || !endDate.trim()) {
      Alert.alert('Error', 'Todos los campos son obligatorios');
      return;
    }
    
    // Basic date validation YYYY-MM-DD
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      Alert.alert('Error', 'El formato de fecha debe ser YYYY-MM-DD');
      return;
    }

    setLoading(true);
    try {
      const db = await getDb();
      const metadata = JSON.stringify({
        start_date: startDate,
        end_date: endDate,
        is_custom_period: 1
      });
      
      await db.runAsync(
        "INSERT INTO entities (id, type, name, metadata, is_confirmed) VALUES (?, ?, ?, ?, 1)",
        uuidv4(), 'TIME', name.trim(), metadata
      );
      
      setName('');
      setStartDate('');
      setEndDate('');
      loadPeriods();
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'No se pudo guardar el periodo');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    Alert.alert('Confirmar', '¿Eliminar este periodo?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: async () => {
        const db = await getDb();
        await db.runAsync("DELETE FROM entities WHERE id = ?", id);
        loadPeriods();
      }}
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Appbar.Header style={{ backgroundColor: '#2e7d32' }}>
        <Appbar.BackAction color="white" onPress={onClose} />
        <Appbar.Content title="Periodos Personalizados" color="white" />
      </Appbar.Header>
      
      <ScrollView style={styles.container}>
        <View style={styles.form}>
          <Text style={styles.title}>Nuevo Periodo</Text>
          <TextInput
            label="Nombre (ej. Universidad, Viaje a Japón)"
            value={name}
            onChangeText={setName}
            mode="outlined"
            style={styles.input}
          />
          <View style={styles.row}>
            <TextInput
              label="Inicio (YYYY-MM-DD)"
              value={startDate}
              onChangeText={setStartDate}
              mode="outlined"
              style={[styles.input, { flex: 1, marginRight: 5 }]}
            />
            <TextInput
              label="Fin (YYYY-MM-DD)"
              value={endDate}
              onChangeText={setEndDate}
              mode="outlined"
              style={[styles.input, { flex: 1, marginLeft: 5 }]}
            />
          </View>
          <Button mode="contained" onPress={handleSave} loading={loading} style={styles.button}>
            Guardar Periodo
          </Button>
        </View>

        <View style={styles.list}>
          <Text style={styles.title}>Mis Periodos</Text>
          {periods.length === 0 && <Text style={{ color: '#888' }}>No hay periodos guardados.</Text>}
          {periods.map(p => (
            <Card key={p.id} style={styles.card}>
              <Card.Title 
                title={p.name} 
                subtitle={`${p.start_date} a ${p.end_date}`}
                right={(props) => <IconButton {...props} icon="delete" onPress={() => handleDelete(p.id)} />}
              />
            </Card>
          ))}
        </View>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  form: {
    padding: 20,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  row: {
    flexDirection: 'row',
  },
  input: {
    marginBottom: 10,
    backgroundColor: 'white'
  },
  button: {
    marginTop: 10,
    backgroundColor: '#2e7d32'
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#333'
  },
  list: {
    padding: 20,
  },
  card: {
    marginBottom: 10,
    backgroundColor: 'white'
  }
});
