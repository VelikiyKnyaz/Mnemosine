// AI Service - Lee la API Key de AsyncStorage (configurada desde el Panel Admin)
import { getConfig } from './config';

export interface AICategorization {
  title: string;
  sentiment: number;
  time_markers: string[];
  entities: { name: string; type: 'PERSON' | 'LOCATION' | 'EVENT' | 'OBJECT'; parent_name?: string }[];
  ambiguities: string[];
}

export const transcribeAudio = async (audioUri: string): Promise<string> => {
  const apiKey = await getConfig('OPENAI_API_KEY');
  if (!apiKey) throw new Error('API Key no configurada. Ve al Panel Admin para ingresarla.');

  try {
    const formData = new FormData();
    formData.append('file', {
      uri: audioUri,
      name: 'recording.m4a',
      type: 'audio/m4a',
    } as any);
    formData.append('model', 'whisper-1');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Whisper API error: ${errText}`);
    }

    const data = await response.json();
    return data.text;
  } catch (error) {
    console.error('Transcription failed:', error);
    throw error;
  }
};

export const extractMemoryData = async (text: string, existingEntitiesContext: string = ''): Promise<AICategorization> => {
  const apiKey = await getConfig('OPENAI_API_KEY');
  if (!apiKey) throw new Error('API Key no configurada. Ve al Panel Admin para ingresarla.');

  const systemPrompt = `Extract memory metadata into JSON.

KNOWN ENTITIES: [${existingEntitiesContext}]

RULES:
1. time_markers: array of strings. Formats: "exact_year:YYYY", "exact_date:YYYY-MM-DD", "exact_age:N", "age_range:N-M", "relative_years:-N", "life_stage:STAGE", "fuzzy:TEXT". If none, output [] and add "DATE_UNCLEAR" to ambiguities.
2. entities: Extract ONLY explicitly mentioned PERSON, LOCATION, EVENT, OBJECT.
   - MUST STANDARDIZE: If text uses a generic term (e.g. "university") that clearly refers to a KNOWN ENTITY, output the exact KNOWN ENTITY name.
   - FATAL ERROR: NEVER extract or inject entities that are not explicitly mentioned in the text.
3. parent_name: If a LOCATION explicitly belongs to another in text, specify it. If ambiguous, add "ENTITY_AMBIGUOUS" to ambiguities.
4. sentiment: Float -1.0 to 1.0.
5. title: Max 5 words.

JSON FORMAT:
{
  "title": "",
  "sentiment": 0.0,
  "time_markers": [],
  "entities": [{ "name": "Name", "type": "LOCATION", "parent_name": null }],
  "ambiguities": []
}
  `.trim();

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`GPT API error: ${errText}`);
    }

    const data = await response.json();
    const resultContent = data.choices[0].message.content;
    return JSON.parse(resultContent) as AICategorization;
  } catch (error) {
    console.error('Extraction failed:', error);
    throw error;
  }
};
