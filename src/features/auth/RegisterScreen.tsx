import React, { useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { TextInput, Button, Text } from 'react-native-paper';
import { supabase } from '../../core/supabase';
import { useAuthStore } from '../../core/store';

export default function RegisterScreen({ navigation }: any) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const setSession = useAuthStore((state) => state.setSession);

  const handleRegister = async () => {
    // Validación de variables de entorno o fallbacks cargados
    const activeSupabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://eknupuhacgqfgmbrxrys.supabase.co';
    if (!activeSupabaseUrl || activeSupabaseUrl.includes('placeholder')) {
      Alert.alert(
        'Configuración Faltante',
        'Las variables de entorno de Supabase no están cargadas en la app. Si las acabas de agregar en la consola de Expo o archivo .env, debes reiniciar el Metro Bundler (reiniciar el servidor con "npm run dev" / "expo start" o refrescar por completo el Snack) para borrar la caché.'
      );
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      if (data.session) {
        setSession(data.session);
      } else {
        Alert.alert('Éxito', 'Revisa tu correo para confirmar tu cuenta');
        navigation.navigate('Login');
      }
    }
  };

  return (
    <View style={styles.container}>
      <Text variant="headlineMedium" style={styles.title}>Crear Cuenta</Text>
      <TextInput
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        style={styles.input}
      />
      <TextInput
        label="Contraseña"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={styles.input}
      />
      <Button mode="contained" onPress={handleRegister} loading={loading} style={styles.button}>
        Registrarse
      </Button>
      <Button mode="text" onPress={() => navigation.navigate('Login')} style={styles.button}>
        Ya tengo cuenta. Iniciar Sesión
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  title: {
    textAlign: 'center',
    marginBottom: 40,
    fontWeight: 'bold',
  },
  input: {
    marginBottom: 16,
  },
  button: {
    marginTop: 8,
  },
});
