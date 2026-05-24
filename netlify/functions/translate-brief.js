// POST /.netlify/functions/translate-brief
// Body: { brief: string }
// Returns: { title, style, prompt, instrumental, negativeTags, vocalGender }
// Uses Anthropic Claude Haiku to translate a project description into Suno parameters.

const SYSTEM_PROMPT = `You are a music director who translates project descriptions into Suno AI music parameters.

CRITICAL: In Suno Custom Mode, the "prompt" field is sung VERBATIM as the lyrics. Whatever you put there is what the singer will literally sing. So:
- If instrumental is TRUE: prompt should be a SHORT descriptive line (1 sentence) describing the mood/structure.
- If instrumental is FALSE: prompt MUST be actual singable lyrics with proper structure tags. NEVER write descriptions like "a tender love song about X" — write the actual words to be sung.

You will receive a description of a project (an app, a video, a person, a moment, etc.) and must produce JSON describing the music.

Output ONLY valid JSON with this exact shape:
{
  "title": "<short evocative title, max 60 chars>",
  "style": "<comma-separated genre/mood/instrumentation/tempo tags, e.g. 'ambient electronic, warm pads, gentle pulse, 80 BPM, lo-fi, downtempo'>",
  "prompt": "<see CRITICAL rules above>",
  "instrumental": <true | false>,
  "negativeTags": "<comma-separated traits to avoid>",
  "vocalGender": "<empty string OR 'm' OR 'f'>"
}

WHEN INSTRUMENTAL IS FALSE — WRITE REAL LYRICS:
Use Suno's section tags exactly like this:

[Verse 1]
Line one of the verse here
Line two with a rhyme there
Keep lines short, 5-9 syllables
Make them feel singable

[Pre-Chorus]
A few lines that build tension
Setting up the chorus

[Chorus]
The hook — the most memorable line
Often repeats the title or a key phrase
Make it emotional and singable
End with a punch

[Verse 2]
A different angle on the theme
But same structure and rhythm
Build on what verse 1 set up
Toward the chorus again

[Chorus]
(Same chorus, repeat exactly)

[Bridge]
A new perspective or twist
Different melody implied
Builds to the final chorus

[Chorus]
(Final chorus, can vary slightly)

[Outro]
A closing line or two
Fading thought

LYRIC RULES:
- Write 16-32 lines total.
- Rhyme matters but don't force it. Slant rhymes are fine.
- If a person's name is given, weave it in naturally — usually in the chorus.
- Be specific and image-rich. Avoid clichés ("forever and always", "you complete me").
- Match the emotional register of the brief. Love song = warm and tender. Hype song = bold and rhythmic. Tribute = reverent.
- Keep lines actually singable — short, with natural stress patterns.

WHEN INSTRUMENTAL IS TRUE:
- prompt can be a single sentence describing mood/structure, e.g. "Soft loopable instrumental, gentle morning calm."
- Default to TRUE for app backgrounds, ambient use, video underscoring.

STYLE RULES:
- 5-10 specific descriptors including a tempo (BPM) and feel.
- Match the emotional tone. Love song: "intimate folk-pop, fingerpicked acoustic guitar, soft piano, warm strings swell in chorus, 70 BPM". Energetic: "driving indie rock, distorted guitars, four-on-the-floor drums, 130 BPM".
- Avoid generic descriptors. Be specific (e.g. "felted Rhodes, brushed snare, light reverb" not "nice piano").

DECIDE instrumental BASED ON THE BRIEF:
- If the brief mentions a person, tribute, love, story, emotion meant to be sung → instrumental = false (write lyrics)
- If the brief mentions an app, video background, presentation, ambient mood → instrumental = true

Output nothing except the JSON object. No prose, no backticks, no preamble.`;

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
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Project / brief:\n\n${brief}\n\nReturn the JSON now. If this is a song with vocals, write REAL lyrics — not descriptions.` }],
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
