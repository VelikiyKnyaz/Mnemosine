import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Alert, FlatList, TouchableOpacity } from 'react-native';
import { Appbar, Text, Button, IconButton, Chip } from 'react-native-paper';
import MapView, { Marker, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { getDb } from '../../core/database';
import { useIsFocused } from '@react-navigation/native';

export default function AtlasScreen({ route, navigation }: any) {
  const [markers, setMarkers] = useState<any[]>([]);
  const [unlocated, setUnlocated] = useState<any[]>([]);
  const [initialRegion, setInitialRegion] = useState<Region | null>(null);
  
  // Edit Mode State
  const [editingEntity, setEditingEntity] = useState<any | null>(null);
  const [currentRegion, setCurrentRegion] = useState<Region | null>(null);

  const isFocused = useIsFocused();
  const mapRef = useRef<MapView>(null);

  const loadLocations = async () => {
    try {
      const db = await getDb();
      const rows = await db.getAllAsync<any>(
        "SELECT id, name, latitude, longitude FROM entities WHERE type = 'LOCATION'"
      );
      
      const located: any[] = [];
      const notLocated: any[] = [];

      for (const row of rows) {
        if (row.latitude !== null && row.longitude !== null) {
          located.push({
            id: row.id,
            title: row.name,
            coordinate: { latitude: row.latitude, longitude: row.longitude },
          });
        } else {
          notLocated.push({ id: row.id, title: row.name });
        }
      }

      setMarkers(located);
      setUnlocated(notLocated);

      // Manejar el parámetro de navegación para ubicar directo
      if (route.params?.placingEntityId) {
        const entityId = route.params.placingEntityId;
        const entityToPlace = located.find(e => e.id === entityId) || notLocated.find(e => e.id === entityId);
        if (entityToPlace) {
          startEditing(entityToPlace);
        }
        // Limpiar el parámetro para que no se re-dispare
        navigation.setParams({ placingEntityId: undefined });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const getUserLocation = async () => {
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permiso denegado', 'No se puede acceder a la ubicación.');
        setInitialRegion({
          latitude: 40.4168, longitude: -3.7038,
          latitudeDelta: 0.05, longitudeDelta: 0.05,
        });
        return;
      }

      let location = await Location.getCurrentPositionAsync({});
      setInitialRegion({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.05, longitudeDelta: 0.05,
      });
    } catch (error) {
      console.error('Error getting location:', error);
      setInitialRegion({
        latitude: 40.4168, longitude: -3.7038,
        latitudeDelta: 0.05, longitudeDelta: 0.05,
      });
    }
  };

  useEffect(() => {
    if (isFocused) {
      loadLocations();
      if (!initialRegion) getUserLocation();
    }
  }, [isFocused, route.params?.placingEntityId]);

  const startEditing = (entity: any) => {
    setEditingEntity(entity);
    if (entity.coordinate) {
      const targetRegion = {
        latitude: entity.coordinate.latitude,
        longitude: entity.coordinate.longitude,
        latitudeDelta: 0.01, longitudeDelta: 0.01,
      };
      setCurrentRegion(targetRegion);
      mapRef.current?.animateToRegion(targetRegion);
    } else {
      // Para las sin ubicar, usar la región actual del mapa
      setCurrentRegion(currentRegion || initialRegion);
    }
  };

  const confirmLocation = async () => {
    if (!editingEntity || !currentRegion) return;

    try {
      const db = await getDb();
      await db.runAsync(
        'UPDATE entities SET latitude = ?, longitude = ? WHERE id = ?',
        currentRegion.latitude, currentRegion.longitude, editingEntity.id
      );
      
      Alert.alert('Guardado', `Ubicación de "${editingEntity.title}" actualizada.`);
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
        <Appbar.Content title={editingEntity ? `Ubicar: ${editingEntity.title}` : "Atlas de Vida"} />
        {editingEntity && <Appbar.Action icon="close" onPress={() => setEditingEntity(null)} />}
      </Appbar.Header>
      
      {initialRegion ? (
        <View style={styles.mapContainer}>
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={initialRegion}
            onRegionChangeComplete={(region) => {
              setCurrentRegion(region);
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
          <Text style={styles.editHint}>Arrastra el mapa para centrar el marcador en "{editingEntity.title}".</Text>
          <Button mode="contained" onPress={confirmLocation} style={styles.confirmBtn}>
            Confirmar Ubicación
          </Button>
        </View>
      ) : (
        <View>
          {unlocated.length > 0 && (
            <View style={styles.unlocatedSection}>
              <Text style={styles.unlocatedTitle}>📍 Lugares sin ubicar ({unlocated.length})</Text>
              <FlatList
                data={unlocated}
                horizontal
                keyExtractor={(item) => item.id}
                renderItem={({item}) => (
                  <TouchableOpacity onPress={() => startEditing(item)}>
                    <Chip style={styles.chip} icon="map-marker-question">{item.title}</Chip>
                  </TouchableOpacity>
                )}
                showsHorizontalScrollIndicator={false}
                style={styles.chipList}
              />
            </View>
          )}
          {markers.length === 0 && unlocated.length === 0 && initialRegion && (
            <View style={styles.overlay}>
              <Text style={styles.overlayText}>
                No hay ubicaciones registradas aún. La IA extraerá lugares de tus memorias.
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  mapContainer: { flex: 1, position: 'relative' },
  map: { ...StyleSheet.absoluteFillObject },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  staticPinContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  staticPin: { marginBottom: 50 },
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
  confirmBtn: { paddingVertical: 5 },
  unlocatedSection: {
    padding: 10,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  unlocatedTitle: {
    fontWeight: 'bold',
    fontSize: 13,
    marginBottom: 8,
    color: '#333',
  },
  chipList: { paddingBottom: 5 },
  chip: {
    marginRight: 8,
    backgroundColor: '#fff3e0',
  },
  overlay: {
    position: 'absolute',
    bottom: 40,
    left: 20, right: 20,
    backgroundColor: 'rgba(255,255,255,0.95)',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    elevation: 5,
  },
  overlayText: { textAlign: 'center', color: '#444' },
});

