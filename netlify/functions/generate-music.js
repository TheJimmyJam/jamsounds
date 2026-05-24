// POST /.netlify/functions/generate-music
// Body: { title, style, prompt, model, instrumental, negativeTags, vocalGender, styleWeight, weirdnessConstraint, audioWeight }
// Returns: { taskId }
// Starts a Suno music generation task using Custom Mode for full control.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: 'Invalid JSON' }); }

  const {
    title,
    style,
    prompt,
    model = 'V5_5',
    instrumental = true,
    negativeTags,
    vocalGender,
    styleWeight,
    weirdnessConstraint,
    audioWeight,
  } = body;

  if (!title || !style) return json(400, { error: 'title and style are required' });
  if (!instrumental && !prompt) return json(400, { error: 'prompt (lyrics) required when instrumental is false' });

  // Build Suno payload — Custom Mode for full control.
  const sunoPayload = {
    customMode: true,
    instrumental: !!instrumental,
    model,
    title,
    style,
    // callBackUrl is required by Suno even though we poll instead.
    // We give it a no-op URL — Suno will hit it but we ignore.
    callBackUrl: 'https://example.com/no-op',
  };

  if (!instrumental) sunoPayload.prompt = prompt;
  if (negativeTags) sunoPayload.negativeTags = negativeTags;
  if (vocalGender) sunoPayload.vocalGender = vocalGender;
  if (styleWeight != null) sunoPayload.styleWeight = styleWeight;
  if (weirdnessConstraint != null) sunoPayload.weirdnessConstraint = weirdnessConstraint;
  if (audioWeight != null) sunoPayload.audioWeight = audioWeight;

  try {
    const res = await fetch('https://api.sunoapi.org/api/v1/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUNO_API_KEY}`,
      },
      body: JSON.stringify(sunoPayload),
    });

    const data = await res.json();
    if (data.code !== 200) {
      return json(res.ok ? 500 : res.status, {
        error: data.msg || 'Suno error',
        code: data.code,
        raw: data,
      });
    }

    return json(200, { taskId: data.data?.taskId });
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
