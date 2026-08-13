// POST /.netlify/functions/create-persona
//
// Two modes:
//
// A) Mint a style Persona from a generated track (the original behaviour):
//    Body: { taskId, audioId, name, description, vocalStart?, vocalEnd?, sourceTrackId?, profile? }
//    Calls /api/v1/generate/generate-persona, then persists the personaId.
//
// B) Register an existing Suno Voice:
//    Body: { voiceId, name, description?, profile? }
//    Suno Voices can NOT be minted through the API — creating one requires recording
//    a challenge phrase live in Suno's own app, which is the anti-impersonation check.
//    So we don't call Suno here at all; we store the voiceId you paste in and send it
//    back as personaId + personaModel='voice_persona' at generation time.
//
// Returns: { persona: <row> }

const USER_EMAIL = 'wcannon83@gmail.com';
const DEFAULT_PROFILE = 'jimmy';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: 'Invalid JSON' }); }

  const {
    taskId,
    audioId,
    voiceId,
    name,
    description,
    vocalStart,
    vocalEnd,
    sourceTrackId,
    profile,
  } = body;
  const profileName = (profile || DEFAULT_PROFILE).toLowerCase();

  if (!name) return json(400, { error: 'name required' });

  // ---------- Mode B: register an existing Suno Voice ----------
  if (voiceId) {
    return persistPersona({
      profileName,
      personaId: voiceId.trim(),
      personaModel: 'voice_persona',
      name,
      description: description || 'Suno Voice',
      sourceTrackId: sourceTrackId || null,
      audioId: null,
      taskId: null,
      vocalStart: null,
      vocalEnd: null,
    });
  }

  // ---------- Mode A: mint a style Persona from a generated track ----------
  if (!taskId || !audioId) return json(400, { error: 'taskId and audioId required (or voiceId to register a Suno Voice)' });
  if (!description) return json(400, { error: 'description required (Suno requires it)' });

  // Suno requires the segment length to be 10–30 seconds.
  if (vocalStart != null && vocalEnd != null) {
    const len = vocalEnd - vocalStart;
    if (len < 10 || len > 30) {
      return json(400, { error: 'vocalEnd - vocalStart must be between 10 and 30 seconds' });
    }
  }

  const sunoPayload = { taskId, audioId, name, description };
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

    return persistPersona({
      profileName,
      personaId,
      personaModel: 'style_persona',
      name,
      description,
      sourceTrackId: sourceTrackId || null,
      audioId,
      taskId,
      vocalStart: vocalStart ?? null,
      vocalEnd: vocalEnd ?? null,
    });
  } catch (e) {
    return json(500, { error: e.message });
  }
};

/** Inserts the persona row into Supabase and returns the handler response. */
async function persistPersona(p) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
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
        profile: p.profileName,
        persona_id: p.personaId,
        name: p.name,
        description: p.description,
        source_track_id: p.sourceTrackId,
        source_suno_audio_id: p.audioId,
        source_suno_task_id: p.taskId,
        vocal_start: p.vocalStart,
        vocal_end: p.vocalEnd,
        persona_model: p.personaModel,
      }),
    });

    if (!insertRes.ok) {
      const t = await insertRes.text();
      // For style personas Suno has already billed for the mint, so return the ID
      // rather than swallowing it — the user shouldn't have to pay twice because
      // our DB write failed.
      return json(500, {
        error: `Persona created but DB insert failed: ${insertRes.status} ${t}`,
        personaId: p.personaId,
      });
    }

    const rows = await insertRes.json();
    return json(200, { persona: Array.isArray(rows) ? rows[0] : rows });
  } catch (e) {
    return json(500, { error: e.message, personaId: p.personaId });
  }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
