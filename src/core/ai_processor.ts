import { getDb, inheritCoordinatesFromParent } from './database';
import { transcribeAudio, extractMemoryData } from './ai_service';
import { calculateDatesFromMarkers } from './chrono_engine';
import { getConfig } from './config';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

// Helper: buscar coordenadas con Google Places API (Text Search)
export const geocodeLocation = async (name: string, hometownContext: string): Promise<{lat: number, lon: number, address?: any} | null> => {
  try {
    const apiKey = await getConfig('GOOGLE_MAPS_KEY');
    if (!apiKey) {
      console.log('Google Maps API Key not configured, skipping geocoding');
      return null;
    }

    // 1. First try: global clean search
    const globalRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.displayName,places.location,places.addressComponents',
      },
      body: JSON.stringify({ textQuery: name, maxResultCount: 1 }),
    });

    let data = await globalRes.json();
    let places = data.places || [];

    // 2. Fallback: if no results, try with hometown context
    if (places.length === 0 && hometownContext) {
      const textQuery = `${name}${hometownContext}`;
      const fallbackRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.displayName,places.location,places.addressComponents',
        },
        body: JSON.stringify({ textQuery, maxResultCount: 1 }),
      });
      data = await fallbackRes.json();
      places = data.places || [];
    }

    if (places.length > 0) {
      const place = places[0];
      const lat = place.location?.latitude;
      const lon = place.location?.longitude;
      if (lat == null || lon == null) return null;

      // Map addressComponents to flat format for generateTerritorialHierarchy
      const components = place.addressComponents || [];
      const getComponent = (type: string) => components.find((c: any) => c.types?.includes(type))?.longText || '';
      const address = {
        city: getComponent('locality') || getComponent('administrative_area_level_2'),
        state: getComponent('administrative_area_level_1'),
        country: getComponent('country'),
      };

      return { 
        lat, lon, address, 
        placeData: {
           displayName: place.displayName,
           formattedAddress: place.formattedAddress,
           types: place.types,
           location: place.location
        }
      };
    }
  } catch (e) {
    console.log('Geocoding failed for:', name, e);
  }
  return null;
};

async function getOrCreateTerritory(db: any, name: string, lat: number, lon: number, level: 'city'|'state'|'country'): Promise<string> {
   const existing = await db.getFirstAsync<{id: string}>("SELECT id FROM entities WHERE type = 'LOCATION' AND name = ? COLLATE NOCASE", name);
   if (existing) {
     // Ensure geo_level is set even on existing territories
     const geoLevel = level === 'country' ? 4 : level === 'state' ? 3 : 2;
     await db.runAsync("UPDATE entities SET metadata = ? WHERE id = ?", JSON.stringify({ geo_level: geoLevel }), existing.id);
     return existing.id;
   }
   const newId = uuidv4();
   
   const jitterMag = level === 'country' ? 2 : level === 'state' ? 0.5 : 0.05;
   const jLat = lat + (Math.random() - 0.5) * jitterMag;
   const jLon = lon + (Math.random() - 0.5) * jitterMag;

   const geoLevel = level === 'country' ? 4 : level === 'state' ? 3 : 2;
   await db.runAsync("INSERT INTO entities (id, type, name, latitude, longitude, is_confirmed, metadata) VALUES (?, 'LOCATION', ?, ?, ?, 1, ?)", newId, name, jLat, jLon, JSON.stringify({ geo_level: geoLevel }));
   return newId;
}

