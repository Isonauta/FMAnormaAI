// api/entrenamiento.js — Manny Coach SGI v1

const https = require('https');

const SUPABASE_URL = 'https://ejtbqmjbcozhlxscxpze.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const VOYAGE_KEY   = process.env.VOYAGE_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

function httpPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers }
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { reject(new Error('Parse error: ' + raw.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function getEmbedding(text) {
  const res = await httpPost('api.voyageai.com', '/v1/embeddings', {
    'Authorization': 'Bearer ' + VOYAGE_KEY
  }, { model: 'voyage-2', input: text, input_type: 'query' });
  if (!res.data || !res.data[0]) throw new Error('Voyage error: ' + JSON.stringify(res));
  return res.data[0].embedding;
}

async function buscarKB(embedding) {
  const res = await httpPost('ejtbqmjbcozhlxscxpze.supabase.co', '/rest/v1/rpc/buscar_kb', {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY
  }, { query_embedding: embedding, match_threshold: 0.2, match_count: 8 });
  return Array.isArray(res) ? res : [];
}

// Temas disponibles para entrenamiento
const TEMAS = [
  { codigo: 'PGI-02', nombre: 'Control de Documentos y Registros', norma: 'ISO 9001 · Cláusula 7.5' },
  { codigo: 'PGI-03', nombre: 'No Conformidad y Acciones Correctivas', norma: 'ISO 9001 · Cláusula 10.2' },
  { codigo: 'PGI-04', nombre: 'Auditorías Internas', norma: 'ISO 9001 · Cláusula 9.2' },
  { codigo: 'MIPER',  nombre: 'Identificación de Peligros y Evaluación de Riesgos', norma: 'ISO 45001 · Cláusula 6.1' },
  { codigo: 'PGI-19', nombre: 'Identificación de Aspectos Ambientales', norma: 'ISO 14001 · Cláusula 6.1' },
  { codigo: 'PGI-20', nombre: 'Investigación de Incidentes', norma: 'ISO 45001 · Cláusula 10.2' },
];

const SYSTEM_PROMPT_COACH = `Eres Manny en MODO ENTRENAMIENTO — Coach SGI de FMA Industrial SpA.

Tu misión es entrenar a los trabajadores de FMA en los procedimientos del Sistema de Gestión Integrado (SGI), haciéndolos más conscientes de sus responsabilidades según ISO 9001, ISO 14001 e ISO 45001.

REGLAS DEL MODO ENTRENAMIENTO:
1. Haces UNA sola pregunta a la vez. Nunca dos preguntas juntas.
2. Esperas la respuesta del usuario antes de continuar.
3. Evalúas la respuesta comparándola con los documentos de FMA en la KB.
4. Si la respuesta es correcta: celebra con energía y refuerza el aprendizaje.
5. Si la respuesta es parcial: valida lo correcto, corrige lo que falta con calidez.
6. Si la respuesta es incorrecta: corrige con empatía, sin hacer sentir mal al usuario.
7. Después de evaluar, ofrece continuar con otra pregunta o profundizar el tema.

TONO: Eres motivador, cercano, experto. Como un buen profe de terreno que conoce FMA por dentro. Usas frases como:
- "¡Muy bien!" / "¡Exacto!" / "¡Eso es!"
- "Casi, pero recuerda que según el PGI-03..."
- "Buena respuesta, y complementando..."
- "Interesante, aunque según nuestro procedimiento..."

NUNCA inventes información. Si no tienes contexto KB para evaluar, sé honesto y di que necesitas más contexto del procedimiento.

FORMATO DE RESPUESTA:
- Usa texto limpio, sin markdown excesivo
- Máximo 3 párrafos por respuesta
- Emojis moderados para calidez (✅ ⚠️ 💡 🎯)

CONTEXTO KB FMA (usa esto para formular preguntas y evaluar respuestas):
{{KB_CONTEXT}}`;

module.exports = async (req, res) => {
  // ── CORS ──────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch(e) { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  if (!body) return res.status(400).json({ error: 'Empty body' });

  const { messages, tema } = body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  try {
    // Determinar el tema activo
    const temaActivo = tema || TEMAS[Math.floor(Math.random() * TEMAS.length)];

    // El primer mensaje puede ser [INICIAR_ENTRENAMIENTO]
    const ultimaMsj = messages[messages.length - 1];
    const esInicio = ultimaMsj?.content === '[INICIAR_ENTRENAMIENTO]';

    // Buscar contexto KB relevante
    let contextoKB = '';
    try {
      const queryText = esInicio
        ? `${temaActivo.codigo} ${temaActivo.nombre} procedimiento FMA`
        : ultimaMsj?.content || temaActivo.nombre;

      const embedding = await getEmbedding(queryText);
      const resultados = await buscarKB(embedding);
      if (resultados.length > 0) {
        contextoKB = resultados
          .filter(r => r.similarity > 0.25)
          .slice(0, 5)
          .map(r => `[${r.modulo} — ${(r.similarity * 100).toFixed(0)}%]\n${r.contenido}`)
          .join('\n\n---\n\n');
      }
    } catch(e) {
      console.warn('RAG warning:', e.message);
      contextoKB = 'KB no disponible temporalmente. Usa tu conocimiento de los procedimientos FMA.';
    }

    const systemPrompt = SYSTEM_PROMPT_COACH.replace('{{KB_CONTEXT}}', contextoKB || 'Sin contexto KB específico.');

    // Preparar mensajes — si es inicio, reemplazar el trigger por instrucción real
    let mensajesAPI = messages.map(m => ({
      role: m.role,
      content: m.content === '[INICIAR_ENTRENAMIENTO]'
        ? `Inicia el entrenamiento con el tema: ${temaActivo.codigo} — ${temaActivo.nombre} (${temaActivo.norma}). Preséntate como Coach, motiva al usuario y haz la primera pregunta técnica pero accesible para un trabajador de terreno de FMA.`
        : m.content
    }));

    const response = await httpPost('api.anthropic.com', '/v1/messages', {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    }, {
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: mensajesAPI
    });

    if (response.error) throw new Error(response.error.message);
    const reply = response.content?.[0]?.text || 'Sin respuesta';

    return res.status(200).json({ reply, tema: temaActivo });

  } catch(err) {
    console.error('Entrenamiento error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
