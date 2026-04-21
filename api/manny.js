export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message, history = [] } = req.body;
  if (!message) return res.status(400).json({ error: 'message requerido' });

  const messages = [
    ...history.filter(m => m.role === 'user' || m.role === 'assistant').slice(-16),
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
        system: `Eres Manny, el asistente experto en gestión de calidad ISO de FMA Industrial SpA (Chile), empresa fabricante de attachments mineros de clase mundial.

Tienes profundo conocimiento de:
- ISO 9001:2015 (Sistemas de Gestión de Calidad)
- ISO 14001:2015 (Gestión Ambiental)
- ISO 45001:2018 (Seguridad y Salud en el Trabajo)
- Análisis de causa raíz: 5 Por Qué, Ishikawa, metodología 3P
- No Conformidades y acciones correctivas (cláusula 10.2)
- Auditorías internas y externas
- Mejora continua y ciclo PHVA
- Contexto de la industria minera chilena

Responde de forma clara, profesional y práctica. Cita el número de cláusula cuando sea relevante. Usa lenguaje directo con ejemplos concretos aplicables al contexto industrial minero chileno. Puedes usar HTML básico (<strong>, <br>) para formatear tu respuesta.`,
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
}
