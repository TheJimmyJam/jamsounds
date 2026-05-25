// POST /.netlify/functions/save-track
// Downloads the Suno MP3 (and cover image), embeds the cover into the MP3's
// ID3v2 tags so it travels with the file (Apple Music, Spotify, Files, VLC
// etc. all show it when playing). Then uploads the tagged MP3 + the image
// separately to Supabase Storage, and inserts a row in js_tracks.

const NodeID3 = require('node-id3');

const BUCKET = 'jamsounds-audio';
const USER_EMAIL = 'wcannon83@gmail.com'; // single-user app for now

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: 'Invalid JSON' }); }

  const {
    suno_audio_id,
    suno_task_id,
    suno_audio_url,
    title,
    style,
    prompt,
    model,
    instrumental,
    duration,
    image_url,
    tags,
    project_brief,
    music_brief,
  } = body;

  if (!suno_audio_url || !suno_audio_id) {
    return json(400, { error: 'suno_audio_url and suno_audio_id required' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    // 1. Download audio from Suno
    const audioRes = await fetch(suno_audio_url);
    if (!audioRes.ok) throw new Error(`Failed to download audio (${audioRes.status})`);
    let audioBuffer = Buffer.from(await audioRes.arrayBuffer());

    // 2. (Best-effort) download cover image — used both for embedding into the
    //    MP3's ID3 tag AND uploaded separately to Storage for the UI.
    let imgBuffer = null;
    let imgMime = 'image/jpeg';
    if (image_url) {
      try {
        const imgRes = await fetch(image_url);
        if (imgRes.ok) {
          imgBuffer = Buffer.from(await imgRes.arrayBuffer());
          const ct = (imgRes.headers.get('content-type') || '').toLowerCase();
          if (ct.includes('png')) imgMime = 'image/png';
          else if (ct.includes('webp')) imgMime = 'image/webp';
        }
      } catch (e) {
        console.warn('image fetch skipped:', e.message);
      }
    }

    // 3. Embed ID3v2 tags (title, artist, album, cover art) into the MP3 buffer
    //    so the cover travels with the file when downloaded/texted.
    try {
      const tags = {
        title: title || 'Untitled',
        artist: 'JamSounds',
        album: title || 'JamSounds',
      };
      if (imgBuffer) {
        tags.image = {
          mime: imgMime,
          type: { id: 3, name: 'front cover' },
          description: 'Cover (front)',
          imageBuffer: imgBuffer,
        };
      }
      const tagged = NodeID3.write(tags, audioBuffer);
      if (Buffer.isBuffer(tagged)) audioBuffer = tagged;
    } catch (e) {
      console.warn('ID3 embed failed, uploading untagged audio:', e.message);
    }

    // 4. Upload audio (now with cover embedded) to Supabase Storage
    const audioPath = `audio/${suno_audio_id}.mp3`;
    const upRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${audioPath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        'Content-Type': 'audio/mpeg',
        'x-upsert': 'true',
      },
      body: audioBuffer,
    });
    if (!upRes.ok) {
      const t = await upRes.text();
      throw new Error(`Audio upload failed: ${upRes.status} ${t}`);
    }

    const storage_audio_url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${audioPath}`;

    // 5. (Best-effort) upload the cover image separately too, so the UI can
    //    render it without parsing ID3 tags.
    let storage_image_url = null;
    if (imgBuffer) {
      try {
        const ext = imgMime === 'image/png' ? 'png' : (imgMime === 'image/webp' ? 'webp' : 'jpg');
        const imgPath = `images/${suno_audio_id}.${ext}`;
        const imgUp = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${imgPath}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${SERVICE_KEY}`,
            apikey: SERVICE_KEY,
            'Content-Type': imgMime,
            'x-upsert': 'true',
          },
          body: imgBuffer,
        });
        if (imgUp.ok) {
          storage_image_url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${imgPath}`;
        }
      } catch (e) {
        console.warn('image upload skipped:', e.message);
      }
    }

    // 4. Insert row via PostgREST
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/js_tracks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        user_email: USER_EMAIL,
        project_brief: project_brief || null,
        music_brief: music_brief || null,
        suno_task_id,
        suno_audio_id,
        title,
        style,
        prompt,
        model,
        instrumental: !!instrumental,
        duration,
        suno_audio_url,
        storage_audio_url,
        image_url: storage_image_url || image_url || null,
        tags,
        saved: true,
      }),
    });

    if (!insertRes.ok) {
      const t = await insertRes.text();
      throw new Error(`DB insert failed: ${insertRes.status} ${t}`);
    }

    const rows = await insertRes.json();
    return json(200, { track: Array.isArray(rows) ? rows[0] : rows });
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
