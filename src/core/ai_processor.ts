import { getDb, inheritCoordinatesFromParent } from './database';
import { transcribeAudio, extractMemoryData } from './ai_service';
import { calculateDatesFromMarkers } from './chrono_engine';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

// Helper: buscar coordenadas en Nominatim
export const geocodeLocation = async (name: string, hometownContext: string): Promise<{lat: number, lon: number, address?: any} | null> => {
  try {
    const query = encodeURIComponent(`${name}${hometownContext}`);
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&addressdetails=1`, {
      headers: { 'User-Agent': 'MnemosineApp/1.0 (memory@app.com)' }
    });
    const data = await res.json();
    if (data && data.length > 0) {
      const result = data[0];
      const importance = parseFloat(result.importance || '0');
      const resultName = result.display_name.toLowerCase();
      const hometownStr = hometownContext.replace(', ', '').trim().toLowerCase();
      
      // Si usamos contexto de ciudad, verificar que Nominatim no nos haya mandado
      // a otro país o ciudad por ser un término muy genérico.
      if (hometownStr && !resultName.includes(hometownStr)) {
        console.log(`Geocoding rejected: "${resultName}" no está en "${hometownStr}"`);
        return null;
      }
      
      // Filtro de confianza eliminado: Nominatim le da importancia muy baja a lugares locales (ej. Unicentro).
      // Nos basamos únicamente en el filtro de ciudad (hometownStr).

      return { lat: parseFloat(result.lat), lon: parseFloat(result.lon), address: result.address };
    }
  } catch (e) {
    console.log('Geocoding failed for:', name);
  }
  return null;
};

async function getOrCreateTerritory(db: any, name: string, lat: number, lon: number, level: 'city'|'state'|'country'): Promise<string> {
   const existing = await db.getFirstAsync<{id: string}>("SELECT id FROM entities WHERE type = 'LOCATION' AND name = ? COLLATE NOCASE", name);
   if (existing) return existing.id;
   const newId = uuidv4();
   
   const jitterMag = level === 'country' ? 2 : level === 'state' ? 0.5 : 0.05;
   const jLat = lat + (Math.random() - 0.5) * jitterMag;
   const jLon = lon + (Math.random() - 0.5) * jitterMag;

   await db.runAsync("INSERT INTO entities (id, type, name, latitude, longitude, is_confirmed) VALUES (?, 'LOCATION', ?, ?, ?, 1)", newId, name, jLat, jLon);
   return newId;
}

export const processPendingMemories = async () => {
  try {
    const db = await getDb();
    
    // Fetch hometown context once
    const userProfile = await db.getFirstAsync<{hometown: string | null}>('SELECT hometown FROM user_profile LIMIT 1');
    const hometownContext = userProfile?.hometown ? `, ${userProfile.hometown}` : '';

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
        const aiData = await extractMemoryData(textToProcess);

        // 4. Calcular Fechas Algorítmicas
        const dates = await calculateDatesFromMarkers(aiData.time_markers || []);

        // 5. Update Memory table
        await db.runAsync(
          "UPDATE memories SET raw_text = ?, start_date = ?, end_date = ?, sentiment_score = ?, sync_status = 'PROCESSED_LOCAL' WHERE id = ?",
          textToProcess.trim(), dates.start_date, dates.end_date, aiData.sentiment, memory.id
        );

        // 6. Hydrate Entities with Hierarchies and Geocoding
        const entityIdMap: Record<string, string> = {}; 
        let geocodedLocations = 0;
        
        for (const entity of aiData.entities) {
          const existingEntity = await db.getFirstAsync<{id: string, latitude: number | null}>(
            "SELECT id, latitude FROM entities WHERE name = ? AND type = ?",
            entity.name, entity.type
          );

          let entityId = existingEntity?.id;

          if (entity.type === 'LOCATION') {
            // Geocodify: si es nueva O si ya existe pero sin coordenadas
            const needsGeocode = !entityId || (existingEntity && existingEntity.latitude === null);
            
            if (needsGeocode) {
              let coords = await geocodeLocation(entity.name, hometownContext);
              
              // Fallback a la ciudad base si falla la busqueda especifica
              if (!coords && hometownContext) {
                 const fallbackContext = hometownContext.replace(', ', '').trim();
                 if (fallbackContext) {
                    coords = await geocodeLocation(fallbackContext, '');
                 }
              }

              if (coords) {
                geocodedLocations++;
                if (entityId) {
                  await db.runAsync(
                    "UPDATE entities SET latitude = ?, longitude = ?, is_confirmed = 0 WHERE id = ?",
                    coords.lat, coords.lon, entityId
                  );
                } else {
                  entityId = uuidv4();
                  await db.runAsync(
                    "INSERT INTO entities (id, type, name, latitude, longitude, is_confirmed) VALUES (?, ?, ?, ?, ?, 0)",
                    entityId, entity.type, entity.name, coords.lat, coords.lon
                  );
                }

                // Generar Jerarquía Territorial
                if (coords.address) {
                  const { city, town, village, municipality, state, country } = coords.address;
                  const cityName = city || town || village || municipality;
                  const stateName = state;
                  const countryName = country;

                  let currentChildId = entityId;
                  let currentChildName = entity.name.toLowerCase();

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
                  }
                }
              } else if (!entityId) {
                entityId = uuidv4();
                await db.runAsync(
                  "INSERT INTO entities (id, type, name) VALUES (?, ?, ?)",
                  entityId, entity.type, entity.name
                );
              }
            }
          } else if (!entityId) {
            // PERSON, EVENT, OBJECT: crear sin coords
            entityId = uuidv4();
            await db.runAsync(
              "INSERT INTO entities (id, type, name) VALUES (?, ?, ?)",
              entityId, entity.type, entity.name
            );
          }
          
          entityIdMap[entity.name] = entityId!;

          // Link entity to memory
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
            "UPDATE entities SET latitude = ?, longitude = ? WHERE id = ?",
            coords.lat, coords.lon, loc.id
          );
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

