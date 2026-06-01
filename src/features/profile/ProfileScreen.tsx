import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Alert, Image, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Appbar, TextInput, Button, Text, Card, Title, Paragraph, List, Divider } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import { getDb } from '../../core/database';
import { supabase, uploadAvatar } from '../../core/supabase';
import { useAuthStore } from '../../core/store';
import { v4 as uuidv4 } from 'uuid';
import 'react-native-get-random-values';
import SmartDropdown from '../../components/SmartDropdown';
import { generateLifecycleStages } from '../../core/chrono_engine';

const COUNTRIES = [
  { id: 'ar', name: 'Argentina' },
  { id: 'bo', name: 'Bolivia' },
  { id: 'cl', name: 'Chile' },
  { id: 'co', name: 'Colombia' },
  { id: 'cr', name: 'Costa Rica' },
  { id: 'cu', name: 'Cuba' },
  { id: 'do', name: 'República Dominicana' },
  { id: 'ec', name: 'Ecuador' },
  { id: 'sv', name: 'El Salvador' },
  { id: 'es', name: 'España' },
  { id: 'gt', name: 'Guatemala' },
  { id: 'hn', name: 'Honduras' },
  { id: 'mx', name: 'México' },
  { id: 'ni', name: 'Nicaragua' },
  { id: 'pa', name: 'Panamá' },
  { id: 'py', name: 'Paraguay' },
  { id: 'pe', name: 'Perú' },
  { id: 'pr', name: 'Puerto Rico' },
  { id: 'uy', name: 'Uruguay' },
  { id: 've', name: 'Venezuela' },
  { id: 'us', name: 'Estados Unidos' },
];

const PRESET_AVATARS = [
  'https://api.dicebear.com/7.x/adventurer/png?seed=Felix',
  'https://api.dicebear.com/7.x/adventurer/png?seed=Aneka',
  'https://api.dicebear.com/7.x/adventurer/png?seed=Milo',
  'https://api.dicebear.com/7.x/adventurer/png?seed=Sophia',
  'https://api.dicebear.com/7.x/adventurer/png?seed=Jack',
  'https://api.dicebear.com/7.x/adventurer/png?seed=Luna',
];

