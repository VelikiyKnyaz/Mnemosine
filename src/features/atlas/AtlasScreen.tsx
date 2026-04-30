import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { Appbar, Text, Button, IconButton } from 'react-native-paper';
import MapView, { Marker, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { getDb } from '../../core/database';
import { useIsFocused } from '@react-navigation/native';

export default function AtlasScreen() {
  const [markers, setMarkers] = useState<any[]>([]);
  const [initialRegion, setInitialRegion] = useState<Region | null>(null);
  
  // Edit Mode State
  const [editingEntity, setEditingEntity] = useState<any | null>(null);
  const [currentRegion, setCurrentRegion] = useState<Region | null>(null);

  const isFocused = useIsFocused();
  const mapRef = useRef<MapView>(null);

  const loadLocations = async () => {
    try {
      const db = await getDb();
      // Get all entities that are locations, even if they don't have lat/lon yet
      const rows = await db.getAllAsync(`
        SELECT DISTINCT e.id, e.name, e.latitude, e.longitude
        FROM entities e
        WHERE e.type = 'LOCATION'
      `);
      
      const newMarkers = rows.map((row: any) => ({
        id: row.id,
        title: row.name,
        // Fallback to 0,0 if not geocoded yet (will be fixed by user or future geocoding)
        coordinate: {
          latitude: row.latitude || 0,
          longitude: row.longitude || 0,
        },
        hasLocation: row.latitude !== null && row.longitude !== null
      })).filter((m: any) => m.hasLocation); // Only show those with location in view mode

      setMarkers(newMarkers);
    } catch (err) {
      console.error(err);
    }
  };

  const getUserLocation = async () => {
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permiso denegado', 'No se puede acceder a la ubicación.');
        // Default to a generic location
        setInitialRegion({
          latitude: 40.4168,
          longitude: -3.7038,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        });
        return;
      }

      let location = await Location.getCurrentPositionAsync({});
      setInitialRegion({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      });
    } catch (error) {
      console.error('Error getting location:', error);
      // Default to Madrid
      setInitialRegion({
        latitude: 40.4168,
        longitude: -3.7038,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      });
    }
  };

  useEffect(() => {
    if (isFocused) {
      loadLocations();
      if (!initialRegion) {
        getUserLocation();
      }
    }
  }, [isFocused]);

  const startEditing = (marker: any) => {
    setEditingEntity(marker);
    const targetRegion = {
      latitude: marker.coordinate.latitude,
      longitude: marker.coordinate.longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
    setCurrentRegion(targetRegion);
    mapRef.current?.animateToRegion(targetRegion);
  };

  const confirmLocation = async () => {
    if (!editingEntity || !currentRegion) return;

    try {
      const db = await getDb();
      await db.runAsync(
        'UPDATE entities SET latitude = ?, longitude = ? WHERE id = ?',
        currentRegion.latitude, currentRegion.longitude, editingEntity.id
      );
      
      Alert.alert('Guardado', 'Ubicación actualizada correctamente.');
      setEditingEntity(null);
      loadLocations();
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'No se pudo guardar la ubicación.');
    }
  };

  return (
    <View style={styles.container}>
      <Appbar.Header>
        <Appbar.Content title={editingEntity ? `Moviendo: ${editingEntity.title}` : "Atlas de Vida"} />
        {editingEntity && <Appbar.Action icon="close" onPress={() => setEditingEntity(null)} />}
      </Appbar.Header>
      
      {initialRegion ? (
        <View style={styles.mapContainer}>
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={initialRegion}
            onRegionChangeComplete={(region) => {
              if (editingEntity) setCurrentRegion(region);
            }}
            showsUserLocation={!editingEntity}
          >
            {!editingEntity && markers.map(marker => (
              <Marker
                key={marker.id}
                coordinate={marker.coordinate}
                title={marker.title}
                description="Toca para reubicar"
                onCalloutPress={() => startEditing(marker)}
              />
            ))}
          </MapView>

          {editingEntity && (
            <View style={styles.staticPinContainer} pointerEvents="none">
              <IconButton icon="map-marker" iconColor="red" size={50} style={styles.staticPin} />
            </View>
          )}
        </View>
      ) : (
        <View style={styles.loadingContainer}>
          <Text>Obteniendo ubicación...</Text>
        </View>
      )}

      {editingEntity ? (
        <View style={styles.editFooter}>
          <Text style={styles.editHint}>Arrastra el mapa para centrar el marcador.</Text>
          <Button mode="contained" onPress={confirmLocation} style={styles.confirmBtn}>
            Confirmar Ubicación
          </Button>
        </View>
      ) : (
        markers.length === 0 && initialRegion && (
          <View style={styles.overlay}>
            <Text style={styles.overlayText}>
              No hay ubicaciones registradas aún. Las IA extraerá lugares de tus memorias.
            </Text>
          </View>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  staticPinContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  staticPin: {
    marginBottom: 50, // Offset to point the tail at the exact center
  },
  editFooter: {
    padding: 15,
    backgroundColor: 'white',
    elevation: 10,
  },
  editHint: {
    textAlign: 'center',
    marginBottom: 10,
    color: '#666',
  },
  confirmBtn: {
    paddingVertical: 5,
  },
  overlay: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(255,255,255,0.95)',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    elevation: 5,
  },
  overlayText: {
    textAlign: 'center',
    color: '#444',
  }
});
