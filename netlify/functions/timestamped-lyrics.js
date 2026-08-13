// POST /.netlify/functions/timestamped-lyrics
// Body: { taskId, audioId }
// Returns: { words: [{ word, startS, endS, success }], waveform, hootCer }
//
// Synchronous — no task to poll. Word-level timings, useful for karaoke-style
// display or for syncing lyrics to visuals.

const SUNO_BASE = 'https://api.sunoapi.org/api/v1';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { taskId, audioId } = body;
  if (!taskId) return json(400, { error: 'taskId required' });
  if (!audioId) return json(400, { error: 'audioId required' });

  try {
    const res = await fetch(`${SUNO_BASE}/generate/get-timestamped-lyrics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUNO_API_KEY}`,
      },
      body: JSON.stringify({ taskId, audioId }),
    });
    const data = await res.json();
    if (data.code !== 200) {
      return json(res.ok ? 500 : res.status, {
        error: data.msg || 'Suno error',
        code: data.code,
        raw: data,
      });
    }

    return json(200, {
      words: data.data?.alignedWords || [],
      waveform: data.data?.waveformData || [],
      hootCer: data.data?.hootCer ?? null,
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
