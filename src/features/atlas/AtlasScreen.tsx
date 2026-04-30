import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Alert, FlatList, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Appbar, Text, Button, IconButton, Chip, Title } from 'react-native-paper';
import MapView, { Marker, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { getDb, inheritCoordinatesFromParent } from '../../core/database';
import { useIsFocused } from '@react-navigation/native';
import SmartDropdown from '../../components/SmartDropdown';
import { v4 as uuidv4 } from 'uuid';
import { geocodeLocation } from '../../core/ai_processor';

export default function AtlasScreen({ route, navigation }: any) {
  const [markers, setMarkers] = useState<any[]>([]);
  const [initialRegion, setInitialRegion] = useState<Region | null>(null);
  
  // Lists
  const [destacados, setDestacados] = useState<any[]>([]);
  const [porConfirmar, setPorConfirmar] = useState<any[]>([]);
  const [allLocations, setAllLocations] = useState<any[]>([]); // For dropdown
  
  const [activeTab, setActiveTab] = useState<'destacados' | 'confirmar'>('destacados');
  
  // Interaction States
  const [editingEntity, setEditingEntity] = useState<any | null>(null);
  const [currentRegion, setCurrentRegion] = useState<Region | null>(null);

  const [actionEntity, setActionEntity] = useState<any | null>(null);
  const [resolveParentId, setResolveParentId] = useState<string | null>(null);

  const isFocused = useIsFocused();
  const mapRef = useRef<MapView>(null);

  const loadLocations = async () => {
    try {
      const db = await getDb();
      
      // All Locations for Dropdown
      const allRows = await db.getAllAsync<any>("SELECT id, name FROM entities WHERE type = 'LOCATION'");
      setAllLocations(allRows);

      // Markers (Only with coords)
      const locatedRows = await db.getAllAsync<any>(
        "SELECT id, name, latitude, longitude, is_confirmed FROM entities WHERE type = 'LOCATION' AND latitude IS NOT NULL"
      );
      setMarkers(locatedRows.map(r => ({
        id: r.id, title: r.name, is_confirmed: r.is_confirmed,
        coordinate: { latitude: r.latitude, longitude: r.longitude }
      })));

      // 1. Todos los lugares, ordenados por cantidad de recuerdos
      const topRows = await db.getAllAsync<any>(`
        SELECT e.id, e.name as title, e.latitude, e.longitude, COUNT(me.memory_id) as mem_count
        FROM entities e
        LEFT JOIN memory_entities me ON e.id = me.entity_id
        WHERE e.type = 'LOCATION' AND e.latitude IS NOT NULL
        GROUP BY e.id
        ORDER BY mem_count DESC
      `);
      setDestacados(topRows.map(r => ({ ...r, coordinate: { latitude: r.latitude, longitude: r.longitude } })));

      // 2. Por Confirmar
      const confRows = await db.getAllAsync<any>(
        "SELECT id, name as title, latitude, longitude FROM entities WHERE type = 'LOCATION' AND latitude IS NOT NULL AND is_confirmed = 0"
      );
      setPorConfirmar(confRows.map(r => ({ ...r, coordinate: { latitude: r.latitude, longitude: r.longitude }, is_confirmed: 0 })));

      // Auto-start editing if requested from route
      if (route.params?.placingEntityId) {
        const entityId = route.params.placingEntityId;
        const entityToPlace = locatedRows.find(e => e.id === entityId);
        if (entityToPlace) {
          const formatted = {
            id: entityToPlace.id,
            title: entityToPlace.name || entityToPlace.title,
            coordinate: entityToPlace.latitude ? { latitude: entityToPlace.latitude, longitude: entityToPlace.longitude } : null
          };
          startEditing(formatted);
        }
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
      setCurrentRegion(currentRegion || initialRegion);
    }
  };

  const confirmLocation = async () => {
    if (!editingEntity || !currentRegion) return;
    try {
      const db = await getDb();
      await db.runAsync(
        'UPDATE entities SET latitude = ?, longitude = ?, is_confirmed = 1 WHERE id = ?',
        currentRegion.latitude, currentRegion.longitude, editingEntity.id
      );
      
      // Propagate to unconfirmed children: if this entity is a parent, 
      // move its unconfirmed children near the new position
      const unconfirmedChildren = await db.getAllAsync<{id: string}>(
        "SELECT id FROM entities WHERE parent_id = ? AND is_confirmed = 0",
        editingEntity.id
      );
      for (const child of unconfirmedChildren) {
        const jitterLat = (Math.random() - 0.5) * 0.0004;
        const jitterLon = (Math.random() - 0.5) * 0.0004;
        await db.runAsync(
          'UPDATE entities SET latitude = ?, longitude = ? WHERE id = ?',
          currentRegion.latitude + jitterLat, currentRegion.longitude + jitterLon, child.id
        );
      }
      
      Alert.alert('Guardado', `Ubicación de "${editingEntity.title}" guardada.`);
      setEditingEntity(null);
      loadLocations();
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'No se pudo guardar la ubicación.');
    }
  };

  const acceptLocation = async (entityId: string) => {
    try {
      const db = await getDb();
      await db.runAsync("UPDATE entities SET is_confirmed = 1 WHERE id = ?", entityId);
      setActionEntity(null);
      loadLocations();
    } catch (e) {
      console.error(e);
    }
  };

  const assignParent_Action = async (parentId: string) => {
    if (!actionEntity || !parentId) return;
    try {
      const db = await getDb();
      
      // Get the parent's name to use as geocoding context
      const parent = await db.getFirstAsync<{name: string, latitude: number|null, longitude: number|null}>(
        "SELECT name, latitude, longitude FROM entities WHERE id = ?", parentId
      );
      
      await db.runAsync("UPDATE entities SET parent_id = ? WHERE id = ?", parentId, actionEntity.id);
      
      // Try to re-geocode the child using the parent name as context
      // e.g. "Colegio, Medellín" instead of just "Colegio"
      if (parent?.name) {
        const betterCoords = await geocodeLocation(actionEntity.title, `, ${parent.name}`);
        if (betterCoords) {
          await db.runAsync(
            "UPDATE entities SET latitude = ?, longitude = ?, is_confirmed = 0 WHERE id = ?",
            betterCoords.lat, betterCoords.lon, actionEntity.id
          );
          Alert.alert('Reubicado', `"${actionEntity.title}" se reubicó cerca de "${parent.name}". Confírmalo en el mapa.`);
        } else {
          // Fallback: inherit parent coordinates with jitter
          await inheritCoordinatesFromParent(actionEntity.id, parentId);
          Alert.alert('Asignado', `Padre asignado. No se encontró ubicación específica, se colocó cerca del padre.`);
        }
      } else {
        await inheritCoordinatesFromParent(actionEntity.id, parentId);
        Alert.alert('Asignado', 'Lugar padre asignado con éxito.');
      }
      
      setResolveParentId(null);
      setActionEntity(null);
      loadLocations();
    } catch (e) {
      console.error(e);
    }
  };

  const createAndGeocodeParent = async (name: string) => {
    const db = await getDb();
    const newId = uuidv4();
    // Default 0 for is_confirmed since we are guessing
    await db.runAsync("INSERT INTO entities (id, type, name, is_confirmed) VALUES (?, 'LOCATION', ?, 0)", newId, name);
    
    // Attempt Geocoding
    const coords = await geocodeLocation(name, ''); 
    if (coords) {
      await db.runAsync("UPDATE entities SET latitude = ?, longitude = ? WHERE id = ?", coords.lat, coords.lon, newId);
    } else if (actionEntity && actionEntity.coordinate) {
      // Reverse inheritance: If parent not found, place parent exactly at child's position
      await db.runAsync("UPDATE entities SET latitude = ?, longitude = ? WHERE id = ?", actionEntity.coordinate.latitude, actionEntity.coordinate.longitude, newId);
    }
    
    await assignParent_Action(newId);
  };

  const jumpTo = (coordinate: any) => {
    if (!coordinate) return;
    mapRef.current?.animateToRegion({
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      latitudeDelta: 0.01, longitudeDelta: 0.01,
    });
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
                description={marker.is_confirmed === 0 ? "⚠️ Por confirmar (Toca para opciones)" : "Toca para reubicar"}
                pinColor={marker.is_confirmed === 0 ? 'orange' : 'red'}
                onCalloutPress={() => {
                  if (marker.is_confirmed === 0) {
                    setActionEntity(marker);
                  } else {
                    startEditing(marker);
                  }
                }}
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
      ) : actionEntity ? (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.actionPanel}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Title style={styles.actionTitle}>{actionEntity.title}</Title>
            <Text style={{marginBottom: 10}}>¿Qué deseas hacer con este lugar?</Text>
            
            {actionEntity.is_confirmed === 0 && (
              <Button mode="contained" onPress={() => acceptLocation(actionEntity.id)} style={{marginBottom: 8}}>
                ✅ Aceptar Ubicación Sugerida
              </Button>
            )}
            <Button mode="outlined" icon="map-marker" onPress={() => {
              const ent = actionEntity;
              setActionEntity(null);
              startEditing(ent);
            }} style={{marginBottom: 15}}>
              Ubicar Manualmente en Mapa
            </Button>

            <Text style={{fontWeight: 'bold', marginBottom: 5}}>O asignar a un Lugar Padre:</Text>
            <SmartDropdown
              label="Lugar padre (ej: Colegio)"
              value=""
              items={allLocations}
              onSelect={(item) => {
                 if (item) assignParent_Action(item.id);
              }}
              onCreateNew={createAndGeocodeParent}
              placeholder="Escribe y presiona Enter..."
            />
            
            <Button onPress={() => setActionEntity(null)} style={{marginTop: 10}}>Cancelar</Button>
          </ScrollView>
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.bottomSection}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll}>
            <Chip selected={activeTab === 'destacados'} onPress={() => setActiveTab('destacados')} style={styles.tabChip}>📍 Lugares ({destacados.length})</Chip>
            <Chip selected={activeTab === 'confirmar'} onPress={() => setActiveTab('confirmar')} style={styles.tabChip}>
              ✅ Confirmar ({porConfirmar.length})
            </Chip>
          </ScrollView>

          <ScrollView style={styles.listArea}>
            {activeTab === 'destacados' && (
              destacados.length === 0 ? <Text style={styles.emptyText}>No hay lugares registrados aún.</Text> :
              destacados.map(item => (
                <TouchableOpacity key={item.id} onPress={() => jumpTo(item.coordinate)} style={styles.listItem}>
                  <Text style={styles.listIcon}>{item.mem_count > 0 ? '⭐️' : '📍'}</Text>
                  <View style={{flex:1}}>
                    <Text style={styles.listTitle}>{item.title}</Text>
                    <Text style={styles.listSub}>{item.mem_count > 0 ? `${item.mem_count} recuerdos` : 'Sin recuerdos'}</Text>
                  </View>
                </TouchableOpacity>
              ))
            )}

            {activeTab === 'confirmar' && (
              porConfirmar.length === 0 ? <Text style={styles.emptyText}>No hay ubicaciones por confirmar.</Text> :
              porConfirmar.map(item => (
                <TouchableOpacity key={item.id} onPress={() => { jumpTo(item.coordinate); setActionEntity(item); }} style={styles.listItem}>
                  <Text style={styles.listIcon}>⚠️</Text>
                  <View style={{flex:1}}>
                    <Text style={styles.listTitle}>{item.title}</Text>
                    <Text style={styles.listSub}>Toca para confirmar</Text>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
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
  editFooter: { padding: 15, backgroundColor: 'white', elevation: 10 },
  editHint: { textAlign: 'center', marginBottom: 10, color: '#666' },
  confirmBtn: { paddingVertical: 5 },
  actionPanel: { padding: 15, backgroundColor: 'white', elevation: 10, maxHeight: 350 },
  actionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 5 },
  bottomSection: { height: 200, backgroundColor: 'white', elevation: 10 },
  tabScroll: { paddingHorizontal: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee', maxHeight: 55 },
  tabChip: { marginRight: 8, height: 32 },
  listArea: { padding: 10 },
  listItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  listIcon: { fontSize: 20, marginRight: 10 },
  listTitle: { fontSize: 15, fontWeight: 'bold', color: '#333' },
  listSub: { fontSize: 12, color: '#666' },
  emptyText: { textAlign: 'center', color: '#999', marginTop: 20, fontStyle: 'italic' },
});
