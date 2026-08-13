// POST /.netlify/functions/add-vocals
// Body: { uploadUrl, prompt, title, style, negativeTags, model?, vocalGender?,
//         styleWeight?, weirdnessConstraint?, audioWeight? }
// Returns: { taskId }
//
// Takes an instrumental you've uploaded (same uploadUrl the reference-MP3 dropzone
// produces) and sings `prompt` over it. Suno requires prompt, title, style AND
// negativeTags on this endpoint — all four, no defaults.
//
// Polls through check-status.js like a normal generation.

const SUNO_BASE = 'https://api.sunoapi.org/api/v1';
const NO_OP_CALLBACK = 'https://example.com/no-op';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: 'Invalid JSON' }); }

  const {
    uploadUrl,
    prompt,
    title,
    style,
    negativeTags,
    model = 'V5_5',
    vocalGender,
    styleWeight,
    weirdnessConstraint,
    audioWeight,
  } = body;

  if (!uploadUrl) return json(400, { error: 'uploadUrl required — upload a reference MP3 first' });
  if (!prompt) return json(400, { error: 'prompt (lyrics) required' });
  if (!title) return json(400, { error: 'title required' });
  if (!style) return json(400, { error: 'style required' });
  // Suno marks negativeTags required on this endpoint. Send a harmless default
  // rather than bouncing the user back to fill in a field they may not care about.
  const avoid = negativeTags || 'none';

  const payload = {
    uploadUrl,
    prompt,
    title,
    style,
    negativeTags: avoid,
    model,
    callBackUrl: NO_OP_CALLBACK,
  };

  if (vocalGender) payload.vocalGender = vocalGender;
  if (styleWeight != null) payload.styleWeight = styleWeight;
  if (weirdnessConstraint != null) payload.weirdnessConstraint = weirdnessConstraint;
  if (audioWeight != null) payload.audioWeight = audioWeight;

  try {
    const res = await fetch(`${SUNO_BASE}/generate/add-vocals`, {
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
    return json(200, { taskId: data.data?.taskId, mode: 'add-vocals' });
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
