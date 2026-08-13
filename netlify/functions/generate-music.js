// POST /.netlify/functions/generate-music
// Body: { title, style, prompt, model, instrumental, negativeTags, vocalGender,
//         styleWeight, weirdnessConstraint, audioWeight, duration, uploadUrl,
//         personaId, personaModel }
// Returns: { taskId }
// - If uploadUrl is present: routes to Suno's /generate/upload-cover endpoint (uses the audio as a reference).
// - Otherwise: regular Custom Mode /generate.
// - If personaId is present: forwards it (and personaModel) so Suno reuses that voice profile.
//   personaModel is 'style_persona' (minted from a generated song) or 'voice_persona'
//   (a Suno Voice recorded and verified in Suno's own app).
// - duration is 10–360 seconds and is V5_5-only. Sending it on an older model makes
//   Suno reject the whole request, so it is dropped rather than forwarded.

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
    duration,
    uploadUrl,
    personaId,
    personaModel,
  } = body;

  if (!title || !style) return json(400, { error: 'title and style are required' });
  if (!instrumental && !prompt) return json(400, { error: 'prompt (lyrics) required when instrumental is false' });
  if (duration != null && (duration < 10 || duration > 360)) {
    return json(400, { error: 'duration must be between 10 and 360 seconds' });
  }

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
  // V5_5 + custom mode only. customMode is always true here, so the model is the
  // only gate — but check it server-side too, since an older saved brief could
  // carry a duration forward onto a V4 regeneration.
  if (duration != null && model === 'V5_5') sunoPayload.duration = Math.round(duration);
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
