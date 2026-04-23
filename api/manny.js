// api/manny.js — Manny RAG v3 (debug)

const https = require('https');

const SUPABASE_URL = 'https://ejtbqmjbcozhlxscxpze.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;
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
  }, { query_embedding: embedding, match_threshold: 0.2, match_count: 5 });
  return Array.isArray(res) ? res : [];
}

module.exports = async (req, res) => {
  // ── CORS ──────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── DEBUG: log raw body ───────────────────────────────────
  console.log('=== MANNY REQUEST ===');
  console.log('Body type:', typeof req.body);
  console.log('Body preview:', JSON.stringify(req.body)?.substring(0, 200));
  console.log('ANTHROPIC_KEY exists:', !!ANTHROPIC_KEY);
  console.log('VOYAGE_KEY prefix:', VOYAGE_KEY?.substring(0, 8));

  // ── PARSE BODY ────────────────────────────────────────────
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } 
    catch(e) { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }
  if (!body) return res.status(400).json({ error: 'Empty body' });

  // Aceptar tanto {messages} como {prompt} por compatibilidad
  let messages = body.messages;
  if (!messages && body.prompt) {
    messages = [{ role: 'user', content: body.prompt }];
  }
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    console.log('ERROR: no messages found in body:', JSON.stringify(body).substring(0, 300));
    return res.status(400).json({ error: 'messages array required', received: Object.keys(body) });
  }

  if (!ANTHROPIC_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY not set');
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    // RAG
    const ultimaMsj = messages.filter(m => m.role === 'user').pop();
    const pregunta = ultimaMsj?.content || '';
    let contextoKB = '';
    let kbUsada = false;

    if (pregunta.length > 5) {
      try {
        const embedding = await getEmbedding(pregunta);
        const resultados = await buscarKB(embedding);
        if (resultados.length > 0) {
          contextoKB = resultados.map(r =>
            `[${r.modulo} — ${(r.similarity * 100).toFixed(0)}%]\n${r.contenido}`
          ).join('\n\n---\n\n');
          kbUsada = true;
          console.log('KB hits:', resultados.length, 'top:', resultados[0]?.modulo, resultados[0]?.similarity?.toFixed(2));
        }
      } catch(e) {
        console.warn('RAG warning:', e.message);
      }
    }

    const systemPrompt = `Eres Manny, asistente IA del Sistema de Gestión Integrado (SIG) de FMA Industrial SpA — empresa chilena fabricante de attachments mineros, con plantas en Santiago y Antofagasta.

Ayudas con: No Conformidades, análisis 5 Por Qué, cláusulas ISO 9001/14001/45001, procedimientos PGI, auditorías internas, gestión documental, SST y medio ambiente.

COMPORTAMIENTO AL BUSCAR EN LA KB:
Cuando el usuario pregunta algo, SIEMPRE comunica que estás buscando en el sistema de FMA. Usa frases como:
- "Estoy revisando la biblioteca de FMA..."
- "Déjame buscar en los procedimientos..."
- "Revisando el sistema..."

CUANDO ENCUENTRAS INFORMACIÓN: Úsala directamente como base de tu respuesta, citando el procedimiento o fuente de forma natural.

CUANDO NO ENCUENTRAS INFORMACIÓN EXACTA: NO digas simplemente "no encontré". En cambio:
1. Menciona que revisaste el sistema
2. Comparte CUALQUIER dato relacionado que sí encontraste (nombres de responsables, áreas, procedimientos cercanos)
3. Orienta al usuario con ese dato parcial

Ejemplo correcto: "Revisé los procedimientos de FMA y no veo un proceso específico de reposición de EPP documentado, pero según la KB el responsable de EPP es Prevención de Riesgos — ellos tienen la MIPER FMA 2025. ¿Te sirve ese contacto?"

Ejemplo incorrecto: "No encontré evidencia documentada. Consulta al Encargado del SGI." ← Esto es frío y genera desconfianza.

NUNCA inventes procedimientos, plazos, nombres ni datos que no estén en la KB o en tu conocimiento verificado de ISO. La honestidad es sagrada, pero debe comunicarse con calidez y utilidad.

${kbUsada ? 'CONTEXTO KB FMA (fuente principal):\n\n' + contextoKB : 'Sin contexto KB específico — responde con conocimiento general ISO o indica que debe consultar al SGI.'}`;

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
    console.log('Reply length:', reply.length);
    return res.status(200).json({ reply, kbUsada });

  } catch(err) {
    console.error('Manny error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
