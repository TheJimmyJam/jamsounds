// POST /.netlify/functions/create-persona
// Body: { taskId, audioId, name, description, vocalStart?, vocalEnd?, sourceTrackId? }
// 1. Calls sunoapi.org's /api/v1/generate/generate-persona to mint a Suno personaId.
// 2. Persists the result in public.js_personas so the frontend can reuse it.
// Returns: { persona: <row> }

const USER_EMAIL = 'wcannon83@gmail.com';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: 'Invalid JSON' }); }

  const {
    taskId,
    audioId,
    name,
    description,
    vocalStart,
    vocalEnd,
    sourceTrackId,
  } = body;

  if (!taskId || !audioId) return json(400, { error: 'taskId and audioId required' });
  if (!name) return json(400, { error: 'name required' });
  if (!description) return json(400, { error: 'description required (Suno requires it)' });

  // Suno requires the segment length to be 10–30 seconds.
  if (vocalStart != null && vocalEnd != null) {
    const len = vocalEnd - vocalStart;
    if (len < 10 || len > 30) {
      return json(400, { error: 'vocalEnd - vocalStart must be between 10 and 30 seconds' });
    }
  }

  // 1. Hit Suno's persona endpoint.
  const sunoPayload = {
    taskId,
    audioId,
    name,
    description,
  };
  if (vocalStart != null) sunoPayload.vocalStart = vocalStart;
  if (vocalEnd != null) sunoPayload.vocalEnd = vocalEnd;

  try {
    const sunoRes = await fetch('https://api.sunoapi.org/api/v1/generate/generate-persona', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUNO_API_KEY}`,
      },
      body: JSON.stringify(sunoPayload),
    });
    const sunoData = await sunoRes.json();
    if (sunoData.code !== 200) {
      return json(sunoRes.ok ? 500 : sunoRes.status, {
        error: sunoData.msg || 'Suno error',
        code: sunoData.code,
        raw: sunoData,
      });
    }

    const personaId = sunoData.data?.personaId;
    if (!personaId) {
      return json(500, { error: 'Suno did not return personaId', raw: sunoData });
    }

    // 2. Persist to Supabase.
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/js_personas`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        user_email: USER_EMAIL,
        persona_id: personaId,
        name,
        description,
        source_track_id: sourceTrackId || null,
        source_suno_audio_id: audioId,
        source_suno_task_id: taskId,
        vocal_start: vocalStart ?? null,
        vocal_end: vocalEnd ?? null,
        persona_model: 'style_persona',
      }),
    });

    if (!insertRes.ok) {
      const t = await insertRes.text();
      // Suno already minted the persona — return it so the user isn't billed again,
      // but flag the DB failure so they know it's not saved locally.
      return json(500, {
        error: `Persona minted by Suno but DB insert failed: ${insertRes.status} ${t}`,
        personaId,
      });
    }

    const rows = await insertRes.json();
    return json(200, { persona: Array.isArray(rows) ? rows[0] : rows });
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
