// GET    /.netlify/functions/list-profiles            → list all profiles (newest last so jimmy stays first)
// POST   /.netlify/functions/list-profiles            → create a new profile { displayName }
// DELETE /.netlify/functions/list-profiles?name=…     → delete a profile (only if it has no personas/tracks)
//
// Profile naming rule: lowercase a-z0-9, hyphens. The slug becomes the
// "profile" partition key on js_personas / js_tracks etc.

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
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/js_profiles?select=*&order=created_at.asc`,
        { headers: baseHeaders }
      );
      if (!res.ok) throw new Error(`List failed: ${res.status} ${await res.text()}`);
      const profiles = await res.json();
      return json(200, { profiles });
    } catch (e) {
      return json(500, { error: e.message });
    }
  }

  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body); } catch { return json(400, { error: 'Invalid JSON' }); }
    const displayName = (body.displayName || '').trim();
    if (!displayName) return json(400, { error: 'displayName required' });
    const name = slugify(displayName);
    if (!name) return json(400, { error: 'displayName produced an empty slug' });

    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/js_profiles`, {
        method: 'POST',
        headers: {
          ...baseHeaders,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ name, display_name: displayName, user_email: USER_EMAIL }),
      });
      if (!res.ok) {
        const t = await res.text();
        // 23505 = unique violation (profile name already exists)
        if (res.status === 409 || t.includes('23505')) {
          return json(409, { error: `Profile "${name}" already exists` });
        }
        throw new Error(`Insert failed: ${res.status} ${t}`);
      }
      const rows = await res.json();
      return json(200, { profile: Array.isArray(rows) ? rows[0] : rows });
    } catch (e) {
      return json(500, { error: e.message });
    }
  }

  if (event.httpMethod === 'DELETE') {
    const name = (event.queryStringParameters?.name || '').toLowerCase();
    if (!name) return json(400, { error: 'name required' });
    if (name === 'jimmy') return json(400, { error: 'Cannot delete the default profile' });

    try {
      // Safety check — refuse if profile owns any data
      const [personasRes, tracksRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/js_personas?profile=eq.${encodeURIComponent(name)}&select=id&limit=1`, { headers: baseHeaders }),
        fetch(`${SUPABASE_URL}/rest/v1/js_tracks?profile=eq.${encodeURIComponent(name)}&select=id&limit=1`, { headers: baseHeaders }),
      ]);
      const hasPersonas = (await personasRes.json()).length > 0;
      const hasTracks = (await tracksRes.json()).length > 0;
      if (hasPersonas || hasTracks) {
        return json(400, { error: 'Profile has saved personas or tracks. Delete them first.' });
      }

      const delRes = await fetch(`${SUPABASE_URL}/rest/v1/js_profiles?name=eq.${encodeURIComponent(name)}`, {
        method: 'DELETE',
        headers: baseHeaders,
      });
      if (!delRes.ok) throw new Error(`Delete failed: ${delRes.status} ${await delRes.text()}`);
      return json(200, { ok: true });
    } catch (e) {
      return json(500, { error: e.message });
    }
  }

  return json(405, { error: 'GET, POST or DELETE only' });
};

function slugify(s) {
  return String(s).toLowerCase()
    .replace(/['"’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
