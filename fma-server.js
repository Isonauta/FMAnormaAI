const express = require('express');
const path    = require('path');
const app     = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── /api/analizar — Flujo conversacional 5 Porqués ──
// El HTML envía: { systemPrompt, userMsg, history, incluirDocumentos }
// Responde con JSON: { mensaje, tipo, sugerencias, acciones_3p, ... }
app.post('/api/analizar', async (req, res) => {
  const { systemPrompt, userMsg, history = [] } = req.body;
  if (!userMsg) return res.status(400).json({ error: 'userMsg requerido' });

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt || `Eres NormaAI FMA, experto en ISO 9001:2015 para análisis de No Conformidades con metodología 5 Porqués. Responde SIEMPRE con JSON válido siguiendo el formato indicado. Sin texto adicional fuera del JSON.`,
        messages: [
          ...history.filter(m => m.role === 'user' || m.role === 'assistant').slice(-6),
          { role: 'user', content: userMsg }
        ]
      })
    });

    const data  = await resp.json();
    const text  = data.content?.[0]?.text || '{}';
    const clean = text.replace(/```json|```/g, '').trim();

    // Intentar parsear JSON — si falla, devolver como mensaje libre
    try {
      const parsed = JSON.parse(clean);
      res.json(parsed);
    } catch {
      // La IA respondió texto libre — lo envolvemos en la estructura esperada
      res.json({ mensaje: clean, tipo: 'libre', sugerencias: [] });
    }

  } catch(e) {
    console.error('Error /api/analizar:', e);
    res.status(500).json({ error: 'Error al analizar' });
  }
});

// ── /api/manny — Agente IA conversacional ───────────
// El HTML envía: { message, history }
// Responde con: { respuesta }
app.post('/api/manny', async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message) return res.status(400).json({ error: 'message requerido' });

  // Construir historial en formato Anthropic
  const messages = [
    ...history
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-16),
    { role: 'user', content: message }
  ];

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: `Eres Manny, asistente experto en gestión ISO de FMA Industrial SpA (Chile), fabricante de attachments mineros de clase mundial.

Dominas ISO 9001:2015, 14001:2015 y 45001:2018, análisis de causa raíz (5 Porqués, Ishikawa, 3P), No Conformidades y acciones correctivas, auditorías y mejora continua en contexto minero chileno.

REGLAS DE FORMATO — CRÍTICO:
- Responde directo, sin frases de introducción como "Excelente pregunta" o "Por supuesto"
- Usa Markdown limpio: **negrita** para conceptos clave, listas con guión para pasos o puntos
- Usa ### solo si la respuesta tiene más de 3 secciones distintas
- Cita la cláusula ISO entre paréntesis: (cláusula 8.4.1)
- Si la pregunta es simple, responde en 2-3 líneas máximo
- Máximo 4 puntos por lista — agrupa si hay más
- NUNCA uses tablas Markdown a menos que el usuario las pida explícitamente
- Usa ejemplos del contexto minero o industrial cuando sean útiles`,
        messages
      })
    });

    const data  = await resp.json();
    const reply = data.content?.[0]?.text || 'Sin respuesta';
    res.json({ respuesta: reply });

  } catch(e) {
    console.error('Error /api/manny:', e);
    res.status(500).json({ error: 'Error del agente' });
  }
});

// ── Fallback SPA ─────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`NormaAI FMA corriendo en puerto ${PORT}`));
