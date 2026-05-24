// GET  /.netlify/functions/list-tracks         → list saved tracks
// DELETE /.netlify/functions/list-tracks?id=…  → delete a saved track (and its storage objects)
// Uses Supabase REST/Storage APIs directly via fetch — no dependencies.

const BUCKET = 'jamsounds-audio';
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
      const url = `${SUPABASE_URL}/rest/v1/js_tracks?user_email=eq.${encodeURIComponent(USER_EMAIL)}&saved=eq.true&order=created_at.desc&limit=200`;
      const res = await fetch(url, { headers: baseHeaders });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`List failed: ${res.status} ${t}`);
      }
      const tracks = await res.json();
      return json(200, { tracks });
    } catch (e) {
      return json(500, { error: e.message });
    }
  }

  if (event.httpMethod === 'DELETE') {
    const id = event.queryStringParameters?.id;
    if (!id) return json(400, { error: 'id required' });
    try {
      // Find the row first to know which storage objects to remove
      const findRes = await fetch(`${SUPABASE_URL}/rest/v1/js_tracks?id=eq.${encodeURIComponent(id)}&select=suno_audio_id`, { headers: baseHeaders });
      const rows = findRes.ok ? await findRes.json() : [];
      const sunoAudioId = rows[0]?.suno_audio_id;

      if (sunoAudioId) {
        await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
          method: 'DELETE',
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prefixes: [`audio/${sunoAudioId}.mp3`, `images/${sunoAudioId}.jpg`],
          }),
        }).catch(() => {});
      }

      const delRes = await fetch(`${SUPABASE_URL}/rest/v1/js_tracks?id=eq.${encodeURIComponent(id)}`, {
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
