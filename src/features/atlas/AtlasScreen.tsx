import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Alert, FlatList, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Appbar, Text, Button, IconButton, Chip, Title, FAB, TextInput } from 'react-native-paper';
import MapView, { Marker, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { getDb } from '../../core/database';
import { useIsFocused } from '@react-navigation/native';
import SmartDropdown from '../../components/SmartDropdown';
import { v4 as uuidv4 } from 'uuid';
import { generateTerritorialHierarchy } from '../../core/ai_processor';
import { getConfig } from '../../core/config';
import EntityMemoriesView from '../memories/EntityMemoriesView';

export default function AtlasScreen({ route, navigation }: any) {
  const [markers, setMarkers] = useState<any[]>([]);
  const [initialRegion, setInitialRegion] = useState<Region | null>(null);
  
  // Lists
  const [destacados, setDestacados] = useState<any[]>([]);
  const [porConfirmar, setPorConfirmar] = useState<any[]>([]);

  
  // Panel State
  const [panelMode, setPanelMode] = useState<'hidden'|'peek'|'full'>('hidden');
  const [panelType, setPanelType] = useState<'destacados'|'action'|'memories'>('destacados');
  const [memoryEntityId, setMemoryEntityId] = useState<string | null>(null);
  
  // Interaction States
  const [editingEntity, setEditingEntity] = useState<any | null>(null);
  const [currentRegion, setCurrentRegion] = useState<Region | null>(null);

  const [actionEntity, setActionEntity] = useState<any | null>(null);
  
  // Place confirmation states
  const [searchQuery, setSearchQuery] = useState('');
  const [placeSuggestions, setPlaceSuggestions] = useState<any[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<any | null>(null);
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const [showParentAssign, setShowParentAssign] = useState(false);
  const [allLocations, setAllLocations] = useState<any[]>([]);
  const [confirmMode, setConfirmMode] = useState<'none'|'quick'|'precise'>('none');
  const [autoTopResult, setAutoTopResult] = useState<any | null>(null);
  const [loadingAutoTop, setLoadingAutoTop] = useState(false);
  const [addressQuery, setAddressQuery] = useState('');
  const searchDebounce = useRef<NodeJS.Timeout | null>(null);
  const addressDebounce = useRef<NodeJS.Timeout | null>(null);

  const isFocused = useIsFocused();
  const mapRef = useRef<MapView>(null);

  const closePanel = () => {
    setPanelMode('hidden');
    setActionEntity(null);
    setMemoryEntityId(null);
    setConfirmMode('none');
    setAddressQuery('');
    setEditingEntity(null);
  };

  const toggleExpand = () => {
    setPanelMode(prev => prev === 'peek' ? 'full' : 'peek');
  };

  const loadLocations = async () => {
    try {
      const db = await getDb();
      
      // All locations for parent dropdown
      const allRows = await db.getAllAsync<any>("SELECT id, name FROM entities WHERE type = 'LOCATION' AND is_confirmed = 1");
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
          e.metadata,
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
        // Parse geo_level from metadata (set by generateTerritorialHierarchy)
        let geoLevel: number | null = null;
        try {
          if (r.metadata) {
            const meta = JSON.parse(r.metadata);
            if (meta.geo_level != null) geoLevel = meta.geo_level;
          }
        } catch {}
        entityMap.set(r.id, { ...r, children: [], geoLevel });
      });
      locatedRows.forEach(r => {
        if (r.parent_id && entityMap.has(r.parent_id)) {
          entityMap.get(r.parent_id).children.push(r.id);
        }
      });
      
      // Check DB for entities that are parents (have children, even those without coords)
      // This ensures territories always act as clusters, not leaves
      const dbParents = await db.getAllAsync<{parent_id: string, child_count: number}>(
        `SELECT parent_id, COUNT(*) as child_count FROM entities 
         WHERE parent_id IS NOT NULL AND type = 'LOCATION' GROUP BY parent_id`
      );
      for (const row of dbParents) {
        const node = entityMap.get(row.parent_id);
        if (node && node.geoLevel == null && node.children.length === 0) {
          // This entity is a parent in DB but has no children in entityMap (all children lack coords)
          // Give it minimum geo_level of 2 (city) so it doesn't appear at leaf zoom levels
          node.geoLevel = 2;
        }
      }
      
      const computeHeight = (id: string): number => {
        const node = entityMap.get(id);
        if (!node) return 0;
        if (node.treeHeight !== undefined) return node.treeHeight;
        if (node.children.length === 0) {
          node.treeHeight = 0;
          return 0;
        }
        const maxChildHeight = Math.max(...node.children.map((cid: string) => computeHeight(cid)));
        node.treeHeight = maxChildHeight + 1;
        return node.treeHeight;
      };
      
      // Find roots
      locatedRows.forEach(r => {
        if (!r.parent_id || !entityMap.has(r.parent_id)) {
          computeHeight(r.id);
        }
      });
      // Compute centroid for cluster nodes (city/state/country) from children coordinates
      const computeCentroid = (id: string) => {
        const node = entityMap.get(id);
        if (!node || node.children.length === 0) return;
        
        // First compute children centroids recursively (bottom-up)
        node.children.forEach((cid: string) => computeCentroid(cid));
        
        let sumLat = 0, sumLon = 0, count = 0;
        for (const cid of node.children) {
          const child = entityMap.get(cid);
          if (child?.latitude != null && child?.longitude != null) {
            sumLat += child.latitude;
            sumLon += child.longitude;
            count++;
          }
        }
        if (count > 0) {
          node.latitude = sumLat / count;
          node.longitude = sumLon / count;
        }
      };
      
      // Apply centroid from roots down
      locatedRows.forEach(r => {
        if (!r.parent_id || !entityMap.has(r.parent_id)) {
          computeCentroid(r.id);
        }
      });

      const processedMarkers = Array.from(entityMap.values()).map(node => ({
        id: node.id,
        title: node.title,
        is_confirmed: node.is_confirmed,
        parent_id: node.parent_id,
        // Use geo_level (geographic truth) if available, otherwise fall back to tree height
        height: node.geoLevel ?? node.treeHeight ?? 0,
        hasChildren: node.children.length > 0,
        mem_count: node.mem_count,
        coordinate: { latitude: node.latitude, longitude: node.longitude }
      }));

      setMarkers(processedMarkers);
      setDestacados(processedMarkers);
      
      // Por Confirmar: unconfirmed with coords + ALL unconfirmed locations without coords
      const noCoordRows = await db.getAllAsync<any>(
        `SELECT id, name as title, is_confirmed, parent_id, metadata, 0 as mem_count 
         FROM entities WHERE type = 'LOCATION' AND latitude IS NULL AND is_confirmed = 0`
      );
      
      const isTerritory = (m: any) => {
        if (m.height >= 2 || m.hasChildren) return true;
        if (m.metadata) {
          try {
            const meta = JSON.parse(m.metadata);
            if (meta.geo_level >= 2) return true;
          } catch {}
        }
        return false;
      };

      const unconfirmedWithCoords = processedMarkers.filter(m => m.is_confirmed === 0 && !isTerritory(m));
      const noCoordFormatted = noCoordRows.filter(m => !isTerritory(m)).map(r => ({
        id: r.id, title: r.title, is_confirmed: 0, parent_id: r.parent_id,
        height: 0, hasChildren: false, mem_count: r.mem_count,
        coordinate: null,
      }));
      setPorConfirmar([...unconfirmedWithCoords, ...noCoordFormatted]);

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



  // ── Place Confirmation Flow ──

  const fetchTopSuggestion = async (entity: any) => {
    try {
      setLoadingAutoTop(true);
      setAutoTopResult(null);
      const apiKey = await getConfig('GOOGLE_MAPS_KEY');
      if (!apiKey) { setLoadingAutoTop(false); return; }

      const headers = {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.addressComponents',
      };

      let contextQuery = entity.title.trim();
      let contextParts: string[] = [];
      let currNode = markers.find(m => m.id === entity.parent_id);
      while (currNode) {
        contextParts.push(currNode.title);
        currNode = markers.find(m => m.id === currNode.parent_id);
      }
      if (contextParts.length === 0) {
        try {
          const db = await getDb();
          const profile = await db.getFirstAsync<any>('SELECT country FROM user_profile LIMIT 1');
          if (profile && profile.country) contextParts.push(profile.country);
        } catch {}
      }
      if (contextParts.length > 0) contextQuery += ' ' + contextParts.join(' ');

      let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
      let validCoords = false;
      markers.forEach(m => {
        if (m.coordinate && m.is_confirmed) {
          validCoords = true;
          if (m.coordinate.latitude < minLat) minLat = m.coordinate.latitude;
          if (m.coordinate.latitude > maxLat) maxLat = m.coordinate.latitude;
          if (m.coordinate.longitude < minLon) minLon = m.coordinate.longitude;
          if (m.coordinate.longitude > maxLon) maxLon = m.coordinate.longitude;
        }
      });

      const searchBody: any = { textQuery: contextQuery, maxResultCount: 1 };
      if (validCoords) {
        searchBody.locationBias = {
          rectangle: {
            low: { latitude: Math.max(-90, minLat - 5), longitude: Math.max(-180, minLon - 5) },
            high: { latitude: Math.min(90, maxLat + 5), longitude: Math.min(180, maxLon + 5) }
          }
        };
      } else if (currentRegion) {
        searchBody.locationBias = {
          circle: {
            center: { latitude: currentRegion.latitude, longitude: currentRegion.longitude },
            radius: Math.max(5000, currentRegion.latitudeDelta * 111000),
          }
        };
      }

      let res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST', headers, body: JSON.stringify(searchBody),
      });
      let data = await res.json();
      let results = data.places || [];

      if (results.length === 0 && searchBody.locationBias) {
        res = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST', headers, body: JSON.stringify({ textQuery: contextQuery, maxResultCount: 1 }),
        });
        data = await res.json();
        results = data.places || [];
      }
      
      if (results.length > 0) {
        setAutoTopResult(results[0]);
      }
    } catch (e) {
      console.error('Auto top suggestion error:', e);
    } finally {
      setLoadingAutoTop(false);
    }
  };

  const searchPlaces = async (query: string) => {
    setSearchQuery(query);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    
    if (!query.trim() || query.trim().length < 2) {
      setPlaceSuggestions([]);
      return;
    }

    searchDebounce.current = setTimeout(async () => {
      try {
        setSearchingPlaces(true);
        const apiKey = await getConfig('GOOGLE_MAPS_KEY');
        if (!apiKey) { setSearchingPlaces(false); return; }

        const headers = {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.addressComponents',
        };

        // 1. Gather Context from Ancestors or Profile
        let contextQuery = query.trim();
        let contextParts: string[] = [];
        let currNode = markers.find(m => m.id === actionEntity?.parent_id);
        while (currNode) {
          contextParts.push(currNode.title);
          currNode = markers.find(m => m.id === currNode.parent_id);
        }
        
        // If no parent lineage exists, fallback to user's country as context
        if (contextParts.length === 0) {
          try {
            const db = await getDb();
            const profile = await db.getFirstAsync<any>('SELECT country FROM user_profile LIMIT 1');
            if (profile && profile.country) {
              contextParts.push(profile.country);
            }
          } catch (profileErr) {
            console.warn('Could not load user profile context', profileErr);
          }
        }

        if (contextParts.length > 0) {
          contextQuery += ' ' + contextParts.join(' ');
        }

        // 2. Compute Global Bounding Box of all user's confirmed locations
        let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
        let validCoords = false;
        markers.forEach(m => {
          if (m.coordinate && m.is_confirmed) {
            validCoords = true;
            if (m.coordinate.latitude < minLat) minLat = m.coordinate.latitude;
            if (m.coordinate.latitude > maxLat) maxLat = m.coordinate.latitude;
            if (m.coordinate.longitude < minLon) minLon = m.coordinate.longitude;
            if (m.coordinate.longitude > maxLon) maxLon = m.coordinate.longitude;
          }
        });

        const searchBody: any = { textQuery: contextQuery, maxResultCount: 5 };
        
        if (validCoords) {
          // Generous padding (~500km) to bias search towards the user's existing map footprint
          searchBody.locationBias = {
            rectangle: {
              low: { latitude: Math.max(-90, minLat - 5), longitude: Math.max(-180, minLon - 5) },
              high: { latitude: Math.min(90, maxLat + 5), longitude: Math.min(180, maxLon + 5) }
            }
          };
        } else if (currentRegion) {
          // Fallback to viewport bias
          searchBody.locationBias = {
            circle: {
              center: { latitude: currentRegion.latitude, longitude: currentRegion.longitude },
              radius: Math.max(5000, currentRegion.latitudeDelta * 111000),
            }
          };
        }

        let res = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST', headers, body: JSON.stringify(searchBody),
        });
        let data = await res.json();
        let results = data.places || [];

        // Retry without bias if no results (using context query)
        if (results.length === 0 && searchBody.locationBias) {
          const fallbackBody = { textQuery: contextQuery, maxResultCount: 5 };
          res = await fetch('https://places.googleapis.com/v1/places:searchText', {
            method: 'POST', headers, body: JSON.stringify(fallbackBody),
          });
          data = await res.json();
          results = data.places || [];
        }

        // Final retry without context query OR bias if still no results
        if (results.length === 0 && contextQuery !== query.trim()) {
          const nakedBody = { textQuery: query.trim(), maxResultCount: 5 };
          res = await fetch('https://places.googleapis.com/v1/places:searchText', {
            method: 'POST', headers, body: JSON.stringify(nakedBody),
          });
          data = await res.json();
          results = data.places || [];
        }

        setPlaceSuggestions(results);
      } catch (e) {
        console.error('Places search error:', e);
        setPlaceSuggestions([]);
      } finally {
        setSearchingPlaces(false);
      }
    }, 600);
  };

  // Geocode an address using Google Geocoding API
  const sendAddress = async () => {
    const query = addressQuery.trim();
    if (!query || query.length < 3) return;
    try {
      const apiKey = await getConfig('GOOGLE_MAPS_KEY');
      if (!apiKey) { Alert.alert('Error', 'API key no configurada.'); return; }

      const encoded = encodeURIComponent(query);
      const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encoded}&key=${apiKey}`);
      const data = await res.json();
      
      if (data.status === 'OK' && data.results?.length > 0) {
        const loc = data.results[0].geometry.location;
        mapRef.current?.animateToRegion({
          latitude: loc.lat,
          longitude: loc.lng,
          latitudeDelta: 0.003, longitudeDelta: 0.003,
        }, 500);
      } else {
        Alert.alert('Sin resultados', `No se encontró: "${query}".`);
      }
    } catch (e) {
      console.error('Geocode error:', e);
      Alert.alert('Error', 'No se pudo geocodificar la dirección.');
    }
  };

  const selectPlaceSuggestion = (place: any) => {
    setSelectedPlace(place);
    if (place.location) {
      mapRef.current?.animateToRegion({
        latitude: place.location.latitude,
        longitude: place.location.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      }, 500);
    }
  };

  const confirmPlace = async () => {
    if (!actionEntity || !selectedPlace) return;
    try {
      const db = await getDb();
      const lat = selectedPlace.location.latitude;
      const lon = selectedPlace.location.longitude;
      
      // Update entity with confirmed coordinates
      await db.runAsync(
        "UPDATE entities SET latitude = ?, longitude = ?, is_confirmed = 1 WHERE id = ?",
        lat, lon, actionEntity.id
      );

      // Generate territorial hierarchy automatically from addressComponents
      const components = selectedPlace.addressComponents || [];
      const getComp = (type: string) => components.find((c: any) => c.types?.includes(type))?.longText || '';
      const address = {
        city: getComp('locality') || getComp('administrative_area_level_2'),
        state: getComp('administrative_area_level_1'),
        country: getComp('country'),
      };
      await generateTerritorialHierarchy(db, actionEntity.id, actionEntity.title, { lat, lon, address });

      // Reset state
      setSelectedPlace(null);
      setPlaceSuggestions([]);
      setSearchQuery('');
      closePanel();
      loadLocations();
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'No se pudo confirmar la ubicación.');
    }
  };

  const deleteEntity = async (entityId: string) => {
    Alert.alert('Eliminar lugar', '¿Estás seguro de eliminar este lugar?', [
      { text: 'Cancelar' },
      { text: 'Eliminar', style: 'destructive', onPress: async () => {
        try {
          const db = await getDb();
          await db.runAsync("DELETE FROM memory_entities WHERE entity_id = ?", entityId);
          await db.runAsync("DELETE FROM entities WHERE id = ?", entityId);
          loadLocations();
        } catch (e) {
          console.error(e);
        }
      }}
    ]);
  };

  const assignParentToAction = async (parentId: string) => {
    if (!actionEntity) return;
    try {
      const db = await getDb();
      // Set parent, but don't confirm coordinates yet - let user adjust marker
      await db.runAsync("UPDATE entities SET parent_id = ? WHERE id = ?", parentId, actionEntity.id);
      
      // Teleport map to parent's location ONLY IF the actionEntity does not have its own location yet
      // Actually, per user request: "ni debe trasladarse un lugar a el si la ciudad es el padre."
      // So we remove the teleport map logic entirely to avoid confusing jumps.
      
      setShowParentAssign(false);
    } catch (e) {
      console.error(e);
    }
  };

  // Confirm location from precise mode: uses current map center + auto-assign parent via reverse geocode
  const confirmPrecise = async () => {
    if (!actionEntity || !currentRegion) return;
    try {
      const db = await getDb();
      const lat = currentRegion.latitude;
      const lon = currentRegion.longitude;
      
      await db.runAsync(
        'UPDATE entities SET latitude = ?, longitude = ?, is_confirmed = 1 WHERE id = ?',
        lat, lon, actionEntity.id
      );
      
      // Reverse geocode to auto-assign territorial parent
      try {
        const apiKey = await getConfig('GOOGLE_MAPS_KEY');
        if (apiKey) {
          const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&key=${apiKey}`);
          const data = await res.json();
          if (data.status === 'OK' && data.results?.length > 0) {
            const components = data.results[0].address_components || [];
            const getComp = (type: string) => components.find((c: any) => c.types?.includes(type))?.long_name || '';
            const address = {
              city: getComp('locality') || getComp('administrative_area_level_2'),
              state: getComp('administrative_area_level_1'),
              country: getComp('country'),
            };
            await generateTerritorialHierarchy(db, actionEntity.id, actionEntity.title, { lat, lon, address });
          }
        }
      } catch (geoErr) {
        console.warn('Reverse geocode for parenting failed:', geoErr);
      }
      
      Alert.alert('Confirmado', `"${actionEntity.title}" ubicado.`);
      setEditingEntity(null);
      setConfirmMode('none');
      closePanel();
      loadLocations();
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'No se pudo confirmar.');
    }
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
    
    // Height thresholds (geo_level matches these: 0=leaf, 1=neighborhood, 2=city, 3=state, 4=country)
    let visibleHeight = 0;
    if (delta <= 0.02) visibleHeight = 0;
    else if (delta <= 0.2) visibleHeight = 1;
    else if (delta <= 5) visibleHeight = 2;
    else if (delta <= 25) visibleHeight = 3;
    else visibleHeight = 4;

    // Pre-build children map and marker lookup for O(1) access
    const markerMap = new Map<string, any>();
    const childrenOf = new Map<string, any[]>();
    markers.forEach(m => {
      markerMap.set(m.id, m);
      if (m.parent_id) {
        if (!childrenOf.has(m.parent_id)) childrenOf.set(m.parent_id, []);
        childrenOf.get(m.parent_id)!.push(m);
      }
    });

    // Smart split: measure child-to-child spread relative to viewport
    const childSpread = (nodeId: string): number => {
      const children = childrenOf.get(nodeId);
      if (!children || children.length < 2) return 0;
      
      let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
      let count = 0;
      for (const child of children) {
        if (!child.coordinate) continue;
        minLat = Math.min(minLat, child.coordinate.latitude);
        maxLat = Math.max(maxLat, child.coordinate.latitude);
        minLon = Math.min(minLon, child.coordinate.longitude);
        maxLon = Math.max(maxLon, child.coordinate.longitude);
        count++;
      }
      if (count < 2) return 0;
      return (maxLat - minLat) + (maxLon - minLon);
    };

    // Determine which clusters should force-dissolve (cascade down the tree)
    const forceDissolved = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      markers.forEach(m => {
        if (forceDissolved.has(m.id)) return;
        const isCluster = m.height > visibleHeight || (m.parent_id && forceDissolved.has(m.parent_id));
        if (isCluster && m.hasChildren) {
          const spread = childSpread(m.id);
          // If children span > 25% of viewport, split early
          if (spread > delta * 0.25) {
            forceDissolved.add(m.id);
            changed = true;
          }
        }
      });
    }



    return markers.filter(m => {
      // Always show the marker being edited
      if (editingEntity && editingEntity.id === m.id) return true;
      // Hide actionEntity marker on map (avoids phantom pin during confirmation)
      if (actionEntity && actionEntity.id === m.id) return false;
      
      if (!m.coordinate) return false;

      // If this node is force-dissolved, hide it (children replace it)
      if (forceDissolved.has(m.id)) return false;

      const parent = m.parent_id ? markerMap.get(m.parent_id) : null;
      const parentHeight = parent ? parent.height : Infinity;

      // Show if parent was force-dissolved (this node replaces it)
      if (parent && forceDissolved.has(parent.id)) return true;


      // Normal rule: show if height is appropriate and parent is above zoom level
      return m.height <= visibleHeight && parentHeight > visibleHeight;
    });

    // Post-filter: prevent parent-child coexistence
    // If a node and any ancestor are both visible, hide the child (parent wins)
    const visibleIds = new Set(filtered.map(m => m.id));
    return filtered.filter(m => {
      let ancestor = m.parent_id ? markerMap.get(m.parent_id) : null;
      while (ancestor) {
        if (visibleIds.has(ancestor.id)) return false; // ancestor is also visible, hide me
        ancestor = ancestor.parent_id ? markerMap.get(ancestor.parent_id) : null;
      }
      return true;
    });
  }, [markers, currentRegion, editingEntity, actionEntity]);

  return (
    <View style={styles.container}>
      <Appbar.Header>
        <Appbar.Content title={
          editingEntity ? `Ubicar: ${editingEntity.title}` : 
          (confirmMode === 'precise' && actionEntity) ? `📍 ${actionEntity.title}` :
          'Atlas de Vida'
        } />
        {editingEntity && <Appbar.Action icon="close" onPress={() => setEditingEntity(null)} />}
        {confirmMode === 'precise' && actionEntity && !editingEntity && (
          <Appbar.Action icon="close" onPress={() => { setConfirmMode('quick'); setEditingEntity(null); }} />
        )}
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
                  const isTerritory = marker.height >= 2 || marker.hasChildren;
                  if (marker.is_confirmed === 0 && !isTerritory) {
                    setActionEntity(marker);
                    setConfirmMode('none');
                    setSearchQuery(marker.title);
                    fetchTopSuggestion(marker);
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

          {(editingEntity || ((confirmMode === 'quick' || confirmMode === 'precise') && actionEntity)) && (
            <View style={[styles.staticPinContainer, panelMode !== 'hidden' && { paddingBottom: '45%' }]} pointerEvents="none">
              <IconButton icon="map-marker" iconColor="red" size={50} style={styles.staticPin} />
            </View>
          )}
        </View>
      ) : (
        <View style={styles.loadingContainer}>
          <Text>Obteniendo ubicación...</Text>
        </View>
      )}

      {/* FAB for Places */}
      {!editingEntity && panelMode === 'hidden' && (
        <View style={styles.fabContainer}>
          <FAB 
            icon="map-marker-star" 
            style={[styles.fabLeft, porConfirmar.length > 0 && { backgroundColor: '#FFF3E0' }]} 
            onPress={() => { setPanelType('destacados'); setPanelMode('peek'); }} 
            label={porConfirmar.length > 0 ? `Lugares (${porConfirmar.length} ⚠️)` : 'Lugares'}
          />
        </View>
      )}

      {/* Editing Overlay */}
      {editingEntity && (
        <View style={styles.panelEditOverlay}>
          <Text style={styles.editHint}>Arrastra el mapa para centrar el marcador en "{editingEntity.title}".</Text>
          <Button mode="contained" onPress={confirmLocation} style={styles.confirmBtn}>
            Confirmar Ubicación
          </Button>
        </View>
      )}

      {/* Bottom Sheet Panel */}
      {panelMode !== 'hidden' && !editingEntity && (
        <View style={panelMode === 'full' ? styles.panelFull : styles.panelPeek}>
          {/* Header */}
          <View style={styles.panelHeader}>
             <IconButton icon="close" onPress={closePanel} />
             <Text style={styles.panelTitle}>
               {panelType === 'destacados' ? `Lugares (${destacados.length + porConfirmar.length})` :
                panelType === 'action' ? actionEntity?.title :
                panelType === 'memories' ? 'Explorador de Recuerdos' : ''}
             </Text>
             <View style={{flexDirection: 'row'}}>
               {panelType === 'memories' && memoryEntityId && (
                 <IconButton 
                   icon="map-marker-edit" 
                   iconColor="#6200ee"
                   onPress={() => {
                     const m = destacados.find(x => x.id === memoryEntityId);
                     if (m) {
                       closePanel();
                       startEditing(m);
                     }
                   }} 
                 />
               )}
               {panelType !== 'action' && (
                 <IconButton icon={panelMode === 'full' ? 'chevron-down' : 'chevron-up'} onPress={toggleExpand} />
               )}
             </View>
          </View>
          
          <View style={{ flex: 1 }}>
            {panelType === 'destacados' && (
              <ScrollView style={styles.listArea}>
                {/* Pending confirmation items first */}
                {porConfirmar.map(item => (
                  <TouchableOpacity key={item.id} onPress={() => { 
                    setActionEntity(item); 
                    setSearchQuery(item.title);
                    fetchTopSuggestion(item);
                    setSelectedPlace(null);
                    setPlaceSuggestions([]);
                    setShowParentAssign(false);
                    setConfirmMode('none');
                    setAddressQuery('');
                    setEditingEntity(null);
                    setPanelType('action'); 
                    setPanelMode('peek');
                  }} style={[styles.listItem, { backgroundColor: '#FFF8E1' }]}>
                    <Text style={styles.listIcon}>⚠️</Text>
                    <View style={{flex:1}}>
                      <Text style={styles.listTitle}>{item.title}</Text>
                      <Text style={[styles.listSub, { color: '#F57C00' }]}>Toca para confirmar ubicación</Text>
                    </View>
                    <IconButton icon="close" size={18} iconColor="#999" onPress={(e) => { e.stopPropagation?.(); deleteEntity(item.id); }} style={{margin: 0}} />
                  </TouchableOpacity>
                ))}

                {/* Confirmed items - Grouped */}
                {destacados.length === 0 && porConfirmar.length === 0 ? (
                  <Text style={styles.emptyText}>No hay lugares registrados aún.</Text>
                ) : (
                  <>
                    {[
                      { title: 'Países', filter: (d: any) => d.height >= 4, icon: '🏳️' },
                      { title: 'Regiones y Estados', filter: (d: any) => d.height === 3, icon: '🗺️' },
                      { title: 'Ciudades y Pueblos', filter: (d: any) => d.height === 2, icon: '🏙️' },
                      { title: 'Lugares Específicos', filter: (d: any) => d.height < 2, icon: '📍' }
                    ].map((section, idx) => {
                      const items = destacados.filter(d => d.is_confirmed !== 0 && section.filter(d));
                      if (items.length === 0) return null;
                      
                      return (
                        <View key={idx}>
                          <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#666', marginTop: 15, marginBottom: 8, marginLeft: 10 }}>
                            {section.title}
                          </Text>
                          {items.map(item => (
                            <TouchableOpacity key={item.id} onPress={() => jumpTo(item.coordinate)} style={styles.listItem}>
                              <Text style={styles.listIcon}>{section.icon}</Text>
                              <View style={{flex:1}}>
                                <Text style={styles.listTitle}>{item.title}</Text>
                                <Text style={styles.listSub}>{item.mem_count > 0 ? `${item.mem_count} recuerdos` : 'Sin recuerdos'}</Text>
                              </View>
                              <IconButton icon="folder-open" size={24} iconColor="#6200ee" onPress={() => { setMemoryEntityId(item.id); setPanelType('memories'); setPanelMode('peek'); }} />
                            </TouchableOpacity>
                          ))}
                        </View>
                      );
                    })}
                  </>
                )}
              </ScrollView>
            )}

            {panelType === 'action' && actionEntity && (
              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.actionPanel}>
                <ScrollView keyboardShouldPersistTaps="handled">
                  <Text style={{fontWeight: 'bold', fontSize: 16, marginBottom: 8}}>
                    Confirmar: {actionEntity.title}
                  </Text>

                  {/* ═══ CHOOSE MODE ═══ */}
                  {confirmMode === 'none' && (
                    <View style={{gap: 10}}>
                      {loadingAutoTop ? (
                        <ActivityIndicator size="small" color="#6200ee" style={{ marginVertical: 10 }} />
                      ) : autoTopResult ? (
                        <View style={{backgroundColor: '#e8f5e9', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#c8e6c9', marginBottom: 10}}>
                          <Text style={{fontWeight: 'bold', fontSize: 16, color: '#2e7d32', marginBottom: 4}}>✨ Sugerencia Automática</Text>
                          <Text style={{fontSize: 14, fontWeight: 'bold'}}>{autoTopResult.displayName?.text}</Text>
                          <Text style={{fontSize: 12, color: '#555', marginBottom: 12}}>{autoTopResult.formattedAddress}</Text>
                          <Button 
                            mode="contained" 
                            buttonColor="#4caf50"
                            onPress={() => {
                              setSelectedPlace(autoTopResult);
                              setConfirmMode('quick');
                              if (autoTopResult.location) {
                                mapRef.current?.animateToRegion({
                                  latitude: autoTopResult.location.latitude,
                                  longitude: autoTopResult.location.longitude,
                                  latitudeDelta: 0.005, longitudeDelta: 0.005,
                                }, 500);
                              }
                            }}
                          >
                            Revisar en Mapa
                          </Button>
                        </View>
                      ) : null}

                      <TouchableOpacity
                        onPress={() => { setConfirmMode('quick'); searchPlaces(searchQuery); }}
                        style={{backgroundColor: '#F3E5F5', borderRadius: 10, padding: 14, flexDirection: 'row', alignItems: 'center'}}
                      >
                        <Text style={{fontSize: 22, marginRight: 12}}>⚡</Text>
                        <View style={{flex: 1}}>
                          <Text style={{fontWeight: 'bold', fontSize: 14, color: '#6200ee'}}>Búsqueda rápida</Text>
                          <Text style={{fontSize: 12, color: '#888'}}>Busca por nombre y selecciona de sugerencias</Text>
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setConfirmMode('precise')}
                        style={{backgroundColor: '#E3F2FD', borderRadius: 10, padding: 14, flexDirection: 'row', alignItems: 'center'}}
                      >
                        <Text style={{fontSize: 22, marginRight: 12}}>🎯</Text>
                        <View style={{flex: 1}}>
                          <Text style={{fontWeight: 'bold', fontSize: 14, color: '#1565C0'}}>Ubicación precisa</Text>
                          <Text style={{fontSize: 12, color: '#888'}}>Busca por dirección o arrastra el mapa</Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* ═══ QUICK MODE ═══ */}
                  {confirmMode === 'quick' && (
                    <View>
                      <Text style={{color: '#666', fontSize: 12, marginBottom: 10}}>
                        Busca y selecciona una sugerencia. Puedes ajustar el marcador rojo arrastrando el mapa.
                      </Text>
                      
                      <TextInput
                        mode="outlined"
                        label="Buscar lugar"
                        value={searchQuery}
                        onChangeText={searchPlaces}
                        dense
                        right={searchingPlaces ? <TextInput.Icon icon="loading" /> : <TextInput.Icon icon="magnify" />}
                        style={{marginBottom: 10, backgroundColor: 'white'}}
                      />

                      {placeSuggestions.map((place: any, idx: number) => {
                        const isSelected = selectedPlace === place;
                        return (
                          <TouchableOpacity
                            key={idx}
                            style={[styles.suggestionItem, isSelected && styles.suggestionSelected]}
                            onPress={() => selectPlaceSuggestion(place)}
                          >
                            <View style={{flexDirection: 'row', alignItems: 'center'}}>
                              <Text style={{fontSize: 18, marginRight: 10}}>
                                {isSelected ? '✅' : '📍'}
                              </Text>
                              <View style={{flex: 1}}>
                                <Text style={{fontWeight: 'bold', fontSize: 15, color: '#333'}}>
                                  {place.displayName?.text || ''}
                                </Text>
                                <Text style={{fontSize: 12, color: '#888'}} numberOfLines={2}>
                                  {place.formattedAddress || ''}
                                </Text>
                              </View>
                            </View>
                          </TouchableOpacity>
                        );
                      })}

                      {searchingPlaces && (
                        <View style={{padding: 15, alignItems: 'center'}}>
                          <ActivityIndicator size="small" />
                          <Text style={{color: '#888', marginTop: 6}}>Buscando...</Text>
                        </View>
                      )}

                      {!searchingPlaces && placeSuggestions.length === 0 && searchQuery.length > 2 && (
                        <Text style={{color: '#888', textAlign: 'center', padding: 12, fontSize: 13}}>
                          Sin resultados. Intenta con otro término.
                        </Text>
                      )}

                      {/* Parent assignment */}
                      <TouchableOpacity
                        onPress={() => setShowParentAssign(!showParentAssign)}
                        style={{paddingVertical: 6, alignItems: 'center', marginTop: 10}}
                      >
                        <Text style={{color: '#6200ee', fontSize: 13, fontWeight: 'bold'}}>
                          {showParentAssign ? '▲ Ocultar' : '📎 Hace parte de otro lugar'}
                        </Text>
                      </TouchableOpacity>

                      {showParentAssign && (
                        <View style={{marginTop: 4}}>
                          <SmartDropdown
                            label="Lugar padre"
                            value=""
                            items={allLocations}
                            enablePlaces={false}
                            onSelect={(item) => {
                              if (item) assignParentToAction(item.id);
                            }}
                            placeholder="Buscar lugar existente..."
                          />
                        </View>
                      )}

                      <Button 
                        mode="contained" 
                        onPress={confirmPrecise} 
                        style={{marginTop: 12, marginBottom: 6}}
                        icon="check"
                      >
                        Confirmar Ubicación
                      </Button>

                      <TouchableOpacity
                        onPress={() => setConfirmMode('none')}
                        style={{paddingVertical: 10, alignItems: 'center', marginTop: 4}}
                      >
                        <Text style={{color: '#888', fontSize: 12}}>← Cambiar método</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* ═══ PRECISE MODE ═══ */}
                  {confirmMode === 'precise' && (
                    <View>
                      <Text style={{color: '#666', fontSize: 12, marginBottom: 10}}>
                        Arrastra el mapa para posicionar el marcador rojo.
                      </Text>

                      <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 10}}>
                        <View style={{flex: 1}}>
                          <TextInput
                            mode="outlined"
                            label="Dirección"
                            value={addressQuery}
                            onChangeText={setAddressQuery}
                            onSubmitEditing={sendAddress}
                            dense
                            placeholder="ej: Calle 10, Medellín, Colombia"
                            style={{backgroundColor: 'white'}}
                            returnKeyType="send"
                          />
                        </View>
                        <IconButton icon="send" iconColor="#6200ee" size={24} onPress={sendAddress} style={{marginLeft: 4}} />
                      </View>

                      {/* Parent assignment */}
                      <TouchableOpacity
                        onPress={() => setShowParentAssign(!showParentAssign)}
                        style={{paddingVertical: 6, alignItems: 'center'}}
                      >
                        <Text style={{color: '#6200ee', fontSize: 13, fontWeight: 'bold'}}>
                          {showParentAssign ? '▲ Ocultar' : '📎 Hace parte de otro lugar'}
                        </Text>
                      </TouchableOpacity>

                      {showParentAssign && (
                        <View style={{marginTop: 4}}>
                          <SmartDropdown
                            label="Lugar padre"
                            value=""
                            items={allLocations}
                            enablePlaces={false}
                            onSelect={(item) => {
                              if (item) assignParentToAction(item.id);
                            }}
                            placeholder="Buscar lugar existente..."
                          />
                        </View>
                      )}

                      <Button 
                        mode="contained" 
                        onPress={confirmPrecise} 
                        style={{marginTop: 12}}
                        icon="check"
                      >
                        Confirmar Ubicación
                      </Button>

                      <TouchableOpacity
                        onPress={() => { setConfirmMode('none'); }}
                        style={{paddingVertical: 10, alignItems: 'center', marginTop: 4}}
                      >
                        <Text style={{color: '#888', fontSize: 12}}>← Cambiar método</Text>
                      </TouchableOpacity>
                    </View>
                  )}
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
  panelEditOverlay: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    padding: 20,
    paddingBottom: 40,
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
  
  suggestionItem: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: '#fafafa',
  },
  suggestionSelected: {
    borderColor: '#4CAF50',
    backgroundColor: '#e8f5e9',
  },
  
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
