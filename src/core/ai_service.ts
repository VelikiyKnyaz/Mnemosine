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

export interface MemorySegment {
  text: string;
  inherited_time: string | null;
  inherited_location: string | null;
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

export const extractMemoryData = async (
  text: string,
  existingEntitiesContext: string = '',
  timeContext: string = '',
  spaceContext: string = ''
): Promise<AICategorization> => {
  const apiKey = await getConfig('OPENAI_API_KEY');
  if (!apiKey) throw new Error('API Key no configurada. Ve al Panel Admin para ingresarla.');

  const allowedEmotions = Object.keys(EMOTIONS_DESCRIPTIONS).join(', ');

  const systemPrompt = `Extract metadata from a personal memory into JSON.

KNOWN: [${existingEntitiesContext}]
ALLOWED_EMOTIONS: [${allowedEmotions}]
CONTEXT_TIME: [${timeContext}]
CONTEXT_LOCATION: [${spaceContext}]

OUTPUT:
- time_markers: Extract all temporal references. Formats: "exact_year:YYYY", "exact_month:YYYY-MM", "exact_date:YYYY-MM-DD", "exact_age:N", "age_range:N-M", "relative_years:-N", "life_stage:childhood|teenage|adulthood", "fuzzy:TEXT". Prefer exact_age over life_stage.
  CRITICAL: Do not assume, guess, or invent a specific year, month, or day if there is no explicit certainty in the text. If the reference is vague, relative (e.g., "luego", "más tarde", "ese día"), or context-dependent, use the CONTEXT_TIME provided to infer the date details if appropriate. If no certainty, use "fuzzy:TEXT" or map to a KNOWN stage under entities.
- entities: Extract all referenced PERSON, LOCATION, EVENT, OBJECT, TIME, EMOTION.
  RULES FOR ENTITIES:
  * EMOTION: Analyze the text and infer the user's emotional state. Extract one or more emotions strictly using ONLY the exact labels from ALLOWED_EMOTIONS.
  * LOCATION: Extract the specific physical places where the events took place. Crucially, under 'entities', return AT MOST one LOCATION entity unless the events literally happened in multiple entirely disconnected places in this fragment (e.g., 'fui al parque y luego a la biblioteca'). If a specific building, landmark, park, or establishment is mentioned alongside its city, state, or country (e.g., 'Museo del Louvre en París', 'hotel central en Roma'), do NOT extract the city, state, or country as separate LOCATION entities at all. Extract ONLY the specific place as a single LOCATION entity (e.g., 'Museo del Louvre', 'hotel central'), and specify the city or country name (e.g., 'París', 'Roma') strictly in its 'parent_name' property. NEVER extract parent cities, states, or countries as separate entities if they are just defining the location of a specific place. Crucially, any physical space, structure, building, establishment, room, landmark, city, country, or natural feature where events occur is a LOCATION. NEVER classify buildings, physical spaces, or establishments as OBJECT. Use CONTEXT_LOCATION to help resolve relative references (e.g., "allí", "en ese lugar") if needed.
  * OBJECT: Extract only physical, inanimate, transportable things that are NOT structures, buildings, or spaces (e.g., 'carro', 'regalo', 'carta', 'libro'). If a noun refers to a place or building where people can enter or be inside, it must be classified as LOCATION, not OBJECT.
  * PERSON: Extract exhaustively ALL people mentioned. Crucially, split group references into distinct individual entities (e.g. 'mis abuelos' -> 'abuelo' and 'abuela', 'mis padres' -> 'padre' and 'madre'). Do not omit anyone.
  * TIME: Use descriptive time periods (e.g., "Navidad de 1998"). If a life stage or time reference matches a KNOWN entity conceptually—including macro-stages, custom stages, or nested sub-stages (e.g. "mi adolescencia" -> "Adolescencia", "en el colegio" -> "Colegio", "primer año de universidad" -> "Primer Año")—map it strictly to the KNOWN name to inherit custom periods. CRITICAL: Only assign a stage or sub-stage if there is SUFFICIENT certainty and evidence in the text. Do not guess.
  * FOCUS & RELEVANCE: Only extract PERSON, LOCATION, EVENT, OBJECT, and TIME entities that are active parts of the memory being described. Do NOT extract entities that are mentioned purely as narrative connectors, passive comparisons, or references to other past/future memories (e.g., 'Después de visitar París el día anterior, hoy estuve en...' -> do NOT extract 'París' or 'el día anterior' as they are not part of the active memory being described; only extract entities belonging to the current focus).
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

export const segmentMemoryText = async (text: string): Promise<MemorySegment[]> => {
  const apiKey = await getConfig('OPENAI_API_KEY');
  if (!apiKey) throw new Error('API Key no configurada. Ve al Panel Admin para ingresarla.');

  const systemPrompt = `You are an AI editor for a memory journal application.
Analyze the provided journal text and segment/split it into distinct chronological fragments (memories) ONLY when there is a shift in location (place/space) or a change of day/date (time).

RULES:
1. If the text describes a continuous scene in the same location and time, do not split it.
2. If there are no space-time shifts, return a single segment.
3. Keep the core description of each segment, but CRUCIALLY: clean up and remove any leading or trailing narrative connectors, relative transitions, or references that link back to entities in preceding segments (e.g., phrases like 'Después de viajar a París, ', 'Como te contaba, ', 'Luego de lo de la playa, ', 'Al día siguiente fuimos al '). Replace or clean them so that the segment's text is self-contained and clean of prior segment entity clutter (e.g., 'Al día siguiente fuimos al museo de arte' -> 'Fuimos al museo de arte').
4. For each segment, identify if it should inherit any temporal (time) or spatial (location/place) context from preceding segments because this segment doesn't explicitly mention it but it is still in the same context/timeline (e.g., if segment 1 mentions a date like 'diciembre de 2024' and segment 2 describes subsequent events of that same timeline, it should inherit that time).
   - For 'inherited_time': You must output a structured time marker string in one of the formats: 'exact_year:YYYY', 'exact_month:YYYY-MM', 'exact_date:YYYY-MM-DD', 'exact_age:N', 'age_range:N-M', 'relative_years:-N', 'life_stage:childhood|teenage|adulthood', or 'fuzzy:TEXT'. Example: if it inherits 'diciembre de 2024', output 'exact_month:2024-12'. Use null if no temporal context is inherited.
   - For 'inherited_location': Output the name of the place/city/landmark that is inherited from preceding segments (e.g., if the preceding segment took place in a city like 'Roma' and this segment is in the same city and has no new location, set it to 'Roma'). Use null if none.
5. Return the result strictly in JSON format matching the schema:
{"segments": [{"text": "fragment text", "inherited_time": "time or null", "inherited_location": "location or null"}]}`.trim();

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
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`GPT API error during segmentation: ${errText}`);
    }

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content) as { segments: MemorySegment[] };
    return result.segments || [{ text, inherited_time: null, inherited_location: null }];
  } catch (error) {
    console.error('Segmentation failed:', error);
    return [{ text, inherited_time: null, inherited_location: null }];
  }
};
