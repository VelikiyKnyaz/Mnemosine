import { getDb } from './database';
import { transcribeAudio, extractMemoryData } from './ai_service';
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

        // 4. Update Memory table
        await db.runAsync(
          "UPDATE memories SET raw_text = ?, fuzzy_date = ?, sentiment_score = ?, sync_status = 'PROCESSED_LOCAL' WHERE id = ?",
          textToProcess.trim(), aiData.fuzzy_date, aiData.sentiment, memory.id
        );

        // 5. Hydrate Entities
        for (const entity of aiData.entities) {
          // Check if entity already exists by name and type
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

          // Link entity to memory
          const pivotId = uuidv4();
          await db.runAsync(
            "INSERT INTO memory_entities (id, memory_id, entity_id, relationship_type) VALUES (?, ?, ?, ?)",
            pivotId, memory.id, entityId, 'MENTIONED'
          );
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