export async function generateTerritorialHierarchy(db: any, entityId: string, entityName: string, coords: any) {
  if (!coords || !coords.address) return;
  const addr = coords.address;
  
  let rawCity = addr.city || addr.town || addr.village || addr.municipality || '';
  rawCity = rawCity.replace(/^(Perímetro Urbano|Municipio de|Ciudad de)\s*/i, '').trim();
  const cityName = rawCity || null;
  
  let rawState = addr.state || '';
  rawState = rawState.replace(/^(Departamento de|Provincia de|Estado de)\s*/i, '').trim();
  const stateName = rawState || null;
  
  const countryName = addr.country || null;
  const continentName = addr.continent || null;

  let currentChildId = entityId;
  let currentChildName = entityName.toLowerCase();

  // Check if the entity itself is the territory
  let isTerritory = false;
  if (cityName && currentChildName === cityName.toLowerCase()) {
     await db.runAsync("UPDATE entities SET metadata = json_set(COALESCE(metadata, '{}'), '$.geo_level', 2) WHERE id = ?", currentChildId);
     isTerritory = true;
  } else if (stateName && currentChildName === stateName.toLowerCase()) {
     await db.runAsync("UPDATE entities SET metadata = json_set(COALESCE(metadata, '{}'), '$.geo_level', 3) WHERE id = ?", currentChildId);
     isTerritory = true;
  } else if (countryName && currentChildName === countryName.toLowerCase()) {
     await db.runAsync("UPDATE entities SET metadata = json_set(COALESCE(metadata, '{}'), '$.geo_level', 4) WHERE id = ?", currentChildId);
     isTerritory = true;
  }

  // Only assign parents if it's not the territory itself or if we are building the hierarchy above it
  if (cityName && currentChildName !== cityName.toLowerCase()) {
     let cityId = await getOrCreateTerritory(db, cityName, coords.lat, coords.lon, 'city');
     await db.runAsync("UPDATE entities SET parent_id = ? WHERE id = ?", cityId, currentChildId);
     currentChildId = cityId;
     currentChildName = cityName.toLowerCase();
  }
  
  if (stateName && currentChildName !== stateName.toLowerCase()) {
     let stateId = await getOrCreateTerritory(db, stateName, coords.lat, coords.lon, 'state');
     await db.runAsync("UPDATE entities SET parent_id = ? WHERE id = ?", stateId, currentChildId);
     currentChildId = stateId;
     currentChildName = stateName.toLowerCase();
  }

  if (countryName && currentChildName !== countryName.toLowerCase()) {
     let countryId = await getOrCreateTerritory(db, countryName, coords.lat, coords.lon, 'country');
     await db.runAsync("UPDATE entities SET parent_id = ? WHERE id = ?", countryId, currentChildId);
     currentChildId = countryId;
     currentChildName = countryName.toLowerCase();
  }
  
  if (continentName && currentChildName !== continentName.toLowerCase()) {
     let continentId = await getOrCreateTerritory(db, continentName, coords.lat, coords.lon, 'country'); // Use country level jitter for continent
     await db.runAsync("UPDATE entities SET parent_id = ? WHERE id = ?", continentId, currentChildId);
  }
}

