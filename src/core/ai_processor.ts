import { getDb } from './database';
import { transcribeAudio, extractMemoryData } from './ai_service';
import { calculateDatesFromMarkers } from './chrono_engine';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

export const processPendingMemories = async () => {
  try {
    const db = await getDb();
    
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

        // 6. Hydrate Entities with Hierarchies
        const entityIdMap: Record<string, string> = {}; 
        
        // Fase 6A: Crear/Encontrar entidades
        for (const entity of aiData.entities) {
          const existingEntity = await db.getFirstAsync<{id: string}>(
            "SELECT id FROM entities WHERE name = ? AND type = ?",
            entity.name, entity.type
          );

          let entityId = existingEntity?.id;

          if (!entityId) {
            entityId = uuidv4();
            await db.runAsync(
              "INSERT INTO entities (id, type, name) VALUES (?, ?, ?)",
              entityId, entity.type, entity.name
            );
          }
          
          entityIdMap[entity.name] = entityId;

          // Link entity to memory
          const pivotId = uuidv4();
          await db.runAsync(
            "INSERT INTO memory_entities (id, memory_id, entity_id, relationship_type) VALUES (?, ?, ?, ?)",
            pivotId, memory.id, entityId, 'MENTIONED'
          );
        }

        // Fase 6B: Establecer relaciones Padre-Hijo (Top-Down Global Hierarchy)
        for (const entity of aiData.entities) {
          if (entity.parent_name && entityIdMap[entity.parent_name] && entityIdMap[entity.name]) {
            await db.runAsync(
              "UPDATE entities SET parent_id = ? WHERE id = ?",
              entityIdMap[entity.parent_name], entityIdMap[entity.name]
            );
          }
        }

        // 7. Generar Inbox Tasks para Ambigüedades
        if (aiData.ambiguities && aiData.ambiguities.length > 0) {
          for (const amb of aiData.ambiguities) {
            let question = 'Por favor aclara este detalle.';
            if (amb === 'DATE_UNCLEAR') question = '¿Cuándo ocurrió exactamente esto?';
            if (amb === 'LOCATION_UNCLEAR') question = 'Mencionaste un lugar, pero no estoy seguro de dónde es. ¿Puedes ubicarlo en el mapa?';
            
            await db.runAsync(
              "INSERT INTO inbox_tasks (id, memory_id, ambiguity_type, question) VALUES (?, ?, ?, ?)",
              uuidv4(), memory.id, amb, question
            );
          }
        }

        console.log(`Memory ${memory.id} processed successfully.`);

      } catch (innerError) {
        console.error(`Failed to process memory ${memory.id}:`, innerError);
        // Leave it as PENDING_AI or mark as ERROR depending on logic
      }
    }
  } catch (err) {
    console.error('Error in processPendingMemories:', err);
  }
};
