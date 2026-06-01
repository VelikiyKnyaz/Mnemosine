import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, Image, TouchableOpacity } from 'react-native';
import { Appbar, TextInput, Button, Text, Card, Title, ProgressBar, List, Divider } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import { getDb } from '../../core/database';
import { supabase, uploadAvatar } from '../../core/supabase';
import { useAuthStore } from '../../core/store';
import { generateLifecycleStages } from '../../core/chrono_engine';
import SmartDropdown from '../../components/SmartDropdown';

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

export default function OnboardingScreen() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Paso 1: Nombre Completo y Usuario
  const session = useAuthStore((state) => state.session);
  const [fullName, setFullName] = useState('');
  
  // Generar un usuario por defecto a partir del correo si no hay uno previo
  const getDefaultUsername = () => {
    if (session?.user?.user_metadata?.username) {
      return session.user.user_metadata.username;
    }
    if (session?.user?.email) {
      // Extrae la parte del email antes del @, lo hace minuscula y quita caracteres no permitidos
      return session.user.email.split('@')[0]
        .toLowerCase()
        .replace(/[^a-z0-9._]/g, '')
        .substring(0, 30);
    }
    return '';
  };
  const [username, setUsername] = useState(getDefaultUsername());

  // Paso 2: Datos de Contexto (IA)
  const [birthDate, setBirthDate] = useState('');
  const [hometown, setHometown] = useState('');
  const [country, setCountry] = useState('');
  const [lifeEvents, setLifeEvents] = useState('');

  // Paso 3: Avatar / Foto de Perfil
  const [avatarUrl, setAvatarUrl] = useState(PRESET_AVATARS[0]);

  const setNeedsOnboarding = useAuthStore((state) => state.setNeedsOnboarding);

  const totalSteps = 3;
  const progress = step / totalSteps;

  const validateUsername = (name: string) => /^[a-z0-9._]{3,30}$/.test(name);

  const handleNext = async () => {
    if (step === 1) {
      if (!fullName.trim()) {
        Alert.alert('Falta Información', 'Por favor ingresa tu nombre completo.');
        return;
      }
      if (!username.trim() || !validateUsername(username)) {
        Alert.alert(
          'Usuario Inválido',
          'El nombre de usuario debe tener entre 3 y 30 caracteres, solo minúsculas, números, puntos y guiones bajos (sin espacios).'
        );
        return;
      }

      // Validar unicidad del nombre de usuario en Supabase profiles
      setLoading(true);
      try {
        const cleanUsername = username.trim().toLowerCase();
        const { data, error } = await supabase
          .from('profiles')
          .select('id, username')
          .eq('username', cleanUsername)
          .maybeSingle();

        if (error && error.code !== 'PGRST116' && error.code !== '42P01') {
          console.warn('Error de Supabase consultando profiles:', error);
        } else if (data && data.id !== session?.user?.id) {
          Alert.alert('Nombre ocupado', 'El nombre de usuario ya está registrado por otra cuenta. Intenta con uno diferente.');
          setLoading(false);
          return;
        }
      } catch (e) {
        console.warn('Fallo al comprobar disponibilidad del username:', e);
      } finally {
        setLoading(false);
      }
    }
    if (step === 2) {
      if (!birthDate.trim() || isNaN(parseInt(birthDate))) {
        Alert.alert('Falta Información', 'Por favor ingresa un año de nacimiento válido.');
        return;
      }
      if (!hometown.trim() || !country.trim()) {
        Alert.alert('Falta Información', 'Por favor completa tu ciudad natal y país de origen.');
        return;
      }
    }
    setStep((prev) => Math.min(prev + 1, totalSteps));
  };

  const handleBack = () => {
    setStep((prev) => Math.max(prev - 1, 1));
  };

  const pickImageFromGallery = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permiso Denegado', 'Necesitamos permiso de acceso a la galería para subir tu foto.');
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
      Alert.alert('Error', 'No se pudo seleccionar la imagen de la galería.');
    }
  };

  const handleFinish = async () => {
    if (!session?.user) return;
    setLoading(true);

    const userId = session.user.id;
    const finalUsername = username.trim().toLowerCase();

    try {
      const db = await getDb();

      // Subir avatar a Supabase Storage si es un archivo local
      let finalAvatarUrl = avatarUrl;
      if (avatarUrl.startsWith('file://')) {
        try {
          finalAvatarUrl = await uploadAvatar(userId, avatarUrl);
        } catch (uploadErr) {
          console.warn('Fallo al subir avatar a Supabase Storage:', uploadErr);
        }
      }

      // 1. Guardar localmente en SQLite user_profile
      await db.runAsync(
        'INSERT OR REPLACE INTO user_profile (id, username, full_name, avatar_url, birth_date, hometown, country, life_events) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        userId,
        finalUsername,
        fullName.trim(),
        finalAvatarUrl,
        birthDate.trim(),
        hometown.trim(),
        country.trim(),
        lifeEvents.trim()
      );

      // Generar etapas de ciclo de vida para la IA
      const year = parseInt(birthDate.trim());
      if (!isNaN(year)) {
        await generateLifecycleStages(year);
      }

      // 2. Intentar guardar de forma remota en la tabla 'profiles' de Supabase
      try {
        const { error: upsertError } = await supabase.from('profiles').upsert({
          id: userId,
          username: finalUsername,
          full_name: fullName.trim(),
          avatar_url: finalAvatarUrl,
          updated_at: new Date().toISOString(),
        });

        if (upsertError && upsertError.code !== '42P01') {
          // Ignoramos error 42P01 (relation "profiles" does not exist) para no bloquear al usuario
          console.warn('Fallo al sincronizar perfil con Supabase:', upsertError);
        }
      } catch (err) {
        console.warn('Fallo de red al sincronizar con Supabase profiles:', err);
      }

      setLoading(false);
      setNeedsOnboarding(false); // Redirección inmediata a las pestañas principales
    } catch (e) {
      console.error(e);
      setLoading(false);
      Alert.alert('Error', 'No se pudo guardar el perfil. Reinténtalo.');
    }
  };

  return (
    <View style={styles.container}>
      <Appbar.Header style={styles.appbar}>
        {step > 1 && <Appbar.BackAction onPress={handleBack} disabled={loading} />}
        <Appbar.Content title={`Paso ${step} de ${totalSteps}`} titleStyle={styles.headerTitle} />
      </Appbar.Header>

      <ProgressBar progress={progress} color="#6200ee" style={styles.progressBar} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {step === 1 && (
          <Card style={styles.stepCard} mode="flat">
            <Card.Content>
              <Title style={styles.title}>¡Te damos la bienvenida!</Title>
              <Text variant="bodyMedium" style={styles.subtitle}>
                Para comenzar a reconstruir tu historia familiar, por favor dinos cómo quieres que te llamemos.
              </Text>
              <TextInput
                label="Nombre Completo"
                value={fullName}
                onChangeText={setFullName}
                style={styles.input}
                placeholder="Ej: Sofía Gómez"
                mode="outlined"
                activeOutlineColor="#6200ee"
                disabled={loading}
              />
              <TextInput
                label="Nombre de Usuario (@)"
                value={username}
                onChangeText={(text) => setUsername(text.toLowerCase())}
                style={styles.input}
                placeholder="Ej: sofiagomez"
                autoCapitalize="none"
                mode="outlined"
                activeOutlineColor="#6200ee"
                disabled={loading}
              />
            </Card.Content>
          </Card>
        )}

        {step === 2 && (
          <Card style={styles.stepCard} mode="flat">
            <Card.Content>
              <Title style={styles.title}>Contexto Temporal y Espacial</Title>
              <Text variant="bodyMedium" style={styles.subtitle}>
                Estos datos se usan localmente para que la IA organice tu Línea de Tiempo y entienda frases como "cuando era niño" o "en mi pueblo natal".
              </Text>

              <TextInput
                label="Año de Nacimiento (YYYY)"
                value={birthDate}
                onChangeText={setBirthDate}
                style={styles.input}
                keyboardType="numeric"
                placeholder="Ej: 1995"
                mode="outlined"
                activeOutlineColor="#6200ee"
                disabled={loading}
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
                  placeholder="Selecciona o escribe tu país natal"
                  enablePlaces={false}
                />
              </View>

              <TextInput
                label="Ciudad Natal / Residencia Base"
                value={hometown}
                onChangeText={setHometown}
                style={styles.input}
                placeholder="Ej: Buenos Aires"
                mode="outlined"
                activeOutlineColor="#6200ee"
                disabled={loading}
              />

              <TextInput
                label="Hitos de Vida (Opcional)"
                value={lifeEvents}
                onChangeText={setLifeEvents}
                style={styles.input}
                multiline
                numberOfLines={3}
                placeholder="Ej: Mudanza a Chile en 2018. Nacimiento de mi primer hijo en 2021."
                mode="outlined"
                activeOutlineColor="#6200ee"
                disabled={loading}
              />
            </Card.Content>
          </Card>
        )}

        {step === 3 && (
          <Card style={styles.stepCard} mode="flat">
            <Card.Content>
              <Title style={styles.title}>Foto de Perfil</Title>
              <Text variant="bodyMedium" style={styles.subtitle}>
                Añade una foto para que los demás puedan reconocerte en la red familiar. Puedes omitirlo y usar un avatar por defecto.
              </Text>

              <View style={styles.avatarMainSection}>
                <Image source={{ uri: avatarUrl }} style={styles.largeAvatar} />
                <Button
                  mode="outlined"
                  onPress={pickImageFromGallery}
                  style={styles.galleryButton}
                  icon="image"
                  textColor="#6200ee"
                  disabled={loading}
                >
                  Elegir de la Galería
                </Button>
              </View>

              <Divider style={styles.divider} />

              <Text style={styles.pickerHint}>O selecciona un personaje ilustrado:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.avatarRow}>
                {PRESET_AVATARS.map((url, idx) => (
                  <TouchableOpacity
                    key={idx}
                    onPress={() => setAvatarUrl(url)}
                    style={[
                      styles.avatarBubble,
                      avatarUrl === url && styles.avatarBubbleSelected,
                    ]}
                    disabled={loading}
                  >
                    <Image source={{ uri: url }} style={styles.avatarThumbnail} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </Card.Content>
          </Card>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {step < totalSteps ? (
          <Button
            mode="contained"
            onPress={handleNext}
            style={styles.navigationBtn}
            buttonColor="#6200ee"
          >
            Siguiente
          </Button>
        ) : (
          <Button
            mode="contained"
            onPress={handleFinish}
            loading={loading}
            disabled={loading}
            style={styles.navigationBtn}
            buttonColor="#2e7d32"
          >
            Finalizar y Entrar
          </Button>
        )}
      </View>
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
  },
  headerTitle: {
    fontWeight: 'bold',
  },
  progressBar: {
    height: 4,
  },
  scrollContent: {
    padding: 20,
  },
  stepCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
    elevation: 0,
    paddingVertical: 10,
  },
  title: {
    fontWeight: 'bold',
    fontSize: 22,
    color: '#212529',
    marginBottom: 8,
  },
  subtitle: {
    color: '#6c757d',
    lineHeight: 20,
    marginBottom: 20,
  },
  input: {
    marginBottom: 16,
    backgroundColor: '#ffffff',
  },
  dropdownContainer: {
    marginBottom: 16,
  },
  avatarMainSection: {
    alignItems: 'center',
    marginVertical: 15,
  },
  largeAvatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: '#6200ee',
    backgroundColor: '#f1f3f9',
    marginBottom: 15,
  },
  galleryButton: {
    borderRadius: 8,
    borderColor: '#6200ee',
  },
  divider: {
    marginVertical: 20,
  },
  pickerHint: {
    fontSize: 14,
    fontWeight: '600',
    color: '#495057',
    marginBottom: 12,
  },
  avatarRow: {
    paddingVertical: 5,
  },
  avatarBubble: {
    padding: 4,
    marginRight: 10,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  avatarBubbleSelected: {
    borderColor: '#6200ee',
    backgroundColor: '#f1f3f9',
  },
  avatarThumbnail: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  footer: {
    padding: 20,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#f1f3f5',
  },
  navigationBtn: {
    paddingVertical: 6,
    borderRadius: 12,
  },
});
