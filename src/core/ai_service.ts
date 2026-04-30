// AI Service - Lee la API Key de AsyncStorage (configurada desde el Panel Admin)
import { getConfig } from './config';

export interface AICategorization {
  title: string;
  sentiment: number;
  time_markers: string[];
  entities: { name: string; type: 'PERSON' | 'LOCATION' | 'EMOTION' | 'EVENT'; parent_name?: string }[];
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

export const extractMemoryData = async (text: string): Promise<AICategorization> => {
  const apiKey = await getConfig('OPENAI_API_KEY');
  if (!apiKey) throw new Error('API Key no configurada. Ve al Panel Admin para ingresarla.');

  const systemPrompt = `
Eres el motor cognitivo de Mnemósine. Recibes fragmentos de memoria diarios. Tu tarea es extraer metadatos para nuestro motor local.
REGLAS ESTRICTAS:
1. Extrae marcadores de tiempo relativos exactos como strings en 'time_markers'. Ejemplos: "relative_years:-5", "exact_year:2015", "life_stage:childhood", "fuzzy:el verano pasado". No intentes calcular la fecha exacta, solo extrae la pista textual.
2. Extrae 'entities' importantes (PERSON, LOCATION, EMOTION, EVENT).
3. Si una entidad pertenece a otra de manera obvia (Ej. 'Mi cuarto' en 'Mi casa'), usa 'parent_name' para establecer la jerarquía. 
4. Evalúa el sentimiento del recuerdo de -1.0 (Muy Negativo) a 1.0 (Muy Positivo).
5. Genera un 'title' poético de máximo 5 palabras.
6. Si la fecha o el lugar principal son demasiado ambiguos y crees que la app debería preguntar al usuario, añade "DATE_UNCLEAR" o "LOCATION_UNCLEAR" en el array 'ambiguities'.
7. Responde SÓLO en JSON con esta estructura exacta:
{
  "title": "Título corto",
  "sentiment": 0.5,
  "time_markers": ["relative_years:-5"],
  "entities": [
    { "name": "Mi cuarto", "type": "LOCATION", "parent_name": "Mi casa" },
    { "name": "Mi casa", "type": "LOCATION" }
  ],
  "ambiguities": ["LOCATION_UNCLEAR"]
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
