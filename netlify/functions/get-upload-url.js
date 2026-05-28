// POST /.netlify/functions/get-upload-url
// Body: { trackId, kind: 'audio' | 'image', mimeType }
// Returns: { signedUrl, token, tempPath, sunoAudioId, finalPath }
//
// Generates a one-time signed PUT URL the browser can upload directly to,
// bypassing the 6MB Netlify function body limit. The upload goes to a temp
// path; a separate finalize call processes it (re-embeds cover, moves to
// final path, updates DB).

const BUCKET = 'jamsounds-audio';
const USER_EMAIL = 'wcannon83@gmail.com';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: 'Invalid JSON' }); }
  const { trackId, kind, mimeType } = body;
  if (!trackId) return json(400, { error: 'trackId required' });
  if (kind !== 'audio' && kind !== 'image') return json(400, { error: 'kind must be audio or image' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const baseHeaders = {
    Authorization: `Bearer ${SERVICE_KEY}`,
    apikey: SERVICE_KEY,
  };

  try {
    // Look up suno_audio_id so we know the final storage path
    const lookupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/js_tracks?id=eq.${encodeURIComponent(trackId)}&user_email=eq.${encodeURIComponent(USER_EMAIL)}&select=suno_audio_id`,
      { headers: baseHeaders }
    );
    if (!lookupRes.ok) throw new Error(`Lookup failed: ${lookupRes.status}`);
    const rows = await lookupRes.json();
    if (!rows.length) return json(404, { error: 'Track not found' });
    const sunoAudioId = rows[0].suno_audio_id;

    // Final destination path the finalize step will write to
    let finalPath;
    if (kind === 'audio') {
      finalPath = `audio/${sunoAudioId}.mp3`;
    } else {
      // Normalize image extension based on mime type
      const ext = (mimeType || '').includes('png') ? 'png'
        : (mimeType || '').includes('webp') ? 'webp' : 'jpg';
      finalPath = `images/${sunoAudioId}.${ext}`;
    }

    // Temp path the browser uploads to first
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const tempExt = kind === 'audio' ? 'mp3' : finalPath.split('.').pop();
    const tempPath = `temp/${sunoAudioId}-${ts}-${rand}.${tempExt}`;

    // Request a signed upload URL for the temp path
    const signRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${tempPath}`,
      { method: 'POST', headers: baseHeaders }
    );
    if (!signRes.ok) {
      const t = await signRes.text();
      throw new Error(`Sign failed: ${signRes.status} ${t}`);
    }
    const signData = await signRes.json();
    // signData.url is a path like "/object/upload/sign/{bucket}/{path}?token=..."
    const signedUrl = `${SUPABASE_URL}/storage/v1${signData.url}`;

    return json(200, {
      signedUrl,
      token: signData.token,
      tempPath,
      finalPath,
      sunoAudioId,
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