export default function ProfileScreen() {
  const [profileId, setProfileId] = useState<string | null>(null);
  
  // Nuevos campos sociales
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(PRESET_AVATARS[0]);

  // Campos existentes de la IA
  const [birthDate, setBirthDate] = useState('');
  const [hometown, setHometown] = useState('');
  const [country, setCountry] = useState('');
  const [lifeEvents, setLifeEvents] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [showAiFields, setShowAiFields] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  const setSession = useAuthStore((state) => state.setSession);
  const session = useAuthStore((state) => state.session);

  const loadProfile = async () => {
    if (!session?.user?.id) return;
    try {
      const db = await getDb();
      const profile = await db.getFirstAsync<any>('SELECT * FROM user_profile WHERE id = ?', session.user.id);
      if (profile) {
        setProfileId(profile.id);
        setBirthDate(profile.birth_date || '');
        setHometown(profile.hometown || '');
        setCountry(profile.country || '');
        setLifeEvents(profile.life_events || '');
        setUsername(profile.username || '');
        setFullName(profile.full_name || '');
        setAvatarUrl(profile.avatar_url || PRESET_AVATARS[0]);
      } else {
        // Inicializar datos por defecto del email de Supabase si hay sesión
        if (session?.user?.email) {
          const defaultUsername = session.user.email.split('@')[0];
          setUsername(defaultUsername);
          setFullName(defaultUsername.charAt(0).toUpperCase() + defaultUsername.slice(1));
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [session])
  );

  const validateUsername = (name: string) => /^[a-z0-9._]{3,30}$/.test(name);

  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permiso Denegado', 'Necesitamos acceso a tu galería para cambiar tu foto.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setAvatarUrl(result.assets[0].uri);
      }
    } catch (e) {
      console.warn('Error al seleccionar imagen de la galería:', e);
      Alert.alert('Error', 'No se pudo seleccionar la imagen.');
    }
  };

  const handleAvatarPress = () => {
    Alert.alert(
      'Foto de Perfil',
      'Elige cómo actualizar tu foto de perfil:',
      [
        { text: 'Seleccionar de la galería', onPress: pickImage },
        { text: 'Elegir avatar ilustrado', onPress: () => setShowAvatarPicker(true) },
        { text: 'Cancelar', style: 'cancel' }
      ]
    );
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const db = await getDb();
      const currentUserId = session?.user?.id || profileId || uuidv4();
      
      // Subir avatar a Supabase Storage si es un archivo local
      let finalAvatarUrl = avatarUrl;
      if (avatarUrl.startsWith('file://')) {
        try {
          finalAvatarUrl = await uploadAvatar(currentUserId, avatarUrl);
          setAvatarUrl(finalAvatarUrl);
        } catch (uploadErr) {
          console.warn('Fallo al subir avatar a Supabase Storage:', uploadErr);
        }
      }

      await db.runAsync(
        'INSERT OR REPLACE INTO user_profile (id, username, full_name, avatar_url, birth_date, hometown, country, life_events) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        currentUserId,
        username,
        fullName,
        finalAvatarUrl,
        birthDate.trim(),
        hometown.trim(),
        country.trim(),
        lifeEvents.trim()
      );
      setProfileId(currentUserId);

      if (birthDate.trim()) {
        const year = parseInt(birthDate.trim().split('-')[0]);
        if (!isNaN(year)) {
          await generateLifecycleStages(year);
        }
      }

      // Sincronizar en la nube con Supabase profiles
      try {
        const { error: syncError } = await supabase.from('profiles').upsert({
          id: currentUserId,
          username: username,
          full_name: fullName,
          avatar_url: finalAvatarUrl,
          updated_at: new Date().toISOString(),
        });
        if (syncError && syncError.code !== '42P01') {
          console.warn('Fallo al sincronizar con Supabase profiles:', syncError);
        }
      } catch (err) {
        console.warn('Fallo de red al sincronizar con Supabase profiles:', err);
      }

      Alert.alert('Guardado', 'Perfil actualizado exitosamente.');
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'No se pudo guardar el perfil.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert('Cerrar sesión', '¿Estás seguro de que quieres salir?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar Sesión',
        style: 'destructive',
        onPress: async () => {
          try {
            await supabase.auth.signOut();
            setSession(null);
          } catch (e) {
            console.error('Error signing out', e);
            // Bypass en caso de error de red
            setSession(null);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <Appbar.Header style={styles.appbar}>
        <Appbar.Content title="Mi Perfil" titleStyle={styles.headerTitle} />
        <Appbar.Action icon="logout" onPress={handleLogout} title="Cerrar Sesión" />
      </Appbar.Header>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Cabecera Social de Perfil */}
        <View style={styles.profileHeaderCard}>
          <TouchableOpacity onPress={handleAvatarPress} style={styles.avatarContainer}>
            <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
            <View style={styles.avatarEditBadge}>
              <Text style={styles.avatarEditIcon}>✏️</Text>
            </View>
          </TouchableOpacity>

          <Title style={styles.profileName}>{fullName || 'Usuario de Mnemósine'}</Title>
          <Text style={styles.profileUsername}>@{username || 'usuario'}</Text>
        </View>

        {/* Selector de Avatar */}
        {showAvatarPicker && (
          <Card style={styles.avatarPickerCard}>
            <Card.Content>
              <Text variant="titleMedium" style={styles.sectionSubtitle}>Selecciona un Personaje</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.avatarRow}>
                {PRESET_AVATARS.map((url, index) => (
                  <TouchableOpacity
                    key={index}
                    onPress={() => {
                      setAvatarUrl(url);
                      setShowAvatarPicker(false);
                    }}
                    style={[
                      styles.avatarPickerItem,
                      avatarUrl === url && styles.avatarPickerItemSelected,
                    ]}
                  >
                    <Image source={{ uri: url }} style={styles.avatarPickerImage} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </Card.Content>
          </Card>
        )}



        {/* Acordeón para Datos de la IA */}
        <List.Accordion
          title="⚙️ Datos de Contexto para la IA"
          description="Años, países e hitos para cálculo cronológico"
          expanded={showAiFields}
          onPress={() => setShowAiFields(!showAiFields)}
          style={styles.accordion}
          titleStyle={styles.accordionTitle}
          descriptionStyle={styles.accordionDesc}
        >
          <View style={styles.accordionContent}>
            <Paragraph style={styles.hint}>
              Estos datos se usan localmente para que Mnemósine entienda contextos temporales de recuerdos como "cuando era niño" o espaciales como "en mi ciudad natal".
            </Paragraph>

            <TextInput
              label="Año de Nacimiento (YYYY)"
              value={birthDate}
              onChangeText={setBirthDate}
              style={styles.input}
              keyboardType="numeric"
              placeholder="Ej: 1990"
              mode="outlined"
              activeOutlineColor="#6200ee"
            />

            <View style={styles.dropdownContainer}>
              <SmartDropdown
                label="País de Origen"
                value={country}
                items={COUNTRIES}
                onSelect={(item) => {
                  if (item) setCountry(item.name);
                }}
                onCreateNew={(name) => setCountry(name)}
                placeholder="Selecciona o escribe tu país"
                enablePlaces={false}
              />
            </View>

            <TextInput
              label="Ciudad Natal / Residencia Base"
              value={hometown}
              onChangeText={setHometown}
              style={styles.input}
              placeholder="Ej: Medellín"
              mode="outlined"
              activeOutlineColor="#6200ee"
            />

            <TextInput
              label="Hitos de Vida (Opcional)"
              value={lifeEvents}
              onChangeText={setLifeEvents}
              style={styles.input}
              multiline
              numberOfLines={4}
              placeholder="Ej: Graduación en 2015. Mudanza a España en 2020."
              mode="outlined"
              activeOutlineColor="#6200ee"
            />
          </View>
        </List.Accordion>

        <Button
          mode="contained"
          onPress={handleSave}
          loading={loading}
          style={styles.saveButton}
          buttonColor="#6200ee"
          textColor="#ffffff"
        >
          Guardar Cambios
        </Button>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  appbar: {
    backgroundColor: '#ffffff',
    elevation: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f3f5',
  },
  headerTitle: {
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  profileHeaderCard: {
    alignItems: 'center',
    marginBottom: 20,
    paddingVertical: 10,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 12,
  },
  avatarImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#ffffff',
    borderWidth: 3,
    borderColor: '#6200ee',
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: '#ffffff',
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  avatarEditIcon: {
    fontSize: 14,
  },
  profileName: {
    fontWeight: 'bold',
    fontSize: 20,
    marginBottom: 2,
  },
  profileUsername: {
    color: '#868e96',
    fontSize: 14,
    fontWeight: '500',
  },
  avatarPickerCard: {
    marginBottom: 20,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  sectionSubtitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#495057',
    marginBottom: 10,
  },
  avatarRow: {
    paddingVertical: 5,
  },
  avatarPickerItem: {
    padding: 4,
    marginRight: 10,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  avatarPickerItemSelected: {
    borderColor: '#6200ee',
    backgroundColor: '#f1f3f9',
  },
  avatarPickerImage: {
    width: 54,
    height: 54,
    borderRadius: 27,
  },
  formCard: {
    marginBottom: 15,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#343a40',
    marginBottom: 15,
  },
  input: {
    marginBottom: 12,
    backgroundColor: '#ffffff',
  },
  dropdownContainer: {
    marginBottom: 12,
  },
  accordion: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e9ecef',
    borderRadius: 12,
    marginBottom: 20,
  },
  accordionTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#495057',
  },
  accordionDesc: {
    fontSize: 12,
    color: '#868e96',
  },
  accordionContent: {
    padding: 16,
    backgroundColor: '#f8f9fa',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  hint: {
    fontSize: 12,
    color: '#666',
    marginBottom: 15,
    fontStyle: 'italic',
    lineHeight: 18,
  },
  saveButton: {
    paddingVertical: 6,
    borderRadius: 12,
    elevation: 2,
  },
});
