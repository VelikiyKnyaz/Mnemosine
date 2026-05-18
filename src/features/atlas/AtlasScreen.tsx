import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Alert, FlatList, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Dimensions, Keyboard } from 'react-native';
import { Appbar, Text, Button, IconButton, Chip, Title, FAB, TextInput, Searchbar } from 'react-native-paper';
import MapView, { Marker, Circle as MapCircle, Region, Callout } from 'react-native-maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { getDb } from '../../core/database';
import { useIsFocused } from '@react-navigation/native';
import SmartDropdown from '../../components/SmartDropdown';
import { v4 as uuidv4 } from 'uuid';
import { generateTerritorialHierarchy } from '../../core/ai_processor';
import { getConfig } from '../../core/config';
import EntityMemoriesView from '../memories/EntityMemoriesView';

const getDeltaForGeoLevel = (level: number) => {
  switch (level) {
    case 4: return 15.0;
    case 3: return 5.0;
    case 2: return 0.2;
    case 1: return 0.05;
    default: return 0.005;
  }
};

export default function AtlasScreen({ route, navigation }: any) {
  const [markers, setMarkers] = useState<any[]>([]);
  const [initialRegion, setInitialRegion] = useState<Region | null>(null);
  // (trackChanges removed)

  // Lists
  const [destacados, setDestacados] = useState<any[]>([]);
  const [porConfirmar, setPorConfirmar] = useState<any[]>([]);
  const [expandedListItem, setExpandedListItem] = useState<string | null>(null);
  
  // Destacados List Mode
  const [listMode, setListMode] = useState<'visible' | 'all'>('all');
  const [localSearchQuery, setLocalSearchQuery] = useState('');
  const [categoryLimits, setCategoryLimits] = useState<Record<string, number>>({});


  const [panelMode, setPanelMode] = useState<'hidden' | 'peek' | 'full'>('hidden');
  const [panelType, setPanelType] = useState<'destacados' | 'action' | 'memories' | 'porConfirmar'>('destacados');
  const [memoryEntityId, setMemoryEntityId] = useState<string | null>(null);

  // Interaction States
  const [editingEntity, setEditingEntity] = useState<any | null>(null);
  const [currentRegion, setCurrentRegion] = useState<Region | null>(null);
  const [listRegion, setListRegion] = useState<Region | null>(null); // separate region for list filtering, not updated on programmatic moves

  const [actionEntity, setActionEntity] = useState<any | null>(null);
  const [selectedPlaceEntity, setSelectedPlaceEntity] = useState<any | null>(null);

  // Place confirmation states
  const [searchQuery, setSearchQuery] = useState('');
  const [placeSuggestions, setPlaceSuggestions] = useState<any[]>([]);
  const [suggestionLimit, setSuggestionLimit] = useState(4);
  const [selectedPlace, setSelectedPlace] = useState<any | null>(null);
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const [showParentAssign, setShowParentAssign] = useState(false);
  const [allLocations, setAllLocations] = useState<any[]>([]);
  const [confirmMode, setConfirmMode] = useState<'none' | 'quick' | 'precise'>('none');
  const [targetGeoLevel, setTargetGeoLevel] = useState<number>(0); // 0=Point, 2=City, 3=Region, 4=Country
  const [autoTopResult, setAutoTopResult] = useState<any | null>(null);
  const [loadingAutoTop, setLoadingAutoTop] = useState(false);
  const [addressQuery, setAddressQuery] = useState('');
  const searchDebounce = useRef<NodeJS.Timeout | null>(null);
  const addressDebounce = useRef<NodeJS.Timeout | null>(null);

  const isFocused = useIsFocused();
  const mapRef = useRef<MapView>(null);
  const isProgrammaticMove = useRef(false);

  const closePanel = () => {
    setPanelMode('hidden');
    setActionEntity(null);
    setMemoryEntityId(null);
    setConfirmMode('none');
    setExpandedListItem(null);
    setAddressQuery('');
    setEditingEntity(null);
    setSelectedPlaceEntity(null);
    setTargetGeoLevel(0);
  };

  const toggleExpand = () => {
    setPanelMode(prev => prev === 'peek' ? 'full' : 'peek');
  };

  // Auto-switch back to destacados when all pending confirmations are resolved
  React.useEffect(() => {
    if (panelType === 'porConfirmar' && porConfirmar.length === 0) {
      setPanelType('destacados');
    }
  }, [porConfirmar.length, panelType]);

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
          COUNT(me.memory_id) as mem_count,
          SUM(CASE WHEN h.descendant_id = e.id AND me.memory_id IS NOT NULL THEN 1 ELSE 0 END) as direct_mem_count
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
        } catch { }
        entityMap.set(r.id, { ...r, children: [], geoLevel });
      });
      // Load ALL parent_id relationships so we can bridge gaps in the visible tree
      const allParents = await db.getAllAsync<{ id: string, parent_id: string | null }>(
        `SELECT id, parent_id FROM entities WHERE type = 'LOCATION'`
      );
      const fullParentLookup = new Map<string, string | null>();
      allParents.forEach(row => fullParentLookup.set(row.id, row.parent_id));

      // For each entity, find the nearest ancestor that IS in entityMap
      const resolveVisibleParent = (parentId: string | null): string | null => {
        const visited = new Set<string>();
        let current = parentId;
        while (current) {
          if (entityMap.has(current)) return current;
          if (visited.has(current)) return null; // cycle guard
          visited.add(current);
          current = fullParentLookup.get(current) ?? null;
        }
        return null;
      };

      // Build children arrays using resolved (gap-bridged) parent references
      const resolvedParentIds = new Map<string, string | null>();
      locatedRows.forEach(r => {
        const resolved = resolveVisibleParent(r.parent_id);
        // Don't parent to self
        const finalParent = (resolved && resolved !== r.id) ? resolved : null;
        resolvedParentIds.set(r.id, finalParent);
        if (finalParent && entityMap.has(finalParent)) {
          entityMap.get(finalParent).children.push(r.id);
        }
      });

      // Check DB for entities that are parents (have children, even those without coords)
      // This ensures territories always act as clusters, not leaves
      const dbParents = await db.getAllAsync<{ parent_id: string, child_count: number }>(
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
        // Use resolved (gap-bridged) parent_id instead of raw DB parent_id
        parent_id: resolvedParentIds.get(node.id) ?? null,
        // Use geo_level (geographic truth) if available, otherwise fall back to tree height
        height: node.geoLevel ?? node.treeHeight ?? 0,
        hasChildren: node.children.length > 0,
        mem_count: node.mem_count,
        direct_mem_count: node.direct_mem_count,
        coordinate: { latitude: node.latitude, longitude: node.longitude }
      }));

      setMarkers(processedMarkers);
      setDestacados(processedMarkers);

      // Por Confirmar: unconfirmed with coords + ALL unconfirmed locations without coords
      const noCoordRows = await db.getAllAsync<any>(
        `SELECT id, name as title, is_confirmed, parent_id, metadata, 0 as mem_count, 0 as direct_mem_count
         FROM entities WHERE type = 'LOCATION' AND latitude IS NULL AND is_confirmed = 0`
      );

      const isTerritory = (m: any) => {
        if (m.height >= 2 || m.hasChildren) return true;
        if (m.metadata) {
          try {
            const meta = JSON.parse(m.metadata);
            if (meta.geo_level >= 2) return true;
          } catch { }
        }
        return false;
      };

      const unconfirmedWithCoords = processedMarkers.filter(m => m.is_confirmed === 0);
      const noCoordFormatted = noCoordRows.map(r => {
        let geoLevel = 0;
        if (r.metadata) {
          try {
            const meta = JSON.parse(r.metadata);
            if (meta.geo_level) geoLevel = meta.geo_level;
          } catch (e) { }
        }
        return {
          id: r.id, title: r.title, is_confirmed: 0, parent_id: r.parent_id,
          height: geoLevel, hasChildren: false, mem_count: r.mem_count,
          direct_mem_count: r.direct_mem_count,
          coordinate: null,
        };
      });
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
      setListRegion(targetRegion);
      mapRef.current?.animateToRegion(targetRegion);
    } else {
      setCurrentRegion(currentRegion || initialRegion);
      setListRegion(currentRegion || initialRegion);
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
      const unconfirmedChildren = await db.getAllAsync<{ id: string }>(
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

  const filterPlacesByType = (places: any[], targetLevel: number) => {
    return places.filter(p => {
      const types = p.types || (p.placePrediction ? p.placePrediction.types : []) || [];
      if (targetLevel === 4) return types.includes('country');
      if (targetLevel === 3) return types.includes('administrative_area_level_1') || types.includes('administrative_area_level_2');
      if (targetLevel === 2) return types.includes('locality') || types.includes('sublocality') || types.includes('administrative_area_level_3');
      if (targetLevel === 0) {
        const isTerritory = types.some((t: string) => ['country', 'administrative_area_level_1', 'administrative_area_level_2', 'locality', 'sublocality', 'administrative_area_level_3'].includes(t));
        return !isTerritory;
      }
      return true;
    });
  };

  const fetchPlaceDetails = async (placeId: string) => {
    try {
      const apiKey = await getConfig('GOOGLE_MAPS_KEY');
      const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}?fields=id,displayName,formattedAddress,location,addressComponents,types`, {
        headers: { 'X-Goog-Api-Key': apiKey }
      });
      return await res.json();
    } catch (e) {
      console.error('fetchPlaceDetails error:', e);
      return null;
    }
  };

  const fetchTopSuggestion = async (entity: any, level: number = targetGeoLevel) => {
    try {
      setLoadingAutoTop(true);
      setAutoTopResult(null);

      if (entity.metadata) {
        try {
          const meta = typeof entity.metadata === 'string' ? JSON.parse(entity.metadata) : entity.metadata;
          if (meta.original_ai_place) {
            const cachedPlace = meta.original_ai_place;
            const filtered = filterPlacesByType([cachedPlace], level);
            if (filtered.length > 0) {
              const topResult = filtered[0];
              setAutoTopResult(topResult);
              setSelectedPlace(topResult);
              if (topResult.location) {
                const delta = getDeltaForGeoLevel(level);
                mapRef.current?.animateToRegion({
                  latitude: topResult.location.latitude,
                  longitude: topResult.location.longitude,
                  latitudeDelta: delta, longitudeDelta: delta,
                }, 500);
              }
              setLoadingAutoTop(false);
              return;
            }
          }
        } catch (e) { }
      }

      const apiKey = await getConfig('GOOGLE_MAPS_KEY');
      if (!apiKey) { setLoadingAutoTop(false); return; }

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

      const autoBody: any = { input: entity.title.trim() };
      
      let includedTypes: string[] = [];
      if (level === 4) includedTypes = ['country'];
      else if (level === 3) includedTypes = ['administrative_area_level_1', 'administrative_area_level_2'];
      else if (level === 2) includedTypes = ['(cities)'];
      
      if (includedTypes.length > 0) {
          autoBody.includedPrimaryTypes = includedTypes;
      }

      const unbiasedBody: any = { ...autoBody };
      const biasedBody: any = { ...autoBody };

      if (entity.coordinate?.latitude) {
        biasedBody.locationBias = {
          circle: {
            center: { latitude: entity.coordinate.latitude, longitude: entity.coordinate.longitude },
            radius: 10000, 
          }
        };
      } else if (validCoords) {
        biasedBody.locationBias = {
          rectangle: {
            low: { latitude: Math.max(-90, minLat - 5), longitude: Math.max(-180, minLon - 5) },
            high: { latitude: Math.min(90, maxLat + 5), longitude: Math.min(180, maxLon + 5) }
          }
        };
      }

      const unbiasedReq = fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
        body: JSON.stringify(unbiasedBody),
      });

      const biasedReq = fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
        body: JSON.stringify(biasedBody),
      });

      const [unbiasedRes, biasedRes] = await Promise.all([unbiasedReq, biasedReq]);
      const unbiasedData = await unbiasedRes.json();
      const biasedData = await biasedRes.json();

      let unbiasedSuggestions = unbiasedData.suggestions || [];
      let biasedSuggestions = biasedData.suggestions || [];

      // We rely natively on Google's includedPrimaryTypes. JS filter is a safety net.
      unbiasedSuggestions = filterPlacesByType(unbiasedSuggestions, level);
      biasedSuggestions = filterPlacesByType(biasedSuggestions, level);

      let finalSuggestions: any[] = [];
      
      // FOR AUTO TOP SUGGESTION: We strongly prefer the BIASED suggestion (the one at the marker).
      if (biasedSuggestions.length > 0) {
        finalSuggestions.push(biasedSuggestions[0]);
      } else if (unbiasedSuggestions.length > 0) {
        finalSuggestions.push(unbiasedSuggestions[0]);
      }

      if (finalSuggestions.length > 0) {
        const topSuggestion = finalSuggestions[0];
        
        const details = await fetchPlaceDetails(topSuggestion.placePrediction.placeId);
        
        if (details) {
          const topResult = { ...topSuggestion, details };
          setAutoTopResult(topResult);
          setSelectedPlace(topResult);
          
          if (details.location) {
            const delta = getDeltaForGeoLevel(level);
            mapRef.current?.animateToRegion({
              latitude: details.location.latitude,
              longitude: details.location.longitude,
              latitudeDelta: delta, longitudeDelta: delta,
            }, 500);
          }
        }
      }
    } catch (e) {
      console.error('Auto top suggestion error:', e);
    } finally {
      setLoadingAutoTop(false);
    }
  };

  const searchPlaces = async (query: string, level: number = targetGeoLevel) => {
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
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.addressComponents,places.types',
        };

        // Compute Global Bounding Box of all user's confirmed locations
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

        const autoBody: any = { input: query.trim() };
        
        let includedTypes: string[] = [];
        if (level === 4) includedTypes = ['country'];
        else if (level === 3) includedTypes = ['administrative_area_level_1', 'administrative_area_level_2'];
        else if (level === 2) includedTypes = ['(cities)'];
        
        if (includedTypes.length > 0) {
            autoBody.includedPrimaryTypes = includedTypes;
        }

        const unbiasedBody: any = { ...autoBody };
        const biasedBody: any = { ...autoBody };

        if (actionEntity?.coordinate?.latitude) {
          biasedBody.locationBias = {
            circle: {
              center: { latitude: actionEntity.coordinate.latitude, longitude: actionEntity.coordinate.longitude },
              radius: 10000,
            }
          };
        } else if (validCoords) {
          biasedBody.locationBias = {
            rectangle: {
              low: { latitude: Math.max(-90, minLat - 5), longitude: Math.max(-180, minLon - 5) },
              high: { latitude: Math.min(90, maxLat + 5), longitude: Math.min(180, maxLon + 5) }
            }
          };
        } else if (currentRegion) {
          biasedBody.locationBias = {
            circle: {
              center: { latitude: currentRegion.latitude, longitude: currentRegion.longitude },
              radius: Math.max(5000, currentRegion.latitudeDelta * 111000),
            }
          };
        }

        const unbiasedReq = fetch('https://places.googleapis.com/v1/places:autocomplete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
          body: JSON.stringify(unbiasedBody),
        });

        const biasedReq = fetch('https://places.googleapis.com/v1/places:autocomplete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
          body: JSON.stringify(biasedBody),
        });

        const [unbiasedRes, biasedRes] = await Promise.all([unbiasedReq, biasedReq]);
        const unbiasedData = await unbiasedRes.json();
        const biasedData = await biasedRes.json();

        let unbiasedSuggestions = unbiasedData.suggestions || [];
        let biasedSuggestions = biasedData.suggestions || [];

        unbiasedSuggestions = filterPlacesByType(unbiasedSuggestions, level);
        biasedSuggestions = filterPlacesByType(biasedSuggestions, level);

        let finalSuggestions: any[] = [];
        let uIdx = 0; let bIdx = 0;
        
        while(uIdx < unbiasedSuggestions.length || bIdx < biasedSuggestions.length) {
            // WE ADD BIASED FIRST to ensure the local match is at the top of the UI list
            let bAdded = 0;
            while(bIdx < biasedSuggestions.length && bAdded < 2) {
                const bp = biasedSuggestions[bIdx++];
                if(!finalSuggestions.some(r => r.placePrediction.placeId === bp.placePrediction.placeId)) {
                   finalSuggestions.push(bp);
                   bAdded++;
                }
            }
            let uAdded = 0;
            while(uIdx < unbiasedSuggestions.length && uAdded < 3) {
                const up = unbiasedSuggestions[uIdx++];
                if(!finalSuggestions.some(r => r.placePrediction.placeId === up.placePrediction.placeId)) {
                    finalSuggestions.push(up);
                    uAdded++;
                }
            }
        }

        setSuggestionLimit(5);
        setPlaceSuggestions(finalSuggestions);
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
    Keyboard.dismiss();
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
        setSelectedPlace(null); // Clear selected place so the button switches to "Guardar posición del marcador"
      } else {
        Alert.alert('Sin resultados', `No se encontró: "${query}".`);
      }
    } catch (e) {
      console.error('Geocode error:', e);
      Alert.alert('Error', 'No se pudo geocodificar la dirección.');
    }
  };

  const selectPlaceSuggestion = async (place: any) => {
    Keyboard.dismiss();
    setSelectedPlace(place);
    
    // Check if it's an autocomplete prediction
    if (place.placePrediction && place.placePrediction.placeId) {
      setSearchingPlaces(true);
      const details = await fetchPlaceDetails(place.placePrediction.placeId);
      setSearchingPlaces(false);
      
      if (details) {
        const fullPlace = { ...place, details };
        setSelectedPlace(fullPlace);
        if (details.location) {
          const delta = getDeltaForGeoLevel(targetGeoLevel);
          mapRef.current?.animateToRegion({
            latitude: details.location.latitude,
            longitude: details.location.longitude,
            latitudeDelta: delta,
            longitudeDelta: delta,
          }, 500);
        }
      }
    } else if (place.location) {
      // Legacy / cached object that already has details
      const delta = getDeltaForGeoLevel(targetGeoLevel);
      mapRef.current?.animateToRegion({
        latitude: place.location.latitude,
        longitude: place.location.longitude,
        latitudeDelta: delta,
        longitudeDelta: delta,
      }, 500);
    }
  };

  const confirmPlace = async () => {
    if (!actionEntity || !selectedPlace) return;
    try {
      const db = await getDb();
      
      const isAuto = !!selectedPlace.placePrediction;
      const details = isAuto ? selectedPlace.details : selectedPlace;

      if (!details || !details.location) {
          Alert.alert("Error", "No se han cargado los detalles completos del lugar aún.");
          return;
      }
      
      const lat = details.location.latitude;
      const lon = details.location.longitude;

      // Update entity with confirmed coordinates
      await db.runAsync(
        "UPDATE entities SET latitude = ?, longitude = ?, is_confirmed = 1 WHERE id = ?",
        lat, lon, actionEntity.id
      );

      // Generate territorial hierarchy automatically from addressComponents
      const components = details.addressComponents || [];
      const getComp = (type: string) => components.find((c: any) => c.types?.includes(type))?.longText || '';
      const address = {
        city: getComp('locality') || getComp('administrative_area_level_2'),
        state: getComp('administrative_area_level_1'),
        country: getComp('country'),
      };
      await generateTerritorialHierarchy(db, actionEntity.id, actionEntity.title, { lat, lon, address });

      // FORCE geo_level if user explicitly selected a territory
      if (targetGeoLevel > 0) {
        await db.runAsync(
          "UPDATE entities SET metadata = json_set(COALESCE(metadata, '{}'), '$.geo_level', ?) WHERE id = ?",
          targetGeoLevel, actionEntity.id
        );
      }

      // Cleanup orphaned territories that were left behind (e.g. old AI assumed parents)
      let cleanupChanges = 1;
      while (cleanupChanges > 0) {
        const cleanupRes = await db.runAsync(
          "DELETE FROM entities WHERE type = 'LOCATION' AND is_confirmed = 1 AND id NOT IN (SELECT entity_id FROM memory_entities) AND id NOT IN (SELECT parent_id FROM entities WHERE parent_id IS NOT NULL)"
        );
        cleanupChanges = cleanupRes.changes;
      }

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
      {
        text: 'Eliminar', style: 'destructive', onPress: async () => {
          try {
            const db = await getDb();
            await db.runAsync("DELETE FROM memory_entities WHERE entity_id = ?", entityId);
            await db.runAsync("DELETE FROM entities WHERE id = ?", entityId);
            
            // Cascading delete for orphaned parent territories
            let cleanupChanges = 1;
            while (cleanupChanges > 0) {
              const cleanupRes = await db.runAsync(
                "DELETE FROM entities WHERE type = 'LOCATION' AND is_confirmed = 1 AND id NOT IN (SELECT entity_id FROM memory_entities) AND id NOT IN (SELECT parent_id FROM entities WHERE parent_id IS NOT NULL)"
              );
              cleanupChanges = cleanupRes.changes;
            }
            
            loadLocations();
          } catch (e) {
            console.error(e);
          }
        }
      }
    ]);
  };

  const assignParentToAction = async (parentId: string) => {
    if (!actionEntity) return;
    try {
      const db = await getDb();
      // Set parent, but don't confirm coordinates yet - let user adjust marker
      await db.runAsync("UPDATE entities SET parent_id = ? WHERE id = ?", actionEntity.id, actionEntity.id);

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
            
            // Cleanup orphaned territories that were left behind
            let cleanupChanges = 1;
            while (cleanupChanges > 0) {
              const cleanupRes = await db.runAsync(
                "DELETE FROM entities WHERE type = 'LOCATION' AND is_confirmed = 1 AND id NOT IN (SELECT entity_id FROM memory_entities) AND id NOT IN (SELECT parent_id FROM entities WHERE parent_id IS NOT NULL)"
              );
              cleanupChanges = cleanupRes.changes;
            }
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

  const jumpTo = (item: any) => {
    if (!item || !item.coordinate) return;
    
    let latDelta = 0.01;
    if (item.height !== undefined && item.height !== null) {
      if (item.height >= 4) {
        latDelta = 15.0; // País
      } else if (item.height === 3) {
        latDelta = 4.0;  // Región/Estado
      } else if (item.height === 2) {
        latDelta = 0.5;  // Ciudad/Pueblo
      } else if (item.height === 1) {
        latDelta = 0.05; // Barrio/Localidad
      }
    }

    isProgrammaticMove.current = true;
    mapRef.current?.animateToRegion({
      latitude: item.coordinate.latitude,
      longitude: item.coordinate.longitude,
      latitudeDelta: latDelta,
      longitudeDelta: latDelta,
    });
  };

  const visibleNodesInList = React.useMemo(() => {
    if (!listRegion || destacados.length === 0) return new Set<string>();
    
    const latMin = listRegion.latitude - listRegion.latitudeDelta / 2;
    const latMax = listRegion.latitude + listRegion.latitudeDelta / 2;
    const lonMin = listRegion.longitude - listRegion.longitudeDelta / 2;
    const lonMax = listRegion.longitude + listRegion.longitudeDelta / 2;
    
    const parentMap = new Map<string, string>();
    destacados.forEach(d => {
      if (d.parent_id) parentMap.set(d.id, d.parent_id);
    });

    const visible = new Set<string>();
    
    destacados.forEach(d => {
      if (d.coordinate) {
        if (d.coordinate.latitude >= latMin && d.coordinate.latitude <= latMax &&
            d.coordinate.longitude >= lonMin && d.coordinate.longitude <= lonMax) {
          
          let currentId = d.id;
          while (currentId) {
            visible.add(currentId);
            currentId = parentMap.get(currentId) || '';
          }
        }
      }
    });
    
    return visible;
  }, [destacados, listRegion]);

  const visibleMarkers = React.useMemo(() => {
    const delta = currentRegion?.latitudeDelta || 100;

    // Height thresholds (geo_level matches these: 0=leaf, 1=neighborhood, 2=city, 3=state, 4=country)
    let visibleHeight = 0;
    if (delta <= 0.05) visibleHeight = 0;
    else if (delta <= 0.5) visibleHeight = 1;
    else if (delta <= 5) visibleHeight = 2;
    else if (delta <= 25) visibleHeight = 3;
    else visibleHeight = 4;

    // Pre-build children map and marker lookup for O(1) access
    const markerMap = new Map<string, any>();
    const childrenOf = new Map<string, any[]>();
    const roots: any[] = [];

    markers.forEach(m => {
      markerMap.set(m.id, m);
    });

    markers.forEach(m => {
      // Add to children map or roots
      if (m.parent_id && markerMap.has(m.parent_id)) {
        if (!childrenOf.has(m.parent_id)) childrenOf.set(m.parent_id, []);
        childrenOf.get(m.parent_id)!.push(m);
      } else {
        roots.push(m);
      }
    });

    // Smart split: measure child-to-child spread
    const childSpread = (nodeId: string): number => {
      const children = childrenOf.get(nodeId);
      if (!children || children.length < 2) return 0;

      let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
      let validCount = 0;
      for (const child of children) {
        if (!child.coordinate) continue;
        minLat = Math.min(minLat, child.coordinate.latitude);
        maxLat = Math.max(maxLat, child.coordinate.latitude);
        minLon = Math.min(minLon, child.coordinate.longitude);
        maxLon = Math.max(maxLon, child.coordinate.longitude);
        validCount++;
      }
      if (validCount < 2) return 0;
      // use the max of lat or lon spread as the metric
      return Math.max(maxLat - minLat, maxLon - minLon);
    };

    const resultList: any[] = [];

    // Always show actionEntity and editingEntity regardless of tree logic
    const specialIds = new Set<string>();
    if (editingEntity) specialIds.add(editingEntity.id);
    // Note: actionEntity is intentionally NOT added to specialIds because we want to hide it completely (avoids phantom pin)

    const traverse = (node: any) => {
      if (specialIds.has(node.id)) {
        resultList.push(node);
        return; // Always show special nodes, no need to traverse them as clusters
      }

      if (actionEntity && actionEntity.id === node.id) {
        // Explicitly hide the actionEntity marker
        return;
      }

      const children = childrenOf.get(node.id) || [];

      // A node ONLY dissolves if it has renderable children to replace it
      let shouldDissolve = node.height > visibleHeight && children.length > 0;

      if (!shouldDissolve && children.length > 0) {
        // If it shouldn't normally dissolve, but children are spread wide, force dissolve it
        const spread = childSpread(node.id);
        if (spread > delta * 0.3) {
          shouldDissolve = true;
        }
      }

      if (shouldDissolve) {
        children.forEach(child => traverse(child));
      } else {
        if (node.coordinate) {
          resultList.push(node);
        }
      }
    };

    // Start traversal from all roots
    roots.forEach(root => traverse(root));

    return resultList;
  }, [markers, currentRegion, editingEntity, actionEntity]);

  const { height: windowHeight } = Dimensions.get('window');
  const panelHeight = panelMode === 'full' ? windowHeight * 0.9 : (panelMode === 'peek' ? windowHeight * 0.45 : 0);
  const activeMapPadding = (editingEntity || (actionEntity && panelType === 'action') || panelMode !== 'hidden') ? panelHeight : 0;

  return (
    <View style={styles.container}>
      {panelMode !== 'full' && (
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
      )}

      {initialRegion ? (
        <View style={styles.mapContainer}>
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={initialRegion}
            mapPadding={{ top: 0, right: 0, bottom: activeMapPadding, left: 0 }}
            onPress={(e) => {
               Keyboard.dismiss();
               if (e.nativeEvent.action !== 'marker-press') {
                 setSelectedPlaceEntity(null);
               }
            }}
            onRegionChange={(region) => {
              setCurrentRegion(region);
            }}
            onRegionChangeComplete={(region) => {
              setCurrentRegion(region);
              if (!isProgrammaticMove.current) {
                setListRegion(region);
              } else {
                isProgrammaticMove.current = false;
              }
            }}
            onPanDrag={() => {
              isProgrammaticMove.current = false;
              // Only clear selectedPlace for Point-level (targetGeoLevel === 0) entities.
              // For territories (city/region/country), moving the map should NOT clear the selection
              // since the marker is just a visual tool and doesn't affect where the territory is saved.
              if (selectedPlace && targetGeoLevel === 0) setSelectedPlace(null);
            }}
            showsUserLocation={!editingEntity}
          >
            {!editingEntity && (() => {
              const valid = visibleMarkers.filter(m => !(m.is_confirmed === 1 && m.mem_count === 0 && !m.hasChildren));
              const counts = valid.map(m => m.mem_count || 1);
              const maxCount = Math.max(...counts, 1);
              // Calculate meters per pixel based on screen WIDTH to make it completely immune to vertical padding changes
              const deltaX = currentRegion?.longitudeDelta || 0.05;
              const lat = currentRegion?.latitude || 0;
              const screenW = Dimensions.get('window').width || 400;
              
              // Prevent 0 or negative values which crash Android MapView
              const cosLat = Math.max(Math.abs(Math.cos(lat * Math.PI / 180)), 0.01);
              const mPerPx = (deltaX * 111320 * cosLat) / screenW;
              const minPx = 18; 
              const maxPx = 35; 

              return valid.flatMap(marker => {
                const value = marker.mem_count || 1;
                const px = minPx + (maxPx - minPx) * Math.sqrt(value / maxCount);
                // Cap radius at 4000km to prevent geometry crashes on huge zoom outs
                const radiusM = Math.max(1, Math.min(px * mPerPx, 4000000));
                const fillColor = marker.is_confirmed === 0 ? 'rgba(255,152,0,0.45)' : 'rgba(229,57,53,0.45)';
                const strokeColor = marker.is_confirmed === 0 ? '#e68900' : '#b71c1c';

                return [
                  <MapCircle
                    key={`circle-${marker.id}`}
                    center={marker.coordinate}
                    radius={radiusM}
                    fillColor={fillColor}
                    strokeColor={strokeColor}
                    strokeWidth={2}
                    zIndex={1}
                  />,
                  <Marker
                    key={marker.id}
                    coordinate={marker.coordinate}
                    anchor={{ x: 0.5, y: 0.5 }}
                    tracksViewChanges={true}
                    onPress={(e) => {
                      if (e.stopPropagation) e.stopPropagation();
                      if (marker.is_confirmed === 0) {
                        setActionEntity(marker);
                        setConfirmMode('none');
                        setSearchQuery(marker.title);
                        setTargetGeoLevel(marker.height || 0);
                        fetchTopSuggestion(marker, marker.height || 0);
                        setPanelType('action');
                        setPanelMode('peek');
                      } else {
                        setSelectedPlaceEntity(marker);
                        setMemoryEntityId(marker.id);
                        setPanelType('memories');
                        setPanelMode('peek');
                      }
                    }}
                  >
                    <View style={{ width: 36, height: 36 }}>
                      <Text style={{
                        width: 36, height: 36, lineHeight: 36,
                        textAlign: 'center',
                        color: 'white', fontWeight: 'bold', fontSize: 13,
                        textShadowColor: 'rgba(0,0,0,0.7)',
                        textShadowOffset: { width: 0, height: 1 },
                        textShadowRadius: 2,
                      }}>
                        {marker.mem_count}
                      </Text>
                    </View>
                  </Marker>
                ];
              });
            })()}
          </MapView>

          {/* Debug HUD for Zoom tweaks */}
          <View pointerEvents="none" style={styles.debugHud}>
            <Text style={styles.debugText}>Zoom (Delta): {currentRegion?.latitudeDelta?.toFixed(4)}</Text>
            <Text style={styles.debugText}>Marcadores Visibles: {visibleMarkers.length}</Text>
          </View>

          {(editingEntity || (actionEntity && panelType === 'action')) && (
            <View style={[styles.staticPinContainer, { paddingBottom: activeMapPadding }]} pointerEvents="none">
              <View style={[styles.clusterMarker, { backgroundColor: '#e53935', width: 36, height: 36, borderRadius: 18 }]} />
            </View>
          )}
        </View>
      ) : (
        <View style={styles.loadingContainer}>
          <Text>Obteniendo ubicación...</Text>
        </View>
      )}

      {/* FAB for Places */}
      {!editingEntity && panelMode === 'hidden' && !selectedPlaceEntity && (
        <View style={styles.fabContainer}>
          <FAB
            icon="map-marker-star"
            style={[styles.fabLeft, porConfirmar.length > 0 && { backgroundColor: '#FFF3E0' }]}
            onPress={() => {
              if (panelType !== 'porConfirmar') {
                setPanelType('destacados');
              }
              setPanelMode('peek');
            }}
            label={porConfirmar.length > 0 ? `Lugares (${porConfirmar.length} ⚠️)` : 'Lugares'}
          />
        </View>
      )}

      {/* Floating Action Menu for Selected Marker removed: integrated into Appbar */}

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
      <KeyboardAvoidingView 
        behavior="padding"
        style={[StyleSheet.absoluteFill, { zIndex: 100, elevation: 100 }]}
        pointerEvents="box-none"
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          {panelMode !== 'hidden' && !editingEntity && (
            <View style={[
              panelMode === 'full' ? styles.panelFull : styles.panelPeek,
              { height: panelHeight }
            ]}>
              {/* Header */}
          <View style={styles.panelHeader}>
            <IconButton icon="close" onPress={closePanel} />
            <Text style={[styles.panelTitle, { flex: 1 }]} numberOfLines={1}>
              {panelType === 'destacados' ? `Lugares (${destacados.length})` :
                panelType === 'porConfirmar' ? `Por Confirmar (${porConfirmar.length})` :
                panelType === 'action' ? actionEntity?.title :
                  panelType === 'memories' ? (selectedPlaceEntity?.title || 'Explorador') : ''}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {panelType === 'destacados' && porConfirmar.length > 0 && (
                <TouchableOpacity 
                  onPress={() => setPanelType('porConfirmar')}
                  style={{ marginRight: 5, flexDirection: 'row', alignItems: 'center', backgroundColor: '#D32F2F', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}
                >
                  <MaterialCommunityIcons name="alert-circle-outline" size={16} color="#FFFFFF" style={{ marginRight: 4 }} />
                  <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: 'bold' }}>
                    Resolver ({porConfirmar.length})
                  </Text>
                </TouchableOpacity>
              )}
              {panelType === 'porConfirmar' && (
                <Button 
                  mode="text" 
                  onPress={() => setPanelType('destacados')}
                  style={{ marginRight: 5 }}
                >
                  Volver
                </Button>
              )}
              {panelType === 'memories' && (
                <Button 
                  mode="text" 
                  icon="arrow-left"
                  onPress={() => {
                    setMemoryEntityId(null);
                    setSelectedPlaceEntity(null);
                    setPanelType('destacados');
                  }}
                  style={{ marginRight: 5 }}
                  compact
                >
                  Lugares
                </Button>
              )}
              {panelType === 'memories' && selectedPlaceEntity && (
                <>
                  {!(selectedPlaceEntity.is_confirmed === 1 && selectedPlaceEntity.height >= 2 && selectedPlaceEntity.direct_mem_count === 0) && (
                    <IconButton icon="pencil" size={20} iconColor="#1565C0" onPress={() => {
                      setActionEntity(selectedPlaceEntity);
                      setConfirmMode('none');
                      setSearchQuery(selectedPlaceEntity.title);
                      fetchTopSuggestion(selectedPlaceEntity);
                      setSelectedPlace(null);
                      setPlaceSuggestions([]);
                      setAddressQuery('');
                      setEditingEntity(null);
                      setMemoryEntityId(null);
                      setPanelType('action'); 
                      setPanelMode('peek');
                      setSelectedPlaceEntity(null);
                    }} style={{ margin: 0, backgroundColor: '#e3f2fd' }} />
                  )}
                  {!(selectedPlaceEntity.is_confirmed === 1 && selectedPlaceEntity.height >= 2 && selectedPlaceEntity.direct_mem_count === 0) && (
                    <IconButton icon="delete-outline" size={20} iconColor="#B00020" onPress={() => {
                      deleteEntity(selectedPlaceEntity.id);
                      setSelectedPlaceEntity(null);
                      setPanelMode('hidden');
                    }} style={{ margin: 0, marginLeft: 4, backgroundColor: '#ffebee' }} />
                  )}
                </>
              )}
              {panelType !== 'action' && (
                <IconButton icon={panelMode === 'full' ? 'chevron-down' : 'chevron-up'} onPress={toggleExpand} />
              )}
            </View>
          </View>

          <View style={{ flex: 1 }}>
            {panelType === 'destacados' && (
              <View style={{ flex: 1 }}>
                <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 5 }}>
                  <View style={{ flexDirection: 'row', marginBottom: 10 }}>
                    <Button 
                      mode={listMode === 'visible' ? 'contained' : 'outlined'}
                      icon="map-marker-radius"
                      style={{ flex: 1, borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
                      onPress={() => {
                        setListMode('visible');
                        setCategoryLimits({});
                      }}
                    >
                      En Pantalla
                    </Button>
                    <Button 
                      mode={listMode === 'all' ? 'contained' : 'outlined'}
                      icon="format-list-bulleted"
                      style={{ flex: 1, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeftWidth: 0 }}
                      onPress={() => {
                        setListMode('all');
                        setCategoryLimits({});
                      }}
                    >
                      Ver Todos
                    </Button>
                  </View>
                  <Searchbar
                    placeholder="Buscar lugar..."
                    onChangeText={setLocalSearchQuery}
                    value={localSearchQuery}
                    style={{ height: 45, elevation: 0, backgroundColor: '#f0f0f0' }}
                    inputStyle={{ minHeight: 45 }}
                  />
                </View>
                <ScrollView style={styles.listArea}>
                  {/* Confirmed items - Grouped */}
                  {destacados.length === 0 ? (
                    <Text style={styles.emptyText}>No hay lugares registrados aún.</Text>
                  ) : (
                    <>
                      {(() => {
                         const delta = (listRegion || currentRegion)?.latitudeDelta || 100;
                         let currentHeight = 4;
                         if (delta <= 0.5) currentHeight = 1; // Puntos/Barrios
                         else if (delta <= 5) currentHeight = 2; // Ciudades
                         else if (delta <= 25) currentHeight = 3; // Regiones

                         const defaultSections = [
                           { title: 'Países', filter: (d: any) => d.height >= 4, icon: '🏳️', height: 4 },
                           { title: 'Regiones y Estados', filter: (d: any) => d.height === 3, icon: '🗺️', height: 3 },
                           { title: 'Ciudades y Pueblos', filter: (d: any) => d.height === 2, icon: '🏙️', height: 2 },
                           { title: 'Lugares Específicos', filter: (d: any) => d.height < 2, icon: '📍', height: 1 }
                         ];
                         
                         const activeSections = [...defaultSections].sort((a, b) => {
                           if (a.height === currentHeight) return -1;
                           if (b.height === currentHeight) return 1;
                           
                           if (currentHeight >= 4) return b.height - a.height; // 4, 3, 2, 1
                           if (currentHeight === 3) {
                             const order = [3, 2, 1, 4];
                             return order.indexOf(a.height) - order.indexOf(b.height);
                           }
                           if (currentHeight === 2) {
                             const order = [2, 1, 3, 4];
                             return order.indexOf(a.height) - order.indexOf(b.height);
                           }
                           return a.height - b.height; // 1, 2, 3, 4
                         });
                         
                         let totalRendered = 0;

                         const renderedSections = activeSections.map((section, idx) => {
                           let items = destacados.filter(d => d.is_confirmed !== 0 && section.filter(d));
                           
                           if (listMode === 'visible') {
                             items = items.filter(d => visibleNodesInList.has(d.id));
                           }
                           
                           if (localSearchQuery.trim()) {
                             const q = localSearchQuery.toLowerCase();
                             items = items.filter(d => d.title.toLowerCase().includes(q));
                           }
                           
                           if (items.length === 0) return null;
                           
                           const limit = categoryLimits[section.title] || 10;
                           const displayedItems = items.slice(0, limit);
                           const hasMore = items.length > limit;
                           
                           totalRendered += displayedItems.length;

                           return (
                             <View key={idx}>
                               <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#666', marginTop: 15, marginBottom: 8, marginLeft: 10 }}>
                                 {section.title}
                               </Text>
                               {displayedItems.map(item => (
                                 <View key={item.id} style={{ width: '100%', overflow: 'hidden' }}>
                                   <ScrollView
                                     horizontal
                                     showsHorizontalScrollIndicator={false}
                                     snapToOffsets={[0, 100]}
                                     decelerationRate="fast"
                                   >
                                     <TouchableOpacity
                                       onPress={() => {
                                         jumpTo(item);
                                         setExpandedListItem(expandedListItem === item.id ? null : item.id);
                                       }}
                                       style={[styles.listItem, { width: windowHeight > 0 ? Dimensions.get('window').width - 20 : '100%', flexDirection: 'column', alignItems: 'flex-start' }]}
                                     >
                                       <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
                                         <Text style={styles.listIcon}>{section.icon}</Text>
                                         <View style={{ flex: 1 }}>
                                           <Text style={styles.listTitle}>{item.title}</Text>
                                           <Text style={styles.listSub}>{item.mem_count > 0 ? `${item.mem_count} recuerdos` : 'Sin recuerdos'}</Text>
                                         </View>
                                       </View>
                                       {expandedListItem === item.id && (
                                         <Button 
                                           mode="contained-tonal" 
                                           icon="image-multiple" 
                                           style={{ marginTop: 10, alignSelf: 'flex-start', marginLeft: 45 }}
                                           onPress={(e) => {
                                             e.stopPropagation?.();
                                             setSelectedPlaceEntity(item);
                                             setMemoryEntityId(item.id);
                                             setPanelType('memories');
                                             setPanelMode('peek');
                                           }}
                                         >
                                           Ver recuerdos
                                         </Button>
                                       )}
                                     </TouchableOpacity>
                                     <View style={{ width: 100, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                                       {!(item.is_confirmed === 1 && item.height >= 2 && item.direct_mem_count === 0) && (
                                         <IconButton icon="pencil" size={20} iconColor="#1565C0" onPress={() => {
                                           setActionEntity(item);
                                           setConfirmMode('none');
                                           setSearchQuery(item.title);
                                           setTargetGeoLevel(item.height || 0);
                                           fetchTopSuggestion(item, item.height || 0);
                                           setSelectedPlace(null);
                                           setPlaceSuggestions([]);
                                           setAddressQuery('');
                                           setEditingEntity(null);
                                           setMemoryEntityId(null);
                                           setPanelType('action');
                                           setPanelMode('peek');
                                         }} style={{ margin: 0, marginRight: 5, backgroundColor: '#e3f2fd' }} />
                                       )}
                                       {!(item.is_confirmed === 1 && item.height >= 2 && item.direct_mem_count === 0) && (
                                         <IconButton icon="delete-outline" size={20} iconColor="#B00020" onPress={() => deleteEntity(item.id)} style={{ margin: 0, backgroundColor: '#ffebee' }} />
                                       )}
                                     </View>
                                   </ScrollView>
                                 </View>
                               ))}
                               
                               {hasMore && (
                                 <TouchableOpacity 
                                   style={{ paddingVertical: 10, alignItems: 'center', backgroundColor: '#fafafa', marginHorizontal: 10, borderRadius: 8, marginTop: 5 }}
                                   onPress={() => {
                                      setCategoryLimits(prev => ({
                                        ...prev,
                                        [section.title]: limit + 10
                                      }));
                                   }}
                                 >
                                   <Text style={{ color: '#1565C0', fontWeight: 'bold' }}>Ver más (+{items.length - limit})</Text>
                                 </TouchableOpacity>
                               )}
                             </View>
                           );
                         });
                         
                         if (totalRendered === 0 && listMode === 'visible') {
                           return <Text style={styles.emptyText}>No se encontraron lugares en la vista actual del mapa. Intenta ajustar el zoom o usa "Ver Todos".</Text>;
                         }
                         if (totalRendered === 0 && localSearchQuery) {
                           return <Text style={styles.emptyText}>No se encontraron resultados para "{localSearchQuery}".</Text>;
                         }
                         
                         return renderedSections;
                      })()}
                    </>
                  )}
                </ScrollView>
              </View>
            )}

            {panelType === 'porConfirmar' && (
              <ScrollView style={styles.listArea}>
                {porConfirmar.length === 0 ? (
                  <Text style={styles.emptyText}>No hay lugares por confirmar.</Text>
                ) : (
                  porConfirmar.map(item => (
                    <View key={item.id} style={{ width: '100%', overflow: 'hidden' }}>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        snapToOffsets={[0, 60]}
                        decelerationRate="fast"
                      >
                        <TouchableOpacity onPress={() => {
                          setActionEntity(item);
                          setSearchQuery(item.title);
                          setTargetGeoLevel(item.height || 0);
                          fetchTopSuggestion(item, item.height || 0);
                          setSelectedPlace(null);
                          setPlaceSuggestions([]);
                          setShowParentAssign(false);
                          setConfirmMode('none');
                          setAddressQuery('');
                          setEditingEntity(null);
                          setPanelType('action');
                          setPanelMode('peek');
                        }} style={[styles.listItem, { backgroundColor: '#FFF8E1', width: windowHeight > 0 ? Dimensions.get('window').width - 20 : '100%' }]}>
                          <Text style={styles.listIcon}>⚠️</Text>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.listTitle}>{item.title}</Text>
                            <Text style={[styles.listSub, { color: '#F57C00' }]}>Toca para confirmar ubicación</Text>
                          </View>
                        </TouchableOpacity>
                        <View style={{ width: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                          <IconButton icon="close" size={24} iconColor="#999" onPress={(e) => { e.stopPropagation?.(); deleteEntity(item.id); }} style={{ margin: 0, backgroundColor: '#f0f0f0' }} />
                        </View>
                      </ScrollView>
                    </View>
                  ))
                )}
              </ScrollView>
            )}

            {panelType === 'action' && actionEntity && (
              <View style={{ flex: 1 }}>
                <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, padding: 15 }} contentContainerStyle={{ paddingBottom: 80 }}>
                  <Text style={{ fontWeight: 'bold', fontSize: 16, marginBottom: 4 }}>
                    Confirmar: {actionEntity.title}
                  </Text>
                  
                  <View style={{ flexDirection: 'row', marginBottom: 12, backgroundColor: '#f5f5f5', borderRadius: 8, overflow: 'hidden' }}>
                    {[
                      { value: 0, label: '📍 Punto' },
                      { value: 2, label: '🏙️ Ciudad' },
                      { value: 3, label: '🗺️ Región' },
                      { value: 4, label: '🏳️ País' },
                    ].map((btn) => (
                      <TouchableOpacity
                        key={btn.value}
                        style={{ flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: targetGeoLevel === btn.value ? '#e3f2fd' : 'transparent' }}
                        onPress={() => {
                          setTargetGeoLevel(btn.value);
                          if (searchQuery) searchPlaces(searchQuery, btn.value);
                          fetchTopSuggestion(actionEntity, btn.value);
                        }}
                      >
                        <Text style={{ fontSize: 13, color: targetGeoLevel === btn.value ? '#1565C0' : '#555', fontWeight: targetGeoLevel === btn.value ? 'bold' : 'normal' }}>
                          {btn.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {targetGeoLevel === 0 && (
                    <Text style={{ color: '#888', fontSize: 12, marginBottom: 12 }}>
                      El marcador rojo indica dónde se guardará este lugar.
                    </Text>
                  )}

                  {/* ── Auto suggestion (first, clickable to re-center) ── */}
                  {loadingAutoTop ? (
                    <View style={{ alignItems: 'center', padding: 10 }}>
                      <ActivityIndicator size="small" color="#6200ee" />
                      <Text style={{ color: '#888', marginTop: 6, fontSize: 12 }}>Buscando sugerencia automática...</Text>
                    </View>
                  ) : autoTopResult ? (
                    (() => {
                      const isAuto = !!autoTopResult.placePrediction;
                      const mainText = isAuto ? autoTopResult.placePrediction.structuredFormat?.mainText?.text : autoTopResult.displayName?.text;
                      const subText = isAuto ? autoTopResult.placePrediction.structuredFormat?.secondaryText?.text : autoTopResult.formattedAddress;
                      const lat = isAuto ? autoTopResult.details?.location?.latitude : autoTopResult.location?.latitude;
                      const lon = isAuto ? autoTopResult.details?.location?.longitude : autoTopResult.location?.longitude;

                      return (
                        <TouchableOpacity
                          onPress={() => {
                            if (lat && lon) {
                              const delta = getDeltaForGeoLevel(targetGeoLevel);
                              mapRef.current?.animateToRegion({
                                latitude: lat,
                                longitude: lon,
                                latitudeDelta: delta, longitudeDelta: delta,
                              }, 500);
                            }
                          }}
                          style={{ backgroundColor: '#e8f5e9', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#c8e6c9', marginBottom: 12 }}
                        >
                          <Text style={{ fontWeight: 'bold', fontSize: 14, color: '#2e7d32', marginBottom: 2 }}>✨ Sugerencia</Text>
                          <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#333' }}>{mainText || ''}</Text>
                          <Text style={{ fontSize: 12, color: '#555' }}>{subText || ''}</Text>
                          <Text style={{ fontSize: 11, color: '#2e7d32', marginTop: 6 }}>Toca para centrar el marcador aquí</Text>
                        </TouchableOpacity>
                      );
                    })()
                  ) : null}


                  {/* ── "Not the right place?" (Permanent Section) ── */}
                  {confirmMode !== 'quick' ? (
                    <TouchableOpacity
                      onPress={() => {
                        setConfirmMode('quick');
                        searchPlaces(searchQuery);
                      }}
                      style={{ backgroundColor: '#F3E5F5', borderRadius: 10, padding: 14, marginBottom: 15, flexDirection: 'row', alignItems: 'center' }}
                    >
                      <Text style={{ fontSize: 20, marginRight: 12 }}>🔍</Text>
                      <Text style={{ color: '#6200ee', fontSize: 15, fontWeight: 'bold', flex: 1 }}>
                        ¿No es el lugar correcto?
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={{ marginBottom: 10 }}>
                      {/* ── Address field FIRST (ONLY FOR POINTS) ── */}
                      {targetGeoLevel === 0 && (
                        <View style={{ marginBottom: 12 }}>
                          <Text style={{ fontWeight: 'bold', fontSize: 15, color: '#444', marginBottom: 8 }}>
                            📍 Dirección Exacta
                          </Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                            <View style={{ flex: 1 }}>
                              <TextInput
                                mode="outlined"
                                label="Buscar por dirección"
                                value={addressQuery}
                                onChangeText={setAddressQuery}
                                onSubmitEditing={sendAddress}
                                dense
                                placeholder="Escribe una dirección exacta"
                                style={{ backgroundColor: 'white' }}
                                returnKeyType="send"
                              />
                            </View>
                            <IconButton icon="send" iconColor="#6200ee" size={24} onPress={sendAddress} style={{ marginLeft: 4 }} />
                          </View>
                        </View>
                      )}

                      <Text style={{ fontWeight: 'bold', fontSize: 15, color: '#444', marginBottom: 8, marginTop: 5 }}>
                        ✨ Búsqueda Inteligente
                      </Text>
                      <TextInput
                        mode="outlined"
                        label="Buscar lugar"
                        value={searchQuery}
                        onChangeText={searchPlaces}
                        onSubmitEditing={() => Keyboard.dismiss()}
                        dense
                        right={searchingPlaces ? <TextInput.Icon icon="loading" /> : <TextInput.Icon icon="magnify" />}
                        style={{ marginBottom: 10, backgroundColor: 'white' }}
                      />

                      {placeSuggestions.slice(0, suggestionLimit).map((place: any, idx: number) => {
                        const isAuto = !!place.placePrediction;
                        const placeId = isAuto ? place.placePrediction.placeId : place.id;
                        
                        const selectedIsAuto = !!selectedPlace?.placePrediction;
                        const selectedId = selectedIsAuto ? selectedPlace.placePrediction.placeId : selectedPlace?.id;
                        
                        const isSelected = selectedPlace && selectedId === placeId;

                        const mainText = isAuto ? place.placePrediction.structuredFormat?.mainText?.text : place.displayName?.text;
                        const subText = isAuto ? place.placePrediction.structuredFormat?.secondaryText?.text : place.formattedAddress;

                        return (
                          <TouchableOpacity
                            key={idx}
                            style={[styles.suggestionItem, isSelected && styles.suggestionSelected]}
                            onPress={() => selectPlaceSuggestion(place)}
                          >
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                              <Text style={{ fontSize: 18, marginRight: 10 }}>
                                {isSelected ? '✅' : '📍'}
                              </Text>
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontWeight: 'bold', fontSize: 15, color: '#333' }}>
                                  {mainText || ''}
                                </Text>
                                <Text style={{ fontSize: 12, color: '#888' }} numberOfLines={2}>
                                  {subText || ''}
                                </Text>
                              </View>
                            </View>
                          </TouchableOpacity>
                        );
                      })}

                      {placeSuggestions.length > suggestionLimit && (
                        <TouchableOpacity 
                          onPress={() => setSuggestionLimit(prev => prev + 4)}
                          style={{ padding: 12, alignItems: 'center', backgroundColor: '#e3f2fd', borderRadius: 8, marginTop: 4, marginBottom: 8 }}
                        >
                           <Text style={{ color: '#1565C0', fontWeight: 'bold' }}>Ver más resultados</Text>
                        </TouchableOpacity>
                      )}

                      {searchingPlaces && (
                        <View style={{ padding: 15, alignItems: 'center' }}>
                          <ActivityIndicator size="small" />
                          <Text style={{ color: '#888', marginTop: 6 }}>Buscando...</Text>
                        </View>
                      )}

                      {!searchingPlaces && placeSuggestions.length === 0 && searchQuery.length > 2 && (
                        <Text style={{ color: '#888', textAlign: 'center', padding: 12, fontSize: 13 }}>
                          Sin resultados. Intenta con otro término.
                        </Text>
                      )}
                    </View>
                  )}

                  {!(actionEntity.is_confirmed === 1 && actionEntity.height >= 2 && actionEntity.direct_mem_count === 0) && (
                    <TouchableOpacity
                      onPress={() => deleteEntity(actionEntity.id)}
                      style={{ paddingVertical: 8, alignItems: 'center' }}
                    >
                      <Text style={{ color: '#B00020', fontSize: 13 }}>Eliminar este lugar</Text>
                    </TouchableOpacity>
                  )}
                </ScrollView>

                {/* ── Fixed confirm button at absolute bottom ── */}
                <View style={{ padding: 15, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#eee', backgroundColor: 'white' }}>
                  {selectedPlace ? (
                    <Button
                      mode="contained"
                      onPress={confirmPlace}
                      icon="map-marker-check"
                      buttonColor="#4CAF50"
                    >
                      Guardar lugar seleccionado
                    </Button>
                  ) : targetGeoLevel === 0 ? (
                    <Button
                      mode="contained"
                      onPress={confirmPrecise}
                      icon="crosshairs-gps"
                    >
                      Guardar posición del marcador
                    </Button>
                  ) : (
                    <Button
                      mode="outlined"
                      icon="map-search"
                      onPress={() => {
                        if (confirmMode !== 'quick') {
                          setConfirmMode('quick');
                          searchPlaces(searchQuery);
                        }
                      }}
                    >
                      Selecciona una sugerencia arriba
                    </Button>
                  )}
                </View>
              </View>
            )}

            {panelType === 'memories' && memoryEntityId && (
              <EntityMemoriesView entityId={memoryEntityId} />
            )}
          </View>
        </View>
      )}
      </View>
      </KeyboardAvoidingView>
      
      {showParentAssign && actionEntity && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', zIndex: 100 }]}>
          <View style={{ backgroundColor: 'white', padding: 20, borderRadius: 10, width: '80%' }}>
            <Text style={{ fontWeight: 'bold', marginBottom: 10 }}>¿A qué territorio pertenece "{actionEntity.title}"?</Text>
            <SmartDropdown
              data={allLocations.filter(loc => loc.id !== actionEntity.id)}
              labelField="name"
              valueField="id"
              placeholder="Buscar territorio..."
              onSelect={(item: any) => { if (item) assignParentToAction(item.id); }}
            />
            <Button onPress={() => setShowParentAssign(false)} style={{ marginTop: 15 }}>Cancelar</Button>
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
  },
  clusterText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 12,
  },
});