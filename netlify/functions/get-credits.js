// GET /.netlify/functions/get-credits
// Returns current Suno API credit balance.

exports.handler = async () => {
  try {
    const res = await fetch('https://api.sunoapi.org/api/v1/generate/credit', {
      headers: { Authorization: `Bearer ${process.env.SUNO_API_KEY}` },
    });
    const data = await res.json();
    if (data.code !== 200) {
      return json(500, { error: data.msg || 'Suno error', raw: data });
    }
    return json(200, { credits: data.data });
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
