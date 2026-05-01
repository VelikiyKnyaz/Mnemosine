import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Alert, FlatList, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Appbar, Text, Button, IconButton, Chip, Title, FAB } from 'react-native-paper';
import MapView, { Marker, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { getDb, inheritCoordinatesFromParent } from '../../core/database';
import { useIsFocused } from '@react-navigation/native';
import SmartDropdown, { NominatimSuggestion } from '../../components/SmartDropdown';
import { v4 as uuidv4 } from 'uuid';
import { geocodeLocation, generateTerritorialHierarchy } from '../../core/ai_processor';
import EntityMemoriesView from '../memories/EntityMemoriesView';

export default function AtlasScreen({ route, navigation }: any) {
  const [markers, setMarkers] = useState<any[]>([]);
  const [initialRegion, setInitialRegion] = useState<Region | null>(null);
  
  // Lists
  const [destacados, setDestacados] = useState<any[]>([]);
  const [porConfirmar, setPorConfirmar] = useState<any[]>([]);
  const [allLocations, setAllLocations] = useState<any[]>([]); // For dropdown
  
  // Panel State
  const [panelMode, setPanelMode] = useState<'hidden'|'peek'|'full'>('hidden');
  const [panelType, setPanelType] = useState<'destacados'|'confirmar'|'action'|'memories'>('destacados');
  const [memoryEntityId, setMemoryEntityId] = useState<string | null>(null);
  
  // Interaction States
  const [editingEntity, setEditingEntity] = useState<any | null>(null);
  const [currentRegion, setCurrentRegion] = useState<Region | null>(null);

  const [actionEntity, setActionEntity] = useState<any | null>(null);
  const [resolveParentId, setResolveParentId] = useState<string | null>(null);

  const isFocused = useIsFocused();
  const mapRef = useRef<MapView>(null);

  const closePanel = () => {
    setPanelMode('hidden');
    setActionEntity(null);
    setMemoryEntityId(null);
  };

  const toggleExpand = () => {
    setPanelMode(prev => prev === 'peek' ? 'full' : 'peek');
  };

  const loadLocations = async () => {
    try {
      const db = await getDb();
      
      // All Locations for Dropdown
      const allRows = await db.getAllAsync<any>("SELECT id, name FROM entities WHERE type = 'LOCATION'");
      setAllLocations(allRows);

      // Unified Hierarchical Query (Markers + Top + Por Confirmar)
      const query = `
        WITH RECURSIVE hierarchy AS (
          SELECT id as root_id, id as descendant_id 
          FROM entities WHERE type = 'LOCATION'
          UNION ALL
          SELECT h.root_id, e.id
          FROM hierarchy h
          JOIN entities e ON e.parent_id = h.descendant_id
        )
        SELECT 
          e.id, 
          e.name as title, 
          e.latitude, 
          e.longitude, 
          e.is_confirmed,
          e.parent_id,
          COUNT(me.memory_id) as mem_count
        FROM entities e
        JOIN hierarchy h ON e.id = h.root_id
        LEFT JOIN memory_entities me ON me.entity_id = h.descendant_id
        WHERE e.latitude IS NOT NULL AND e.type = 'LOCATION'
        GROUP BY e.id
        ORDER BY mem_count DESC
      `;
      const locatedRows = await db.getAllAsync<any>(query);

      // Compute tree height (distance from bottom) and parent-child relationships
      const entityMap = new Map();
      locatedRows.forEach(r => {
        entityMap.set(r.id, { ...r, children: [] });
      });
      locatedRows.forEach(r => {
        if (r.parent_id && entityMap.has(r.parent_id)) {
          entityMap.get(r.parent_id).children.push(r.id);
        }
      });
      
      const computeHeight = (id: string): number => {
        const node = entityMap.get(id);
        if (!node) return 0;
        if (node.height !== undefined) return node.height; // already computed
        if (node.children.length === 0) {
          node.height = 0;
          return 0;
        }
        const maxChildHeight = Math.max(...node.children.map((cid: string) => computeHeight(cid)));
        node.height = maxChildHeight + 1;
        return node.height;
      };
      
      // Find roots
      locatedRows.forEach(r => {
        if (!r.parent_id || !entityMap.has(r.parent_id)) {
          computeHeight(r.id);
        }
      });

      const processedMarkers = Array.from(entityMap.values()).map(node => ({
        id: node.id,
        title: node.title,
        is_confirmed: node.is_confirmed,
        parent_id: node.parent_id,
        height: node.height || 0,
        hasChildren: node.children.length > 0,
        mem_count: node.mem_count,
        coordinate: { latitude: node.latitude, longitude: node.longitude }
      }));

      setMarkers(processedMarkers);
      setDestacados(processedMarkers);
      setPorConfirmar(processedMarkers.filter(m => m.is_confirmed === 0));

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
      closePanel();
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
      closePanel();
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
      if (coords.address) {
        await generateTerritorialHierarchy(db, newId, name, coords);
      }
    } else if (actionEntity && actionEntity.coordinate) {
      // Reverse inheritance: If parent not found, place parent exactly at child's position
      await db.runAsync("UPDATE entities SET latitude = ?, longitude = ? WHERE id = ?", actionEntity.coordinate.latitude, actionEntity.coordinate.longitude, newId);
    }
    
    await assignParent_Action(newId);
  };

  const createParentFromNominatim = async (suggestion: NominatimSuggestion) => {
    if (!actionEntity) return;
    const db = await getDb();
    const name = suggestion.display_name.split(',')[0].trim();
    const lat = parseFloat(suggestion.lat);
    const lon = parseFloat(suggestion.lon);
    
    // Check if a location with this exact name already exists
    const existing = await db.getFirstAsync<{id: string}>("SELECT id FROM entities WHERE type = 'LOCATION' AND name = ? COLLATE NOCASE", name);
    if (existing) {
      // Update its coordinates if needed
      await db.runAsync("UPDATE entities SET latitude = ?, longitude = ?, is_confirmed = 0 WHERE id = ?", lat, lon, existing.id);
      await assignParent_Action(existing.id);
      return;
    }
    
    const newId = uuidv4();
    await db.runAsync(
      "INSERT INTO entities (id, type, name, latitude, longitude, is_confirmed) VALUES (?, 'LOCATION', ?, ?, ?, 0)",
      newId, name, lat, lon
    );
    
    if (suggestion.address) {
      await generateTerritorialHierarchy(db, newId, name, { lat, lon, address: suggestion.address });
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

  const visibleMarkers = React.useMemo(() => {
    const delta = currentRegion?.latitudeDelta || 100;
    
    // Determine the visible HEIGHT threshold based on zoom level
    // Instead of depth (which varies wildly), height is consistent (0 = leaf).
    // A node "splits" (hides itself and shows its children) when delta drops below its threshold.
    let visibleHeight = 0;
    if (delta <= 0.02) visibleHeight = 0;        // Max zoom, leaf nodes only
    else if (delta <= 0.2) visibleHeight = 1;    // Neighborhood clusters
    else if (delta <= 5) visibleHeight = 2;      // City clusters
    else if (delta <= 20) visibleHeight = 3;     // State clusters
    else if (delta <= 60) visibleHeight = 4;     // Country clusters
    else visibleHeight = 5;                      // Continent clusters

    return markers.filter(m => {
      // 1. Always show the marker being acted upon
      if (editingEntity && editingEntity.id === m.id) return true;
      if (actionEntity && actionEntity.id === m.id) return true;
      
      // 2. Hide markers without coordinates
      if (!m.coordinate) return false;

      // 3. Bottom-up cluster logic:
      // A node is visible if its height matches the current visibleHeight.
      // Exception: If a node is a leaf (height=0) but we are at a higher zoom level (e.g. visibleHeight=2),
      // it should be visible ONLY if it doesn't have a parent that is currently acting as its cluster.
      // To simplify: if a node's height is >= visibleHeight, we show it (it acts as the cluster for its children).
      // Wait, if height >= visibleHeight, then BOTH height 2 and height 3 would show? No, we only want the TOPMOST visible node.
      // Correct rule: A node is visible if it is exactly the visibleHeight, OR if it's a leaf node and visibleHeight < its height.
      // Actually: A node is visible if `m.height === visibleHeight`.
      // What if `visibleHeight === 3` but the max height in a branch is 1? Then nothing shows!
      // Better rule: A node shows if its height is the MAX(m.height, visibleHeight) for its branch.
      // Simplest rule: A node is visible if:
      // a) It is a cluster and its height == visibleHeight
      // b) It is a leaf (height == 0) and visibleHeight <= 0 (wait, if visibleHeight is 1, a standalone leaf should show!)
      // Let's do: A node shows if its height <= visibleHeight AND it has no parent, OR its parent's height > visibleHeight.
      
      const parent = m.parent_id ? markers.find(p => p.id === m.parent_id) : null;
      const parentHeight = parent ? parent.height : Infinity;

      // It is visible if the current map zoom allows its height, BUT the map zoom does NOT allow its parent's height.
      return m.height <= visibleHeight && parentHeight > visibleHeight;
    });
  }, [markers, currentRegion, editingEntity, actionEntity]);

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
            {!editingEntity && visibleMarkers.map(marker => (
              <Marker
                key={marker.id}
                coordinate={marker.coordinate}
                title={marker.title}
                description={marker.is_confirmed === 0 ? "⚠️ Por confirmar" : `${marker.mem_count || 0} recuerdos`}
                pinColor={marker.is_confirmed === 0 ? 'orange' : 'red'}
                onPress={() => {
                  if (marker.is_confirmed === 0) {
                    setActionEntity(marker);
                    setPanelType('action');
                    setPanelMode('peek');
                  } else {
                    setMemoryEntityId(marker.id);
                    setPanelType('memories');
                    setPanelMode('peek');
                  }
                }}
              >
                {/* Custom Marker View for Clusters */}
                {marker.hasChildren || marker.mem_count > 0 ? (
                  <View style={[styles.clusterMarker, { 
                    backgroundColor: marker.is_confirmed === 0 ? '#ff9800' : '#e53935',
                    width: marker.hasChildren ? 40 : 30,
                    height: marker.hasChildren ? 40 : 30,
                    borderRadius: marker.hasChildren ? 20 : 15,
                  }]}>
                    <Text style={styles.clusterText}>{marker.mem_count}</Text>
                  </View>
                ) : null}
              </Marker>
            ))}
          </MapView>

          {/* Debug HUD for Zoom tweaks */}
          <View pointerEvents="none" style={styles.debugHud}>
            <Text style={styles.debugText}>Zoom (Delta): {currentRegion?.latitudeDelta?.toFixed(4)}</Text>
            <Text style={styles.debugText}>Marcadores Visibles: {visibleMarkers.length}</Text>
          </View>

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

      {/* FABs for Lists */}
      {!editingEntity && panelMode === 'hidden' && (
        <View style={styles.fabContainer}>
          <FAB 
            icon="map-marker-star" 
            style={styles.fabLeft} 
            onPress={() => { setPanelType('destacados'); setPanelMode('peek'); }} 
            label="Lugares"
          />
          <FAB 
            icon="check-decagram" 
            style={styles.fabRight} 
            onPress={() => { setPanelType('confirmar'); setPanelMode('peek'); }} 
            label="Confirmar"
            color={porConfirmar.length > 0 ? "orange" : undefined}
          />
        </View>
      )}

      {/* Editing Overlay */}
      {editingEntity && (
        <View style={styles.panelPeek}>
          <View style={styles.editFooter}>
            <Text style={styles.editHint}>Arrastra el mapa para centrar el marcador en "{editingEntity.title}".</Text>
            <Button mode="contained" onPress={confirmLocation} style={styles.confirmBtn}>
              Confirmar Ubicación
            </Button>
          </View>
        </View>
      )}

      {/* Bottom Sheet Panel */}
      {panelMode !== 'hidden' && !editingEntity && (
        <View style={panelMode === 'full' ? styles.panelFull : styles.panelPeek}>
          {/* Header */}
          <View style={styles.panelHeader}>
             <IconButton icon="close" onPress={closePanel} />
             <Text style={styles.panelTitle}>
               {panelType === 'destacados' ? `Lugares (${destacados.length})` :
                panelType === 'confirmar' ? `Por Confirmar (${porConfirmar.length})` :
                panelType === 'action' ? actionEntity?.title :
                panelType === 'memories' ? 'Explorador de Recuerdos' : ''}
             </Text>
             <IconButton icon={panelMode === 'full' ? 'chevron-down' : 'chevron-up'} onPress={toggleExpand} />
          </View>
          
          <View style={{ flex: 1 }}>
            {panelType === 'destacados' && (
              <ScrollView style={styles.listArea}>
                {destacados.length === 0 ? <Text style={styles.emptyText}>No hay lugares registrados aún.</Text> :
                destacados.map(item => (
                  <TouchableOpacity key={item.id} onPress={() => jumpTo(item.coordinate)} style={styles.listItem}>
                    <Text style={styles.listIcon}>{item.mem_count > 0 ? '⭐️' : '📍'}</Text>
                    <View style={{flex:1}}>
                      <Text style={styles.listTitle}>{item.title}</Text>
                      <Text style={styles.listSub}>{item.mem_count > 0 ? `${item.mem_count} recuerdos` : 'Sin recuerdos'}</Text>
                    </View>
                    <IconButton icon="folder-open" size={24} iconColor="#6200ee" onPress={() => { setMemoryEntityId(item.id); setPanelType('memories'); setPanelMode('peek'); }} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {panelType === 'confirmar' && (
              <ScrollView style={styles.listArea}>
                {porConfirmar.length === 0 ? <Text style={styles.emptyText}>No hay ubicaciones por confirmar.</Text> :
                porConfirmar.map(item => (
                  <TouchableOpacity key={item.id} onPress={() => { jumpTo(item.coordinate); setActionEntity(item); setPanelType('action'); }} style={styles.listItem}>
                    <Text style={styles.listIcon}>⚠️</Text>
                    <View style={{flex:1}}>
                      <Text style={styles.listTitle}>{item.title}</Text>
                      <Text style={styles.listSub}>Toca para confirmar</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {panelType === 'action' && actionEntity && (
              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.actionPanel}>
                <ScrollView keyboardShouldPersistTaps="handled">
                  <Text style={{marginBottom: 10, marginTop: 10}}>¿Qué deseas hacer con este lugar?</Text>
                  
                  {actionEntity.is_confirmed === 0 && (
                    <Button mode="contained" onPress={() => acceptLocation(actionEntity.id)} style={{marginBottom: 8}}>
                      ✅ Aceptar Ubicación Sugerida
                    </Button>
                  )}
                  <Button mode="outlined" icon="map-marker" onPress={() => {
                    const ent = actionEntity;
                    closePanel();
                    startEditing(ent);
                  }} style={{marginBottom: 15}}>
                    Ubicar Manualmente en Mapa
                  </Button>

                  <Text style={{fontWeight: 'bold', marginBottom: 5}}>O asignar a un Lugar Padre:</Text>
                  <SmartDropdown
                    label="Lugar padre (ej: Colegio)"
                    value=""
                    items={allLocations}
                    enableNominatim={true}
                    onSelect={(item) => {
                       if (item) assignParent_Action(item.id);
                    }}
                    onCreateNew={createAndGeocodeParent}
                    onSelectNominatim={createParentFromNominatim}
                    placeholder="Escribe para buscar..."
                  />
                </ScrollView>
              </KeyboardAvoidingView>
            )}

            {panelType === 'memories' && memoryEntityId && (
              <EntityMemoriesView entityId={memoryEntityId} />
            )}
          </View>
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
  
  fabContainer: {
    position: 'absolute',
    bottom: 30,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  fabLeft: { backgroundColor: 'white' },
  fabRight: { backgroundColor: 'white' },
  
  panelPeek: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: '45%',
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    elevation: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.2, shadowRadius: 5,
  },
  panelFull: {
    position: 'absolute',
    top: 0, bottom: 0, left: 0, right: 0,
    backgroundColor: 'white',
    elevation: 20,
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingHorizontal: 10,
    height: 50,
  },
  panelTitle: { fontSize: 16, fontWeight: 'bold' },
  
  editFooter: { padding: 15, flex: 1, justifyContent: 'center' },
  editHint: { textAlign: 'center', marginBottom: 10, color: '#666' },
  confirmBtn: { paddingVertical: 5 },
  
  actionPanel: { padding: 15, flex: 1 },
  listArea: { padding: 10 },
  listItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  listIcon: { fontSize: 20, marginRight: 10 },
  listTitle: { fontSize: 15, fontWeight: 'bold', color: '#333' },
  listSub: { fontSize: 12, color: '#666' },
  emptyText: { textAlign: 'center', color: '#999', marginTop: 20, fontStyle: 'italic' },
  
  debugHud: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 8,
    borderRadius: 8,
  },
  debugText: { color: 'white', fontSize: 10, fontWeight: 'bold' },
  clusterMarker: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 4,
  },
  clusterText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 12,
  },
});
