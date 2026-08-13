// POST /.netlify/functions/boost-style
// Body: { content }   — a short style description, e.g. "Pop, Mysterious"
// Returns: { style, creditsConsumed, creditsRemaining }
//
// Suno expands a terse style line into a fuller one. Useful for turning
// "ambient, spacey" into something with instrumentation and production detail.
//
// This endpoint takes no callBackUrl and has no documented polling endpoint —
// the expanded text comes back on `data.result`. If Suno ever flips it async,
// successFlag will be '0' and result empty; we surface that as an error rather
// than silently returning nothing.

const SUNO_BASE = 'https://api.sunoapi.org/api/v1';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: 'Invalid JSON' }); }

  const content = (body.content || '').trim();
  if (!content) return json(400, { error: 'content required' });

  try {
    const res = await fetch(`${SUNO_BASE}/style/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUNO_API_KEY}`,
      },
      body: JSON.stringify({ content }),
    });
    const data = await res.json();
    if (data.code !== 200) {
      return json(res.ok ? 500 : res.status, {
        error: data.msg || 'Suno error',
        code: data.code,
        raw: data,
      });
    }

    const result = data.data?.result;
    if (!result) {
      return json(502, {
        error: 'Suno accepted the request but returned no expanded style',
        successFlag: data.data?.successFlag,
        raw: data,
      });
    }

    return json(200, {
      style: result,
      creditsConsumed: data.data?.creditsConsumed ?? null,
      creditsRemaining: data.data?.creditsRemaining ?? null,
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
