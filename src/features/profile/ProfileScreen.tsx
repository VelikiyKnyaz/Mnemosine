import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Appbar, TextInput, Button, Title, Paragraph } from 'react-native-paper';
import { getDb } from '../../core/database';
import { v4 as uuidv4 } from 'uuid';
import 'react-native-get-random-values';

export default function ProfileScreen() {
  const [profileId, setProfileId] = useState<string | null>(null);
  const [birthDate, setBirthDate] = useState('');
  const [hometown, setHometown] = useState('');
  const [lifeEvents, setLifeEvents] = useState('');
  const [loading, setLoading] = useState(false);

  const loadProfile = async () => {
    try {
      const db = await getDb();
      const profile = await db.getFirstAsync<any>('SELECT * FROM user_profile LIMIT 1');
      if (profile) {
        setProfileId(profile.id);
        setBirthDate(profile.birth_date || '');
        setHometown(profile.hometown || '');
        setLifeEvents(profile.life_events || '');
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const handleSave = async () => {
    setLoading(true);
    try {
      const db = await getDb();
      if (profileId) {
        await db.runAsync(
          'UPDATE user_profile SET birth_date = ?, hometown = ?, life_events = ? WHERE id = ?',
          birthDate.trim(), hometown.trim(), lifeEvents.trim(), profileId
        );
      } else {
        const newId = uuidv4();
        await db.runAsync(
          'INSERT INTO user_profile (id, birth_date, hometown, life_events) VALUES (?, ?, ?, ?)',
          newId, birthDate.trim(), hometown.trim(), lifeEvents.trim()
        );
        setProfileId(newId);
      }
      Alert.alert('Guardado', 'Perfil actualizado exitosamente. Esto ayudará a la IA a calcular mejor las fechas.');
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'No se pudo guardar el perfil.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Appbar.Header>
        <Appbar.Content title="Mi Perfil" />
      </Appbar.Header>
      <ScrollView style={styles.content}>
        <Title style={styles.title}>Datos Base para la IA</Title>
        <Paragraph style={styles.hint}>
          Estos datos se usan localmente para que Mnemósine entienda contextos como "cuando era niño" o "en mi ciudad".
        </Paragraph>

        <TextInput
          label="Año de Nacimiento (YYYY)"
          value={birthDate}
          onChangeText={setBirthDate}
          style={styles.input}
          keyboardType="numeric"
          placeholder="Ej: 1990"
          mode="outlined"
        />

        <TextInput
          label="Ciudad Natal / Base"
          value={hometown}
          onChangeText={setHometown}
          style={styles.input}
          placeholder="Ej: Medellín, Colombia"
          mode="outlined"
        />

        <TextInput
          label="Hitos de Vida (Opcional)"
          value={lifeEvents}
          onChangeText={setLifeEvents}
          style={styles.input}
          multiline
          numberOfLines={4}
          placeholder="Ej: Graduación universidad en 2015. Mudanza a España en 2020."
          mode="outlined"
        />

        <Button mode="contained" onPress={handleSave} loading={loading} style={styles.button}>
          Guardar Perfil
        </Button>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 20 },
  title: { marginBottom: 10, fontWeight: 'bold' },
  hint: { marginBottom: 20, color: '#666' },
  input: { marginBottom: 15, backgroundColor: 'white' },
  button: { marginTop: 10, paddingVertical: 5 }
});
