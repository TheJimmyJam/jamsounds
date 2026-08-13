// POST /.netlify/functions/add-instrumental
// Body: { uploadUrl, title, tags, negativeTags?, model?, vocalGender?,
//         styleWeight?, weirdnessConstraint?, audioWeight? }
// Returns: { taskId }
//
// Takes an a cappella / vocal you've uploaded and builds an arrangement under it.
//
// NOTE: this endpoint takes `tags`, NOT `style` — unlike every other generate
// endpoint. That asymmetry is Suno's, not ours. We accept `style` as an alias so
// the frontend can pass its usual field name, but we send it as `tags`.
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
    title,
    tags,
    style, // alias — Suno's field here is `tags`
    negativeTags,
    model = 'V5_5',
    vocalGender,
    styleWeight,
    weirdnessConstraint,
    audioWeight,
  } = body;

  const styleTags = tags || style;

  if (!uploadUrl) return json(400, { error: 'uploadUrl required — upload a reference MP3 first' });
  if (!title) return json(400, { error: 'title required' });
  if (!styleTags) return json(400, { error: 'tags (or style) required' });

  const payload = {
    uploadUrl,
    title,
    tags: styleTags,
    negativeTags: negativeTags || 'none',
    model,
    callBackUrl: NO_OP_CALLBACK,
  };

  if (vocalGender) payload.vocalGender = vocalGender;
  if (styleWeight != null) payload.styleWeight = styleWeight;
  if (weirdnessConstraint != null) payload.weirdnessConstraint = weirdnessConstraint;
  if (audioWeight != null) payload.audioWeight = audioWeight;

  try {
    const res = await fetch(`${SUNO_BASE}/generate/add-instrumental`, {
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
    return json(200, { taskId: data.data?.taskId, mode: 'add-instrumental' });
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
