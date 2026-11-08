// GET /.netlify/functions/get-credits
// Returns current Suno API credit balance.

const { denyUnlessOwner } = require('../lib/owner');

exports.handler = async (event) => {
  const denied = denyUnlessOwner(event);
  if (denied) return denied;
  try {
    const res = await fetch('https://api.sunoapi.org/api/v1/generate/credit', {
      headers: { Authorization: `Bearer ${process.env.SUNO_API_KEY}` },
    });
    const data = await res.json();
    if (data.code !== 200) {
      return json(500, { error: data.msg || 'Suno error' });
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
