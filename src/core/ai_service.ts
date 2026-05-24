// AI Service - Lee la API Key de AsyncStorage (configurada desde el Panel Admin)
import { getConfig } from './config';
import { EMOTIONS_DESCRIPTIONS } from './emotions';

export interface AICategorization {
  title: string;
  sentiment: number;
  time_markers: string[];
  entities: { name: string; type: 'PERSON' | 'LOCATION' | 'EVENT' | 'OBJECT' | 'TIME' | 'EMOTION'; parent_name?: string }[];
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

  const allowedEmotions = Object.keys(EMOTIONS_DESCRIPTIONS).join(', ');

  const systemPrompt = `Extract metadata from a personal memory into JSON.

KNOWN: [${existingEntitiesContext}]
ALLOWED_EMOTIONS: [${allowedEmotions}]

OUTPUT:
- time_markers: Extract all temporal references. Formats: "exact_year:YYYY", "exact_date:YYYY-MM-DD", "exact_age:N", "age_range:N-M", "relative_years:-N", "life_stage:childhood|teenage|adulthood", "fuzzy:TEXT". Prefer exact_age over life_stage.
  CRITICAL: Do not assume, guess, or invent a specific year, month, or day if there is no explicit certainty in the text. If the reference is vague or context-dependent, use "fuzzy:TEXT", "life_stage:childhood|teenage|adulthood", or map it to a KNOWN stage or sub-stage of type TIME under entities ONLY when there is sufficient evidence.
- entities: Extract all referenced PERSON, LOCATION, EVENT, OBJECT, TIME, EMOTION.
  RULES FOR ENTITIES:
  * EMOTION: Analyze the text and infer the user's emotional state. Extract one or more emotions strictly using ONLY the exact labels from ALLOWED_EMOTIONS.
  * LOCATION: Extract the FULL, exact name of the place (e.g., 'Iglesia de San Francisco' instead of 'San Francisco'). Never truncate a landmark, building, or specific place into a broad city or region name. Differentiate between landmarks and cities.
  * PERSON: Extract exhaustively ALL people mentioned. Crucially, split group references into distinct individual entities (e.g. 'mis abuelos' -> 'abuelo' and 'abuela', 'mis padres' -> 'padre' and 'madre'). Do not omit anyone.
  * TIME: Use descriptive time periods (e.g., "Navidad de 1998"). If a life stage or time reference matches a KNOWN entity conceptually—including macro-stages, custom stages, or nested sub-stages (e.g. "mi adolescencia" -> "Adolescencia", "en el colegio" -> "Colegio", "primer año de universidad" -> "Primer Año")—map it strictly to the KNOWN name to inherit custom periods. CRITICAL: Only assign a stage or sub-stage if there is SUFFICIENT certainty and evidence in the text. Do not guess.
  * GENERAL: If a reference conceptually matches a KNOWN entity, return the KNOWN name. Do not inject unreferenced KNOWN entities.
- parent_name: Infer and set parent locations based on textual containment. If uncertain, add "ENTITY_AMBIGUOUS" to ambiguities.
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