export const processPendingMemories = async () => {
  try {
    const db = await getDb();
    
    // Fetch hometown and country context once
    const userProfile = await db.getFirstAsync<{hometown: string | null, country: string | null}>('SELECT hometown, country FROM user_profile LIMIT 1');
    const hometownContext = [userProfile?.hometown, userProfile?.country].filter(Boolean).join(', ') ? `, ${[userProfile?.hometown, userProfile?.country].filter(Boolean).join(', ')}` : '';

    // 1. Fetch pending memories
    const pendingMemories = await db.getAllAsync<{id: string, raw_text: string | null, audio_uri: string | null}>(
      "SELECT id, raw_text, audio_uri FROM memories WHERE sync_status = 'PENDING_AI'"
    );

    for (const memory of pendingMemories) {
      let textToProcess = memory.raw_text || '';

      try {
        // 2. Transcribe audio if needed
        if (memory.audio_uri && (!textToProcess || textToProcess.trim() === '')) {
          console.log(`Transcribing audio for memory ${memory.id}`);
          const transcription = await transcribeAudio(memory.audio_uri);
          textToProcess += `\n${transcription}`;
        }

        // 3. Extract JSON using GPT
        if (!textToProcess.trim()) {
          console.log('Skipping empty memory');
          await db.runAsync("UPDATE memories SET sync_status = 'PROCESSED_LOCAL' WHERE id = ?", memory.id);
          continue;
        }

        console.log(`Extracting data for memory ${memory.id}`);
        // Fetch top 50 existing entity names for context to prevent LLM token explosion
        const existingEntities = await db.getAllAsync<{name: string}>(`
          SELECT e.name 
          FROM entities e 
          LEFT JOIN memory_entities me ON e.id = me.entity_id 
          GROUP BY e.id 
          ORDER BY COUNT(me.memory_id) DESC 
          LIMIT 50
        `);
        const existingNamesStr = existingEntities.map(e => e.name).join(', ');

        const aiData = await extractMemoryData(textToProcess, existingNamesStr);


        // 4. Calcular Fechas Algorítmicas
        const dates = await calculateDatesFromMarkers(aiData.time_markers || []);

        // 5. Update Memory table
        await db.runAsync(
          "UPDATE memories SET raw_text = ?, start_date = ?, end_date = ?, sentiment_score = ?, sync_status = 'PROCESSED_LOCAL' WHERE id = ?",
          textToProcess.trim(), dates.start_date, dates.end_date, aiData.sentiment, memory.id
        );

        // 6. Hydrate Entities (LOCATIONs created without coords, confirmed in Atlas)
        const entityIdMap: Record<string, string> = {};
        
        for (const entity of aiData.entities) {
          // Resolve via alias first (deterministic local resolution)
          const aliasMatch = await db.getFirstAsync<{entity_id: string}>(
            "SELECT entity_id FROM entity_aliases WHERE alias = ? COLLATE NOCASE",
            entity.name
          );

          const existingEntity = aliasMatch
            ? await db.getFirstAsync<{id: string, latitude: number | null}>(
                "SELECT id, latitude FROM entities WHERE id = ?", aliasMatch.entity_id
              )
            : await db.getFirstAsync<{id: string, latitude: number | null}>(
                "SELECT id, latitude FROM entities WHERE name = ? AND type = ?",
                entity.name, entity.type
              );

          let entityId = existingEntity?.id;

          if (!entityId) {
            // Create new entity without coordinates (LOCATION will be confirmed manually in Atlas)
            entityId = uuidv4();
            await db.runAsync(
              "INSERT INTO entities (id, type, name, is_confirmed) VALUES (?, ?, ?, 0)",
              entityId, entity.type, entity.name
            );
          }
          
          entityIdMap[entity.name] = entityId!;
        }

        for (const entity of aiData.entities) {
          const entityId = entityIdMap[entity.name];
          const pivotId = uuidv4();
          await db.runAsync(
            "INSERT INTO memory_entities (id, memory_id, entity_id, relationship_type) VALUES (?, ?, ?, ?)",
            pivotId, memory.id, entityId, 'MENTIONED'
          );
        }

        // 6B: Establecer relaciones Padre-Hijo
        for (const entity of aiData.entities) {
          if (entity.parent_name && entityIdMap[entity.parent_name] && entityIdMap[entity.name]) {
            const parentId = entityIdMap[entity.parent_name];
            const childId = entityIdMap[entity.name];
            await db.runAsync(
              "UPDATE entities SET parent_id = ? WHERE id = ?",
              parentId, childId
            );
            // Heredar coordenadas con jitter si es LOCATION
            if (entity.type === 'LOCATION') {
              await inheritCoordinatesFromParent(childId, parentId);
            }
          }
        }

        // 7. Generar Inbox Tasks — incluyendo detección proactiva
        const ambiguities = [...(aiData.ambiguities || [])];
        
        // Detección proactiva: si no hay fechas calculadas, forzar DATE_UNCLEAR
        if (!dates.start_date && !dates.end_date && !ambiguities.includes('DATE_UNCLEAR')) {
          ambiguities.push('DATE_UNCLEAR');
        }

        if (ambiguities.length > 0) {
          // Remover duplicados si AI devolvió multiples
          const uniqueAmbs = Array.from(new Set(ambiguities));
          for (const amb of uniqueAmbs) {
            // Ignorar ambigüedades geográficas porque ahora todo se resuelve en el Atlas
            if (amb === 'ENTITY_AMBIGUOUS' || amb === 'LOCATION_UNCLEAR' || amb === 'MEMORY_LOCATION_UNCLEAR') continue;

            let question = 'Por favor aclara este detalle.';
            if (amb === 'DATE_UNCLEAR') question = '¿Cuándo ocurrió esto? Puedes indicar un año, una edad o una fecha aproximada.';
            
            await db.runAsync(
              "INSERT INTO inbox_tasks (id, memory_id, ambiguity_type, question) VALUES (?, ?, ?, ?)",
              uuidv4(), memory.id, amb, question
            );
          }
        }

        console.log(`Memory ${memory.id} processed successfully.`);

      } catch (innerError) {
        console.error(`Failed to process memory ${memory.id}:`, innerError);
      }
    }

    // 8. Post-procesamiento: geocodificar entidades LOCATION antiguas sin coordenadas
    try {
      const ungeocoded = await db.getAllAsync<{id: string, name: string}>(
        "SELECT id, name FROM entities WHERE type = 'LOCATION' AND latitude IS NULL"
      );
      for (const loc of ungeocoded) {
        const coords = await geocodeLocation(loc.name, hometownContext);
        if (coords) {
          await db.runAsync(
            "UPDATE entities SET latitude = ?, longitude = ?, metadata = json_set(COALESCE(metadata, '{}'), '$.original_ai_place', json(?)) WHERE id = ?",
            coords.lat, coords.lon, JSON.stringify(coords.placeData), loc.id
          );
          await generateTerritorialHierarchy(db, loc.id, loc.name, coords);
          console.log(`Geocoded old location: ${loc.name}`);
        }
      }
    } catch (e) {
      console.log('Post-geocoding pass error:', e);
    }

  } catch (err) {
    console.error('Error in processPendingMemories:', err);
  }
};

