import React, { useState, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Appbar, Text } from 'react-native-paper';
import MapView, { Marker } from 'react-native-maps';
import { getDb } from '../../core/database';
import { useIsFocused } from '@react-navigation/native';

// Mock Geocoder for Prototype
const mockGeocode = (locationName: string) => {
  // Simple hash to generate consistent pseudo-random coordinates near a central point (e.g. Madrid)
  let hash = 0;
  for (let i = 0; i < locationName.length; i++) {
    hash = locationName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const latOffset = (hash % 100) / 1000;
  const lonOffset = ((hash >> 2) % 100) / 1000;

  return {
    latitude: 40.4168 + latOffset,
    longitude: -3.7038 + lonOffset,
  };
};

export default function AtlasScreen() {
  const [markers, setMarkers] = useState<any[]>([]);
  const isFocused = useIsFocused();

  const loadLocations = async () => {
    try {
      const db = await getDb();
      const rows = await db.getAllAsync(`
        SELECT e.name, m.title, m.raw_text
        FROM entities e
        JOIN memory_entities me ON e.id = me.entity_id
        JOIN memories m ON me.memory_id = m.id
        WHERE e.type = 'LOCATION'
      `);
      
      const newMarkers = rows.map((row: any, index: number) => {
        const coords = mockGeocode(row.name);
        return {
          id: index.toString(),
          title: row.name,
          description: row.title || 'Recuerdo en este lugar',
          coordinate: coords,
        };
      });

      setMarkers(newMarkers);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (isFocused) {
      loadLocations();
    }
  }, [isFocused]);

  return (
    <View style={styles.container}>
      <Appbar.Header>
        <Appbar.Content title="Atlas de Vida" />
      </Appbar.Header>
      
      <MapView
        style={styles.map}
        initialRegion={{
          latitude: 40.4168,
          longitude: -3.7038,
          latitudeDelta: 0.5,
          longitudeDelta: 0.5,
        }}
      >
        {markers.map(marker => (
          <Marker
            key={marker.id}
            coordinate={marker.coordinate}
            title={marker.title}
            description={marker.description}
          />
        ))}
      </MapView>

      {markers.length === 0 && (
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>
            La IA aún no ha detectado ubicaciones en tus recuerdos.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(255,255,255,0.9)',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  overlayText: {
    textAlign: 'center',
    color: '#666',
  }
});
