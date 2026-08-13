// POST /.netlify/functions/extend-music
// Body: { audioId, model, defaultParamFlag?, continueAt?, title?, style?, prompt?,
//         instrumental?, negativeTags?, vocalGender?, personaId?, personaModel?,
//         styleWeight?, weirdnessConstraint?, audioWeight? }
// Returns: { taskId }
//
// Two modes, per Suno's `defaultParamFlag`:
//   false (default here) — continue the track using its ORIGINAL parameters. One click,
//                          nothing else required. This is what the ⏩ button sends.
//   true                 — custom extend. Suno then REQUIRES style, title and continueAt.
//
// The resulting taskId polls through the normal /generate/record-info path, so the
// frontend can reuse check-status.js unchanged.

const SUNO_BASE = 'https://api.sunoapi.org/api/v1';
const NO_OP_CALLBACK = 'https://example.com/no-op';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: 'Invalid JSON' }); }

  const {
    audioId,
    model,
    defaultParamFlag = false,
    continueAt,
    title,
    style,
    prompt,
    instrumental,
    negativeTags,
    vocalGender,
    personaId,
    personaModel,
    styleWeight,
    weirdnessConstraint,
    audioWeight,
  } = body;

  if (!audioId) return json(400, { error: 'audioId required' });
  // Suno rejects a model that doesn't match the source audio, so make the caller be explicit.
  if (!model) return json(400, { error: 'model required — must match the source track' });

  // Custom mode has hard requirements; fail here rather than burning a call.
  if (defaultParamFlag) {
    if (!style) return json(400, { error: 'style required when defaultParamFlag is true' });
    if (!title) return json(400, { error: 'title required when defaultParamFlag is true' });
    if (continueAt == null) return json(400, { error: 'continueAt required when defaultParamFlag is true' });
    if (!instrumental && !prompt) {
      return json(400, { error: 'prompt required when defaultParamFlag is true and instrumental is false' });
    }
  }

  const payload = {
    defaultParamFlag: !!defaultParamFlag,
    audioId,
    model,
    callBackUrl: NO_OP_CALLBACK,
  };

  if (defaultParamFlag) {
    payload.style = style;
    payload.title = title;
    payload.continueAt = continueAt;
    if (!instrumental) payload.prompt = prompt;
  }

  if (instrumental != null) payload.instrumental = !!instrumental;
  if (negativeTags) payload.negativeTags = negativeTags;
  // Suno rejects vocalGender when instrumental is true.
  if (vocalGender && !instrumental) payload.vocalGender = vocalGender;
  if (personaId) {
    payload.personaId = personaId;
    payload.personaModel = personaModel || 'style_persona';
  }
  if (styleWeight != null) payload.styleWeight = styleWeight;
  if (weirdnessConstraint != null) payload.weirdnessConstraint = weirdnessConstraint;
  if (audioWeight != null) payload.audioWeight = audioWeight;

  try {
    const res = await fetch(`${SUNO_BASE}/generate/extend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUNO_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.code !== 200) {
      return json(res.ok ? 500 : res.status, {
        error: data.msg || 'Suno error',
        code: data.code,
        raw: data,
      });
    }
    return json(200, { taskId: data.data?.taskId, mode: 'extend' });
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
