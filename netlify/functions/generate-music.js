// POST /.netlify/functions/generate-music
// Body: { title, style, prompt, model, instrumental, negativeTags, vocalGender,
//         styleWeight, weirdnessConstraint, audioWeight, uploadUrl,
//         personaId, personaModel }
// Returns: { taskId }
// - If uploadUrl is present: routes to Suno's /generate/upload-cover endpoint (uses the audio as a reference).
// - Otherwise: regular Custom Mode /generate.
// - If personaId is present: forwards it (and personaModel) so Suno reuses that voice profile.

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
    uploadUrl,
    personaId,
    personaModel,
  } = body;

  if (!title || !style) return json(400, { error: 'title and style are required' });
  if (!instrumental && !prompt) return json(400, { error: 'prompt (lyrics) required when instrumental is false' });

  const isCover = !!uploadUrl;
  const endpoint = isCover
    ? 'https://api.sunoapi.org/api/v1/generate/upload-cover'
    : 'https://api.sunoapi.org/api/v1/generate';

  // Build Suno payload — Custom Mode for full control.
  const sunoPayload = {
    customMode: true,
    instrumental: !!instrumental,
    model,
    title,
    style,
    callBackUrl: 'https://example.com/no-op',
  };

  if (!instrumental) sunoPayload.prompt = prompt;
  if (negativeTags) sunoPayload.negativeTags = negativeTags;
  if (vocalGender) sunoPayload.vocalGender = vocalGender;
  if (styleWeight != null) sunoPayload.styleWeight = styleWeight;
  if (weirdnessConstraint != null) sunoPayload.weirdnessConstraint = weirdnessConstraint;
  if (audioWeight != null) sunoPayload.audioWeight = audioWeight;
  if (isCover) sunoPayload.uploadUrl = uploadUrl;
  if (personaId) {
    sunoPayload.personaId = personaId;
    sunoPayload.personaModel = personaModel || 'style_persona';
  }

  try {
    const res = await fetch(endpoint, {
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

    return json(200, { taskId: data.data?.taskId, mode: isCover ? 'cover' : 'generate' });
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
