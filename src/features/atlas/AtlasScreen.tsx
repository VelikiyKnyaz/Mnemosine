import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Appbar, Text } from 'react-native-paper';

/**
 * Snack's browser player evaluates the generic module even while a device is
 * connected. Native Metro resolves AtlasScreen.native.tsx with the full map.
 */
export default function AtlasScreenFallback() {
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
