// AI Service - Sin dependencia de expo-file-system para compatibilidad con Snack

const OPENAI_API_KEY = ''; // Pegar clave real aquí para probar

export interface AICategorization {
  title: string;
  fuzzy_date: string;
  sentiment: number;
  entities: { name: string; type: 'PERSON' | 'LOCATION' | 'EMOTION' | 'EVENT' }[];
}

export const transcribeAudio = async (audioUri: string): Promise<string> => {
  if (!OPENAI_API_KEY) throw new Error('API Key missing');

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
        Authorization: `Bearer ${OPENAI_API_KEY}`,
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
  if (!OPENAI_API_KEY) throw new Error('API Key missing');

  const systemPrompt = `
Eres el motor cognitivo de Mnemósine. Recibes fragmentos de memoria diarios. Tu única tarea es devolver un JSON estructurado. Reglas:
1. Infiere la fecha real o difusa del relato (ej. 'Navidad 1999', 'Hace 5 años', o 'Hoy').
2. Extrae 'Entidades' importantes. Los tipos válidos son PERSON, LOCATION, EMOTION, EVENT.
3. Evalúa el sentimiento del recuerdo en una escala de -1.0 (Muy Negativo) a 1.0 (Muy Positivo).
4. Genera un título poético de máximo 5 palabras.
5. Nunca devuelvas texto conversacional, solo JSON válido que cumpla estrictamente con esta estructura:
{
  "title": "Título corto",
  "fuzzy_date": "Fecha difusa",
  "sentiment": 0.5,
  "entities": [
    { "name": "Nombre Entidad", "type": "PERSON" }
  ]
}
  `.trim();

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
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
