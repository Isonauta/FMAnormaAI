// ═══════════════════════════════════════════════════════════
// api/manny.js — Manny con RAG (Voyage AI + Supabase KB)
// ═══════════════════════════════════════════════════════════

const https = require('https');

const SUPABASE_URL = 'https://ejtbqmjbcozhlxscxpze.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGJxbWpiY296aGx4c2N4cHplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MTkzMzUsImV4cCI6MjA5MjI5NTMzNX0.ZJfedmp6Lyx7xJtX9lJ9uTEGmGwSGUa5amFGwc5ZQWw';
const VOYAGE_KEY = 'pa-eXtfuZX6sf3eKxzfImtU_2abV9U70GmNoEuMTc15Ijk';
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
        catch(e) { reject(new Error('Parse error: ' + raw.substring(0,200))); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Obtener embedding de la pregunta del usuario
async function getEmbedding(text) {
  const res = await httpPost('api.voyageai.com', '/v1/embeddings', {
    'Authorization': 'Bearer ' + VOYAGE_KEY
  }, { model: 'voyage-2', input: text, input_type: 'query' });
  if (!res.data || !res.data[0]) throw new Error('Voyage error');
  return res.data[0].embedding;
}

// Buscar en KB de Supabase
async function buscarKB(embedding, threshold = 0.45, limit = 5) {
  const res = await httpPost('ejtbqmjbcozhlxscxpze.supabase.co', '/rest/v1/rpc/buscar_kb', {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json'
  }, { query_embedding: embedding, match_threshold: threshold, match_count: limit });
  return Array.isArray(res) ? res : [];
}

// Construir contexto desde resultados KB
function construirContextoKB(resultados) {
  if (!resultados || resultados.length === 0) return null;
  return resultados.map(r =>
    `[${r.modulo} — Similitud: ${(r.similarity * 100).toFixed(0)}%]\n${r.contenido}`
  ).join('\n\n---\n\n');
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Parsear body manualmente si viene como string
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  if (!body) return res.status(400).json({ error: 'Empty body' });

  const { messages } = body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

  try {
    // Obtener la última pregunta del usuario
    const ultimaMsj = messages.filter(m => m.role === 'user').pop();
    const preguntaUsuario = ultimaMsj ? ultimaMsj.content : '';

    // RAG: buscar en KB
    let contextoKB = null;
    let kbEncontrada = false;

    if (preguntaUsuario && preguntaUsuario.length > 5) {
      try {
        const embedding = await getEmbedding(preguntaUsuario);
        const resultados = await buscarKB(embedding, 0.45, 5);
        if (resultados.length > 0) {
          contextoKB = construirContextoKB(resultados);
          kbEncontrada = true;
        }
      } catch(e) {
        console.warn('RAG error:', e.message);
      }
    }

    // System prompt con contexto KB
    const systemPrompt = `Eres Manny, el asistente de inteligencia artificial del Sistema de Gestión Integrado (SIG) de FMA Industrial SpA. FMA es una empresa chilena fabricante de attachments y equipos para la industria minera, con plantas en Santiago y Antofagasta.

Tu función es ayudar a los colaboradores de FMA con:
- No Conformidades (NCs): registro, análisis de causa raíz con 5 Por Qué, acciones correctivas
- Cláusulas ISO 9001, ISO 14001 e ISO 45001
- Procedimientos internos de FMA (PGI)
- Auditorías internas
- Gestión documental
- Seguridad, salud y medio ambiente

REGLAS DE HONESTIDAD (MUY IMPORTANTE):
- Si la información está en el CONTEXTO KB que se te entrega, úsala como base principal de tu respuesta y cítala con naturalidad.
- Si la pregunta es sobre algo que NO está en la KB y no tienes certeza, responde exactamente: "No encontré evidencia documentada para esto en el sistema actual de FMA. Te recomiendo consultar directamente con el Encargado del SGI o tu jefe de área."
- NUNCA inventes procedimientos, plazos, nombres de personas o documentos que no estén en la KB o en tu conocimiento verificado de las normas ISO.
- Puedes responder preguntas generales sobre ISO 9001, 14001 y 45001 con tu conocimiento base, pero diferencia claramente entre lo que es norma general y lo que es específico de FMA.

ESTILO DE RESPUESTA:
- Responde en español, tono cercano pero profesional
- Usa formato claro con pasos numerados cuando corresponda
- Sé conciso pero completo
- Siempre ofrece ayuda adicional al final

${kbEncontrada ? `CONTEXTO DE LA BASE DE CONOCIMIENTO FMA (usa esto como fuente principal):\n\n${contextoKB}` : 'NOTA: No se encontró información específica en la KB de FMA para esta consulta. Responde con conocimiento general ISO o indica que debe consultar al SGI.'}`;

    // Llamar a Claude
    const response = await httpPost('api.anthropic.com', '/v1/messages', {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    }, {
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages
    });

    if (response.error) throw new Error(response.error.message);

    const reply = response.content?.[0]?.text || 'Sin respuesta';
    res.status(200).json({ reply, kbUsada: kbEncontrada });

  } catch (err) {
    console.error('Manny error:', err);
    res.status(500).json({ error: err.message });
  }
};
