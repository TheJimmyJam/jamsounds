// POST /.netlify/functions/translate-brief
// Body: { brief: string }
// Returns: { title, style, prompt, instrumental, negativeTags, vocalGender }
// Uses Anthropic Claude Haiku to translate a project description into Suno parameters.

const SYSTEM_PROMPT = `You are a music director who translates project descriptions into Suno AI music parameters.

You will receive a description of a project (an app, a video, a website, a presentation, etc.) and must produce JSON describing the music that should accompany it.

Output ONLY valid JSON with this exact shape:
{
  "title": "<short evocative title, max 60 chars>",
  "style": "<comma-separated genre/mood/instrumentation/tempo tags, e.g. 'ambient electronic, warm pads, gentle pulse, 80 BPM, lo-fi, downtempo'>",
  "prompt": "<2-3 sentences of descriptive guidance: feel, structure, what to evoke. If instrumental is false, instead provide actual lyrics here.>",
  "instrumental": <true | false — default true for app backgrounds and ambient use; false if the user clearly wants a song with vocals>,
  "negativeTags": "<comma-separated traits to avoid>",
  "vocalGender": "<empty string OR 'm' OR 'f'>"
}

Guidelines:
- Default to instrumental music unless the project clearly calls for vocals (anthem, theme song, jingle).
- Style should be 5-10 specific descriptors including a tempo (BPM) and feel.
- Match the emotional tone of the project. Calm projects get warm, soft music. Energetic projects get driving, brighter music.
- Avoid generic descriptors like "good" or "nice" — be specific (e.g. "felted Rhodes, brushed snare, light reverb").
- Output nothing except the JSON object. No prose, no backticks, no preamble.`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: 'Invalid JSON' }); }

  const brief = (body.brief || '').trim();
  if (!brief) return json(400, { error: 'brief required' });

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Project description:\n\n${brief}\n\nReturn the JSON now.` }],
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return json(res.status, { error: data.error?.message || 'Anthropic error', raw: data });
    }

    const text = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return json(500, { error: 'Could not parse JSON from Claude', raw: text });

    let parsed;
    try { parsed = JSON.parse(jsonMatch[0]); } catch (e) {
      return json(500, { error: 'Invalid JSON from Claude', raw: text });
    }

    return json(200, {
      title: parsed.title || '',
      style: parsed.style || '',
      prompt: parsed.prompt || '',
      instrumental: parsed.instrumental ?? true,
      negativeTags: parsed.negativeTags || '',
      vocalGender: parsed.vocalGender || '',
    });
  } catch (e) {
    return json(500, { error: e.message });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
