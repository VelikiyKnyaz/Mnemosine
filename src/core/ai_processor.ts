import { getDb, inheritCoordinatesFromParent } from './database';
import { transcribeAudio, extractMemoryData, segmentMemoryText } from './ai_service';
import { EMOTIONS_DESCRIPTIONS } from './emotions';
import { calculateDatesFromMarkers, generateLifecycleStages } from './chrono_engine';
import { getConfig } from './config';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

const normalizeString = (str: string): string => {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
};

const hasWordMatch = (normalizedText: string, searchWord: string): boolean => {
  if (!searchWord) return false;
  const normalizedSearchWord = normalizeString(searchWord);
  if (normalizedSearchWord.length === 0) return false;
  
  // Escape regex special chars
  const escapedWord = normalizedSearchWord.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const regex = new RegExp(`\\b${escapedWord}\\b`, 'i');
  return regex.test(normalizedText);
};

// Helper: buscar coordenadas con Google Places API (Text Search)
export const geocodeLocation = async (name: string, hometownContext: string): Promise<{lat: number, lon: number, address?: any, placeData?: any} | null> => {
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
   const existing = await db.getFirstAsync("SELECT id FROM entities WHERE type = 'LOCATION' AND name = ? COLLATE NOCASE", name) as {id: string} | null;
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
    
    // Fetch profile context once (including birth date)
    const userProfile = await db.getFirstAsync('SELECT hometown, country, birth_date FROM user_profile LIMIT 1') as {hometown: string | null, country: string | null, birth_date: string | null} | null;
    const hometownContext = [userProfile?.hometown, userProfile?.country].filter(Boolean).join(', ') ? `, ${[userProfile?.hometown, userProfile?.country].filter(Boolean).join(', ')}` : '';

    // Proactively generate/update biological stages based on birth year and current time
    if (userProfile?.birth_date) {
      const birthYear = parseInt(userProfile.birth_date.split('-')[0]);
      if (!isNaN(birthYear)) {
        await generateLifecycleStages(birthYear);
      }
    }

    // 1. Fetch and process pending memories one by one
    while (true) {
      const memory = await db.getFirstAsync(
        "SELECT id, raw_text, audio_uri, created_at, time_context, space_context FROM memories WHERE sync_status = 'PENDING_AI' LIMIT 1"
      ) as {id: string, raw_text: string | null, audio_uri: string | null, created_at: number, time_context: string | null, space_context: string | null} | null;

      if (!memory) {
        break;
      }

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

        // Segment the text into space-time fragments if it mentions shifts in space or time
        console.log(`Segmenting text for memory ${memory.id}`);
        const segments = await segmentMemoryText(textToProcess);
        if (segments && segments.length > 1) {
          console.log(`Memory ${memory.id} split into ${segments.length} fragments.`);
          // Update current memory raw_text to be only the first fragment's text
          textToProcess = segments[0].text;
          
          // Insert the remaining fragments as new memories in the database, carrying over inherited contexts
          for (let i = 1; i < segments.length; i++) {
            const newId = uuidv4();
            await db.runAsync(
              "INSERT INTO memories (id, raw_text, sync_status, created_at, time_context, space_context) VALUES (?, ?, 'PENDING_AI', ?, ?, ?)",
              newId, segments[i].text.trim(), memory.created_at, segments[i].inherited_time, segments[i].inherited_location
            );
          }
        }

        console.log(`Extracting data for memory ${memory.id}`);
        // Local filtering: Fetch all TIME entities and filter them in JS to avoid token explosion
        const allTimeEntities = await db.getAllAsync("SELECT id, name FROM entities WHERE type = 'TIME'") as {id: string, name: string}[];
        const allTimeAliases = await db.getAllAsync(`
          SELECT ta.alias, e.name 
          FROM entity_aliases ta 
          JOIN entities e ON ta.entity_id = e.id 
          WHERE e.type = 'TIME'
        `) as {alias: string, name: string}[];

        const normalizedText = normalizeString(textToProcess);
        const matchingTimeNames = new Set<string>();

        for (const te of allTimeEntities) {
          if (hasWordMatch(normalizedText, te.name)) {
            matchingTimeNames.add(te.name);
          }
        }
        for (const ta of allTimeAliases) {
          if (hasWordMatch(normalizedText, ta.alias)) {
            matchingTimeNames.add(ta.name);
          }
        }

        const matchingTimeEntitiesList = Array.from(matchingTimeNames).map(name => ({ name }));
        
        // Fetch top 50 other existing entity names to prevent token explosion
        const existingEntities = await db.getAllAsync(`
          SELECT e.name 
          FROM entities e 
          LEFT JOIN memory_entities me ON e.id = me.entity_id 
          WHERE e.type != 'TIME'
          GROUP BY e.id 
          ORDER BY COUNT(me.memory_id) DESC 
          LIMIT 50
        `) as {name: string}[];
        
        const allContextEntities = [...matchingTimeEntitiesList, ...existingEntities];
        const existingNamesStr = allContextEntities.map(e => e.name).join(', ');

        const aiData = await extractMemoryData(textToProcess, existingNamesStr, memory.time_context || '', memory.space_context || '');


        // 4. Calcular Fechas Algorítmicas
        let dates = await calculateDatesFromMarkers(aiData.time_markers || []);

        // Fallback 1: Si no se extrajeron fechas pero hay un time_context heredado del fragmentador, usarlo
        if (!dates.start_date && !dates.end_date && memory.time_context) {
          console.log(`No dates extracted for memory ${memory.id}, inheriting from time_context: ${memory.time_context}`);
          dates = await calculateDatesFromMarkers([memory.time_context]);
        }

        // Fallback 2: Si no se determinaron fechas específicas, verificar si se extrajo una etapa biológica o personalizada (entidades de tipo TIME)
        if (!dates.start_date && !dates.end_date && aiData.entities) {
          const timeEntities = aiData.entities.filter(e => e.type === 'TIME');
          for (const te of timeEntities) {
            const aliasMatch = await db.getFirstAsync(
              "SELECT entity_id FROM entity_aliases WHERE alias = ? COLLATE NOCASE",
              te.name
            ) as {entity_id: string} | null;
            const existingEntity = aliasMatch
              ? await db.getFirstAsync(
                  "SELECT metadata FROM entities WHERE id = ?", aliasMatch.entity_id
                ) as {metadata: string | null} | null
              : await db.getFirstAsync(
                  "SELECT metadata FROM entities WHERE name = ? AND type = 'TIME' COLLATE NOCASE",
                  te.name
                ) as {metadata: string | null} | null;
            if (existingEntity?.metadata) {
              try {
                const meta = JSON.parse(existingEntity.metadata);
                if (meta.start_date && meta.end_date) {
                  dates.start_date = meta.start_date;
                  dates.end_date = meta.end_date;
                  break; // Usar el primer rango de fechas válido de la etapa
                }
              } catch (e) {
                console.warn('Error parsing metadata for TIME entity:', te.name, e);
              }
            }
          }
        }

        // 5. Update Memory table
        await db.runAsync(
          "UPDATE memories SET raw_text = ?, start_date = ?, end_date = ?, sentiment_score = ?, sync_status = 'PROCESSED_LOCAL' WHERE id = ?",
          textToProcess.trim(), dates.start_date, dates.end_date, aiData.sentiment, memory.id
        );

        // Filtrar y validar EMOTIONs para que sólo contengan emociones de EMOTIONS_DESCRIPTIONS (evitando alucinaciones de la IA)
        const validEmotionsKeys = Object.keys(EMOTIONS_DESCRIPTIONS);
        const emotionsMapLower = new Map<string, string>();
        for (const key of validEmotionsKeys) {
          emotionsMapLower.set(key.toLowerCase(), key);
        }

        if (aiData.entities) {
          aiData.entities = aiData.entities.filter(entity => {
            if (entity.type === 'EMOTION') {
              const matchedKey = emotionsMapLower.get(entity.name.trim().toLowerCase());
              if (matchedKey) {
                entity.name = matchedKey; // Corregir casing (ej: "tristeza" -> "Tristeza")
                return true;
              }
              console.warn(`Filtering out invalid emotion extracted by AI: ${entity.name}`);
              return false;
            }
            return true;
          });

          // Fallback de Ubicación: si no se extrajo ninguna ubicación pero hay un space_context heredado, lo inyectamos
          const hasLocation = aiData.entities.some(e => e.type === 'LOCATION');
          if (!hasLocation && memory.space_context) {
            console.log(`No location extracted for memory ${memory.id}, inheriting from space_context: ${memory.space_context}`);
            aiData.entities.push({
              name: memory.space_context,
              type: 'LOCATION'
            });
          }
        }

        // 6. Hydrate Entities (LOCATIONs created without coords, confirmed in Atlas)
        const entityIdMap: Record<string, string> = {};
        
        for (const entity of aiData.entities) {
          // Resolve via alias first (deterministic local resolution)
          const aliasMatch = await db.getFirstAsync(
            "SELECT entity_id FROM entity_aliases WHERE alias = ? COLLATE NOCASE",
            entity.name
          ) as {entity_id: string} | null;

          const existingEntity = aliasMatch
            ? await db.getFirstAsync(
                "SELECT id, latitude FROM entities WHERE id = ?", aliasMatch.entity_id
              ) as {id: string, latitude: number | null} | null
            : await db.getFirstAsync(
                "SELECT id, latitude FROM entities WHERE name = ? AND type = ?",
                entity.name, entity.type
              ) as {id: string, latitude: number | null} | null;

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
        
        // Fechas ya no son obligatorias, no se genera DATE_UNCLEAR proactivamente.

        if (ambiguities.length > 0) {
          // Remover duplicados si AI devolvió multiples
          const uniqueAmbs = Array.from(new Set(ambiguities));
          for (const amb of uniqueAmbs) {
            // Ignorar ambigüedades geográficas porque ahora todo se resuelve en el Atlas
            if (amb === 'ENTITY_AMBIGUOUS' || amb === 'LOCATION_UNCLEAR' || amb === 'MEMORY_LOCATION_UNCLEAR') continue;

            let question = 'Por favor aclara este detalle.';
            
            await db.runAsync(
              "INSERT INTO inbox_tasks (id, memory_id, ambiguity_type, question) VALUES (?, ?, ?, ?)",
              uuidv4(), memory.id, amb, question
            );
          }
        }

        console.log(`Memory ${memory.id} processed successfully.`);

      } catch (innerError) {
        console.error(`Failed to process memory ${memory.id}:`, innerError);
        try {
          await db.runAsync("UPDATE memories SET sync_status = 'PROCESSED_LOCAL' WHERE id = ?", memory.id);
        } catch (dbErr) {
          console.error(`Failed to update status for broken memory ${memory.id}:`, dbErr);
          break;
        }
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

