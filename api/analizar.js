export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
        system: systemPrompt || `Eres NormaAI FMA, experto en ISO 9001:2015 para análisis de No Conformidades con metodología 5 Porqués. Responde SIEMPRE con JSON válido. Sin texto adicional fuera del JSON.`,
        messages: [
          ...history.filter(m => m.role === 'user' || m.role === 'assistant').slice(-6),
          { role: 'user', content: userMsg }
        ]
      })
    });

    const data  = await resp.json();
    const text  = data.content?.[0]?.text || '{}';
    const clean = text.replace(/```json|```/g, '').trim();

    try {
      res.json(JSON.parse(clean));
    } catch {
      res.json({ mensaje: clean, tipo: 'libre', sugerencias: [] });
    }

  } catch(e) {
    console.error('Error /api/analizar:', e);
    res.status(500).json({ error: 'Error al analizar' });
  }
}
