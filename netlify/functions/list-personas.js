// GET    /.netlify/functions/list-personas         → list saved personas (newest first)
// DELETE /.netlify/functions/list-personas?id=…    → delete a saved persona
// Mirrors list-tracks.js. Uses Supabase REST directly.

const USER_EMAIL = 'wcannon83@gmail.com';

exports.handler = async (event) => {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const baseHeaders = {
    Authorization: `Bearer ${SERVICE_KEY}`,
    apikey: SERVICE_KEY,
  };

  if (event.httpMethod === 'GET') {
    try {
      const url = `${SUPABASE_URL}/rest/v1/js_personas?user_email=eq.${encodeURIComponent(USER_EMAIL)}&order=created_at.desc&limit=200`;
      const res = await fetch(url, { headers: baseHeaders });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`List failed: ${res.status} ${t}`);
      }
      const personas = await res.json();
      return json(200, { personas });
    } catch (e) {
      return json(500, { error: e.message });
    }
  }

  if (event.httpMethod === 'DELETE') {
    const id = event.queryStringParameters?.id;
    if (!id) return json(400, { error: 'id required' });
    try {
      const delRes = await fetch(`${SUPABASE_URL}/rest/v1/js_personas?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: baseHeaders,
      });
      if (!delRes.ok) {
        const t = await delRes.text();
        throw new Error(`Delete failed: ${delRes.status} ${t}`);
      }
      return json(200, { ok: true });
    } catch (e) {
      return json(500, { error: e.message });
    }
  }

  return json(405, { error: 'GET or DELETE only' });
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
