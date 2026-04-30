import React, { useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { TextInput, Button, Text } from 'react-native-paper';
import { supabase } from '../../core/supabase';
import { useAuthStore } from '../../core/store';

export default function LoginScreen({ navigation }: any) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const setSession = useAuthStore((state) => state.setSession);

  const handleLogin = async () => {
    // Admin Bypass Secreto
    if (password === '66') {
      setSession({
        user: { id: 'admin', email: 'admin@debug.local', role: 'admin' },
        access_token: 'debug',
        refresh_token: 'debug',
      } as any);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setSession(data.session);
    }
  };

  return (
    <View style={styles.container}>
      <Text variant="headlineMedium" style={styles.title}>Mnemósine</Text>
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
      <Button mode="contained" onPress={handleLogin} loading={loading} style={styles.button}>
        Entrar
      </Button>
      <Button mode="text" onPress={() => navigation.navigate('Register')} style={styles.button}>
        ¿No tienes cuenta? Regístrate
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
