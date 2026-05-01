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

  const systemPrompt = `Extract metadata from a personal memory into JSON.

KNOWN: [${existingEntitiesContext}]

OUTPUT:
- time_markers: Extract all temporal references. Formats: "exact_year:YYYY", "exact_date:YYYY-MM-DD", "exact_age:N", "age_range:N-M", "relative_years:-N", "life_stage:childhood|teenage|adulthood", "fuzzy:TEXT". Prefer exact_age over life_stage. Add "DATE_UNCLEAR" to ambiguities only if no temporal information exists.
- entities: Extract all referenced PERSON, LOCATION, EVENT, OBJECT. If a reference matches a KNOWN entity, return the KNOWN name. Do not inject unreferenced KNOWN entities.
- parent_name: Set when text indicates containment. If uncertain, add "ENTITY_AMBIGUOUS" to ambiguities.
- sentiment: Float from -1.0 to 1.0.
- title: Max 5 words.

{"title":"","sentiment":0,"time_markers":[],"entities":[{"name":"","type":"","parent_name":null}],"ambiguities":[]}
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
