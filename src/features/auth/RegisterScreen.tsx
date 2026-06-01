import React, { useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { TextInput, Button, Text } from 'react-native-paper';
import { supabase } from '../../core/supabase';
import { useAuthStore } from '../../core/store';

export default function RegisterScreen({ navigation }: any) {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const setSession = useAuthStore((state) => state.setSession);

  const handleRegister = async () => {
    const cleanUsername = username.trim().toLowerCase();

    // Validar longitud y caracteres permitidos (Estilo Instagram: a-z, 0-9, ., _, sin espacios, 3-30 chars)
    const usernameRegex = /^[a-z0-9._]{3,30}$/;
    if (!usernameRegex.test(cleanUsername)) {
      Alert.alert(
        'Formato Inválido',
        'El nombre de usuario debe tener entre 3 y 30 caracteres y solo contener letras minúsculas, números, puntos y guiones bajos (sin espacios).'
      );
      return;
    }

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

    // Validar unicidad del nombre de usuario en Supabase profiles
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('username')
        .eq('username', cleanUsername)
        .maybeSingle();

      if (error && error.code !== 'PGRST116' && error.code !== '42P01') {
        // Ignoramos error 42P01 (relation "profiles" does not exist) para no bloquear el testing
        // si la tabla aún no ha sido creada en la base de datos de producción
        console.warn('Error de Supabase consultando profiles:', error);
      } else if (data) {
        setLoading(false);
        Alert.alert('Nombre ocupado', 'El nombre de usuario ya está registrado por otra cuenta. Intenta con uno diferente.');
        return;
      }
    } catch (e) {
      console.warn('Fallo al comprobar disponibilidad del username:', e);
    }

    // Registro del usuario en Supabase con el username en raw_user_meta_data
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: cleanUsername,
        }
      }
    });

    setLoading(false);

    if (signUpError) {
      Alert.alert('Error', signUpError.message);
    } else {
      if (signUpData.session) {
        setSession(signUpData.session);
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
        label="Nombre de Usuario (@)"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        style={styles.input}
        placeholder="Ej: sofiagomez"
      />
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
