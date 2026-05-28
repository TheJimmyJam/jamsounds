// POST /.netlify/functions/log-play
// Body: { id: <js_tracks.id> }
// Increments play_count and sets last_played_at = now() for that row.
// Uses Supabase RPC-less approach: read current count, write count+1 in a
// single PATCH. Good enough for a single-user app; if we ever go multi-user
// we'd swap this for a proper Postgres function.

// Track id is globally unique (uuid), so we no longer need to filter by user_email
// or profile here — the id alone identifies the row.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: 'Invalid JSON' }); }
  const { id } = body;
  if (!id) return json(400, { error: 'id required' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const baseHeaders = {
    Authorization: `Bearer ${SERVICE_KEY}`,
    apikey: SERVICE_KEY,
    'Content-Type': 'application/json',
  };

  try {
    // 1. Read the current count
    const readRes = await fetch(
      `${SUPABASE_URL}/rest/v1/js_tracks?id=eq.${encodeURIComponent(id)}&select=play_count`,
      { headers: baseHeaders }
    );
    if (!readRes.ok) {
      const t = await readRes.text();
      throw new Error(`Read failed: ${readRes.status} ${t}`);
    }
    const rows = await readRes.json();
    if (!rows || !rows.length) return json(404, { error: 'Track not found' });
    const current = rows[0].play_count || 0;
    const next = current + 1;

    // 2. Write count+1 with current timestamp
    const writeRes = await fetch(
      `${SUPABASE_URL}/rest/v1/js_tracks?id=eq.${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: { ...baseHeaders, Prefer: 'return=representation' },
        body: JSON.stringify({
          play_count: next,
          last_played_at: new Date().toISOString(),
        }),
      }
    );
    if (!writeRes.ok) {
      const t = await writeRes.text();
      throw new Error(`Write failed: ${writeRes.status} ${t}`);
    }
    const updated = await writeRes.json();
    return json(200, { play_count: next, track: Array.isArray(updated) ? updated[0] : updated });
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
