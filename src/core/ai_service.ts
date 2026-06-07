// AI Service - Lee la API Key de AsyncStorage (configurada desde el Panel Admin)
import { getConfig } from './config';
import { EMOTIONS_HIERARCHY, ALL_EMOTION_NAMES } from './emotions';

// Genera string jerárquico indexado: "0:Alegría(1:Optimismo(2:Bromista,3:Jueguetón),4:Poder(...))"
// La IA ve la estructura general→específica y elige el índice del nivel apropiado
function buildHierarchicalIndexStr(): string {
  const indexOf = (name: string) => ALL_EMOTION_NAMES.indexOf(name);
  return Object.entries(EMOTIONS_HIERARCHY).map(([root, cats]) => {
    const ri = indexOf(root);
    const catsStr = Object.entries(cats).map(([cat, leaves]) => {
      const ci = indexOf(cat);
      const leavesStr = leaves.map(l => `${indexOf(l)}:${l}`).join(',');
      return `${ci}:${cat}(${leavesStr})`;
    }).join(',');
    return `${ri}:${root}(${catsStr})`;
  }).join(',');
}
const EMOTION_TREE_STR = buildHierarchicalIndexStr();


export interface AICategorization {
  title: string;
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

  const systemPrompt = `Extract metadata from a personal memory into JSON.

KNOWN: [${existingEntitiesContext}]
EMOTIONS: {${EMOTION_TREE_STR}}
CONTEXT_TIME: [${timeContext}]
CONTEXT_LOCATION: [${spaceContext}]

OUTPUT:
- time_markers: Extract all temporal references. Formats: "exact_year:YYYY", "exact_month:YYYY-MM", "exact_date:YYYY-MM-DD", "exact_age:N", "age_range:N-M", "relative_years:-N", "life_stage:childhood|teenage|adulthood", "fuzzy:TEXT". Prefer exact_age over life_stage.
  CRITICAL: Do not assume, guess, or invent a specific year, month, or day if there is no explicit certainty in the text. If the reference is vague, relative (e.g., "luego", "más tarde", "ese día"), or context-dependent, use the CONTEXT_TIME provided to infer the date details if appropriate. If no certainty, use "fuzzy:TEXT" or map to a KNOWN stage under entities.
- entities: Extract all referenced PERSON, LOCATION, EVENT, OBJECT, TIME, EMOTION.
  RULES FOR ENTITIES:
  * EMOTION: Interpret emotional tone. Set name to the INDEX NUMBER from EMOTIONS that best matches. Pick more specific indices when text is specific, more general when vague. Skip only if purely factual.
  * LOCATION: You must extract EXACTLY ONE LOCATION entity — the MOST SPECIFIC physical place where the core events of this fragment happened.
    - SPECIFICITY HIERARCHY (from most to least specific): room/hall/space inside a building > building/establishment/landmark/venue > park/plaza/neighborhood > city/town/village > state/region/department > country. ALWAYS choose the HIGHEST specificity level mentioned in the text.
    - If the text mentions a specific building, landmark, venue, park, or any named physical space AND ALSO mentions the city/state/country that contains it, you MUST extract the specific place as the LOCATION and put the city/state/country in 'parent_name'. The territory is NEVER the LOCATION when a more specific place inside it is mentioned.
    - A city/town is ONLY the LOCATION when NO more specific place within it is mentioned.
    - Any physical space where people can be present is a LOCATION: buildings, churches, hospitals, hotels, schools, houses, parks, plazas, stadiums, airports, stations, farms, landmarks, natural formations (rivers, mountains, beaches, lakes), rooms, venues, neighborhoods, cities, countries. These are ALL LOCATION, NEVER OBJECT.
    - Use CONTEXT_LOCATION to resolve relative references (e.g., "allí", "en ese lugar") if needed.
  * OBJECT: ONLY portable, inanimate items that a person can physically carry or move by hand (e.g., 'libro', 'carta', 'regalo', 'maleta'). Any structure, building, space, terrain, or natural formation is LOCATION, not OBJECT.
  * PERSON: Extract exhaustively ALL people mentioned. Split group references into distinct individuals (e.g. 'mis abuelos' -> 'abuelo' and 'abuela', 'mis padres' -> 'padre' and 'madre'). Do not omit anyone.
  * TIME: Use descriptive time periods (e.g., "Navidad de 1998"). If a life stage or time reference matches a KNOWN entity conceptually—including macro-stages, custom stages, or nested sub-stages (e.g. "mi adolescencia" -> "Adolescencia", "en el colegio" -> "Colegio", "primer año de universidad" -> "Primer Año")—map it strictly to the KNOWN name to inherit custom periods. CRITICAL: Only assign a stage or sub-stage if there is SUFFICIENT certainty and evidence in the text. Do not guess.
  * FOCUS & RELEVANCE: Only extract entities that are active parts of the memory being described. Do NOT extract entities mentioned purely as narrative connectors, passive comparisons, or references to other past/future memories.
  * GENERAL: If a reference conceptually matches a KNOWN entity, return the KNOWN name. Do not inject unreferenced KNOWN entities.
- parent_name: For the LOCATION entity, set parent_name to the containing territory (city/state/country). If uncertain, add "ENTITY_AMBIGUOUS" to ambiguities.
- title: Max 5 words.

{"title":"","time_markers":[],"entities":[{"name":"","type":"","parent_name":null}],"ambiguities":[]}
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
