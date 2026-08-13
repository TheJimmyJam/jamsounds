// POST /.netlify/functions/convert-wav
// Body: { taskId, audioId }
// Returns: { taskId }  — a NEW wav-conversion taskId, poll via check-task?kind=wav&taskId=…
//
// The taskId you send in is the music-generation task; the taskId you get back is a
// separate wav task with its own polling endpoint. Don't mix them up.

const SUNO_BASE = 'https://api.sunoapi.org/api/v1';
const NO_OP_CALLBACK = 'https://example.com/no-op';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { taskId, audioId } = body;
  if (!taskId) return json(400, { error: 'taskId required (the music generation task)' });
  if (!audioId) return json(400, { error: 'audioId required' });

  try {
    const res = await fetch(`${SUNO_BASE}/wav/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUNO_API_KEY}`,
      },
      body: JSON.stringify({ taskId, audioId, callBackUrl: NO_OP_CALLBACK }),
    });
    const data = await res.json();
    if (data.code !== 200) {
      return json(res.ok ? 500 : res.status, {
        error: data.msg || 'Suno error',
        code: data.code,
        raw: data,
      });
    }
    return json(200, { taskId: data.data?.taskId, mode: 'wav' });
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
