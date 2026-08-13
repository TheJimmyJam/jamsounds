// POST /.netlify/functions/separate-vocals
// Body (one of):
//   { taskId, audioId, type? }   — split a track Suno generated
//   { audioUrl, type? }          — split an audio file by URL (≤20MB)
// type: 'separate_vocal' (default) | 'split_stem' | 'split_stem_advanced'
//   split_stem_advanced also takes { stemName }
// Returns: { taskId }  — poll via check-task?kind=stems&taskId=…
//
// Suno's schema is a oneOf: send EITHER taskId+audioId OR audioUrl, never both.

const SUNO_BASE = 'https://api.sunoapi.org/api/v1';
const NO_OP_CALLBACK = 'https://example.com/no-op';
const VALID_TYPES = ['separate_vocal', 'split_stem', 'split_stem_advanced'];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { taskId, audioId, audioUrl, type = 'separate_vocal', stemName } = body;

  const byTask = !!(taskId && audioId);
  const byUrl = !!audioUrl;

  if (byTask && byUrl) {
    return json(400, { error: 'Send either taskId+audioId or audioUrl, not both' });
  }
  if (!byTask && !byUrl) {
    return json(400, { error: 'taskId+audioId or audioUrl required' });
  }
  if (!VALID_TYPES.includes(type)) {
    return json(400, { error: `type must be one of: ${VALID_TYPES.join(', ')}` });
  }
  if (type === 'split_stem_advanced' && !stemName) {
    return json(400, { error: 'stemName required when type is split_stem_advanced' });
  }

  const payload = { callBackUrl: NO_OP_CALLBACK, type };
  if (byTask) {
    payload.taskId = taskId;
    payload.audioId = audioId;
  } else {
    payload.audioUrl = audioUrl;
  }
  if (type === 'split_stem_advanced') payload.stemName = stemName;

  try {
    const res = await fetch(`${SUNO_BASE}/vocal-removal/generate`, {
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
    return json(200, { taskId: data.data?.taskId, mode: 'stems', type });
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
