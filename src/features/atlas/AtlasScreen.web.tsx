import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Appbar, Text } from 'react-native-paper';

/**
 * react-native-maps needs a native view manager and cannot run in Snack's web
 * preview. Android and iOS resolve AtlasScreen.native.tsx with the full map.
 */
export default function AtlasScreenWeb() {
  return (
    <View style={styles.container}>
      <Appbar.Header>
        <Appbar.Content title="Atlas" />
      </Appbar.Header>
      <View style={styles.message}>
        <Text variant="headlineSmall">Atlas disponible en el dispositivo</Text>
        <Text variant="bodyMedium" style={styles.description}>
          Abre este proyecto con Expo Go en Android o iOS para explorar y editar
          el mapa de recuerdos.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  message: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  description: {
    marginTop: 12,
    maxWidth: 480,
    textAlign: 'center',
  },
});
