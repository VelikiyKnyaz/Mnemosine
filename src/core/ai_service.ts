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
  * LOCATION: Extract the ONE specific physical place where the events of this fragment took place. Return AT MOST ONE LOCATION entity.
    - WHAT IS A LOCATION: Any physical space where people can be present: buildings (churches, hospitals, hotels, schools, houses), parks, plazas, stadiums, airports, stations, farms, landmarks, natural formations (rivers, mountains, beaches, lakes), rooms, venues, neighborhoods, cities, countries. ALL of these are LOCATION, NEVER OBJECT.
    - SPECIFICITY RULE: If both a specific place AND its containing territory are mentioned (e.g., a church in a city, a hotel in a town), extract ONLY the most specific place as the LOCATION entity. Put the containing territory (city/state/country) in the 'parent_name' field. Do NOT create separate LOCATION entities for territories.
    - If no specific building/landmark is mentioned, the city/town itself is the LOCATION.
    - Use CONTEXT_LOCATION to resolve relative references (e.g., "allí", "en ese lugar") if needed.
  * OBJECT: ONLY extract portable, inanimate, man-made physical items that a person can carry or move (e.g., 'libro', 'carta', 'regalo', 'carro', 'maleta'). If in doubt whether something is a LOCATION or OBJECT, it is a LOCATION.
  * PERSON: Extract exhaustively ALL people mentioned. Split group references into distinct individuals (e.g. 'mis abuelos' -> 'abuelo' and 'abuela', 'mis padres' -> 'padre' and 'madre'). Do not omit anyone.
  * TIME: Use descriptive time periods (e.g., "Navidad de 1998"). If a life stage or time reference matches a KNOWN entity conceptually—including macro-stages, custom stages, or nested sub-stages (e.g. "mi adolescencia" -> "Adolescencia", "en el colegio" -> "Colegio", "primer año de universidad" -> "Primer Año")—map it strictly to the KNOWN name to inherit custom periods. CRITICAL: Only assign a stage or sub-stage if there is SUFFICIENT certainty and evidence in the text. Do not guess.
  * FOCUS & RELEVANCE: Only extract entities that are active parts of the memory being described. Do NOT extract entities mentioned purely as narrative connectors, passive comparisons, or references to other past/future memories.
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

/**
 * Segments a large memory text into distinct fragments based on space-time shifts.
 * Returns a simple array of text strings. All inheritance logic is handled
 * deterministically in ai_processor.ts after processing the first segment.
 */
export const segmentMemoryText = async (text: string): Promise<string[]> => {
  const apiKey = await getConfig('OPENAI_API_KEY');
  if (!apiKey) throw new Error('API Key no configurada. Ve al Panel Admin para ingresarla.');

  const systemPrompt = `You split a journal entry into fragments whenever the narrative moves to a DIFFERENT physical location OR a DIFFERENT day/date.

RULES:
1. Split when the text shifts to a new physical place (e.g., from one city to another, from a park to a hospital, from a hotel to a theme park).
2. Split when the text shifts to a different day or date (e.g., "al día siguiente", "después de unos días", a new date mentioned).
3. If the entire text happens in one place on one day/timeframe, return it as a single fragment.
4. Preserve the EXACT original text of each fragment. Do not rewrite, summarize, or edit any words. Simply divide the original text at the appropriate boundaries.
5. Remove narrative connectors that reference a previous fragment at the start of a new fragment (e.g., "Después de eso,", "Luego de visitar X,", "Al salir de allí,"). The fragment should start with the substance of what happened, not a bridge to the previous fragment.

Return JSON: {"fragments": ["text of fragment 1", "text of fragment 2", ...]}`.trim();

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
    const result = JSON.parse(data.choices[0].message.content) as { fragments: string[] };
    const fragments = result.fragments;

    if (!fragments || !Array.isArray(fragments) || fragments.length === 0) {
      return [text];
    }

    // Filter out empty fragments
    const validFragments = fragments.map(f => f.trim()).filter(f => f.length > 0);
    return validFragments.length > 0 ? validFragments : [text];
  } catch (error) {
    console.error('Segmentation failed:', error);
    return [text];
  }
};
