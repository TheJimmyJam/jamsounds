// POST /.netlify/functions/finalize-replace
// Body: { trackId, kind: 'audio'|'image', tempPath, finalPath, duration? }
//
// After the browser PUTs the new file to a temp path via a signed URL, this
// function processes it:
//   - audio: re-embeds the existing cover into the new MP3's ID3 tags, moves
//     it to the final path, updates DB duration, deletes temp.
//   - image: moves to final path, re-fetches the existing audio, re-embeds
//     the new cover into it so downloads carry the new art, updates DB
//     image_url if extension changed, deletes temp.

const NodeID3 = require('node-id3');

const BUCKET = 'jamsounds-audio';
const USER_EMAIL = 'wcannon83@gmail.com';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: 'Invalid JSON' }); }
  const { trackId, kind, tempPath, finalPath, duration } = body;
  if (!trackId || !kind || !tempPath || !finalPath) {
    return json(400, { error: 'trackId, kind, tempPath, finalPath required' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const baseHeaders = {
    Authorization: `Bearer ${SERVICE_KEY}`,
    apikey: SERVICE_KEY,
  };
  const storageUpload = async (path, buf, contentType) => {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { ...baseHeaders, 'Content-Type': contentType, 'x-upsert': 'true' },
      body: buf,
    });
    if (!res.ok) throw new Error(`Upload to ${path} failed: ${res.status} ${await res.text()}`);
  };
  const storageDownload = async (path) => {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      headers: baseHeaders,
    });
    if (!res.ok) throw new Error(`Download from ${path} failed: ${res.status}`);
    return { buf: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || '' };
  };
  const storageDelete = async (paths) => {
    try {
      await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
        method: 'DELETE',
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: paths }),
      });
    } catch (e) { console.warn('temp cleanup failed:', e.message); }
  };
  const externalDownload = async (url) => {
    if (!url) return null;
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      return { buf: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') || '' };
    } catch { return null; }
  };

  try {
    // Look up current track info
    const lookupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/js_tracks?id=eq.${encodeURIComponent(trackId)}&user_email=eq.${encodeURIComponent(USER_EMAIL)}&select=suno_audio_id,title,image_url,storage_audio_url`,
      { headers: baseHeaders }
    );
    if (!lookupRes.ok) throw new Error(`Lookup failed: ${lookupRes.status}`);
    const rows = await lookupRes.json();
    if (!rows.length) return json(404, { error: 'Track not found' });
    const track = rows[0];

    // Download the just-uploaded temp file
    const temp = await storageDownload(tempPath);

    if (kind === 'audio') {
      // Try to fetch the existing cover so we can re-embed it
      const cover = await externalDownload(track.image_url);
      let audioBuf = temp.buf;
      try {
        const tags = {
          title: track.title || 'Untitled',
          artist: 'JamSounds',
          album: track.title || 'JamSounds',
        };
        if (cover && cover.buf) {
          const ct = (cover.contentType || '').toLowerCase();
          const mime = ct.includes('png') ? 'image/png'
            : ct.includes('webp') ? 'image/webp' : 'image/jpeg';
          tags.image = {
            mime,
            type: { id: 3, name: 'front cover' },
            description: 'Cover (front)',
            imageBuffer: cover.buf,
          };
        }
        const tagged = NodeID3.write(tags, audioBuf);
        if (Buffer.isBuffer(tagged)) audioBuf = tagged;
      } catch (e) {
        console.warn('ID3 re-embed failed, uploading untagged audio:', e.message);
      }

      // Upload tagged audio to the final path (overwrites old MP3 at same URL)
      await storageUpload(finalPath, audioBuf, 'audio/mpeg');

      // Update DB — duration if provided, plus refresh timestamp
      const patch = { updated_at: new Date().toISOString() };
      if (duration && !Number.isNaN(Number(duration))) patch.duration = Number(duration);
      const patchRes = await fetch(
        `${SUPABASE_URL}/rest/v1/js_tracks?id=eq.${encodeURIComponent(trackId)}`,
        {
          method: 'PATCH',
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }
      );
      if (!patchRes.ok) {
        // updated_at may not exist as a column — try without it
        await fetch(`${SUPABASE_URL}/rest/v1/js_tracks?id=eq.${encodeURIComponent(trackId)}`, {
          method: 'PATCH',
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(duration ? { duration: Number(duration) } : {}),
        }).catch(() => {});
      }

      // Clean up temp
      await storageDelete([tempPath]);
      return json(200, { ok: true, kind, finalUrl: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${finalPath}` });
    }

    if (kind === 'image') {
      // 1. Upload the new image at the final path (overwrites if same extension)
      const imgMime = temp.contentType.includes('png') ? 'image/png'
        : temp.contentType.includes('webp') ? 'image/webp' : 'image/jpeg';
      await storageUpload(finalPath, temp.buf, imgMime);

      // 2. If the old image was at a different extension, delete it
      const oldImagePath = track.image_url && track.image_url.includes(`/${BUCKET}/`)
        ? track.image_url.split(`/${BUCKET}/`)[1]
        : null;
      if (oldImagePath && oldImagePath !== finalPath) {
        await storageDelete([oldImagePath]);
      }

      const newImageUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${finalPath}`;

      // 3. Re-embed the new cover into the existing MP3 so downloads carry it
      try {
        const audioPath = `audio/${track.suno_audio_id}.mp3`;
        const audio = await storageDownload(audioPath);
        const tags = {
          title: track.title || 'Untitled',
          artist: 'JamSounds',
          album: track.title || 'JamSounds',
          image: {
            mime: imgMime,
            type: { id: 3, name: 'front cover' },
            description: 'Cover (front)',
            imageBuffer: temp.buf,
          },
        };
        const tagged = NodeID3.write(tags, audio.buf);
        if (Buffer.isBuffer(tagged)) {
          await storageUpload(audioPath, tagged, 'audio/mpeg');
        }
      } catch (e) {
        console.warn('Re-embed into existing audio failed:', e.message);
      }

      // 4. Update DB image_url
      await fetch(`${SUPABASE_URL}/rest/v1/js_tracks?id=eq.${encodeURIComponent(trackId)}`, {
        method: 'PATCH',
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: newImageUrl }),
      });

      // 5. Clean up temp
      await storageDelete([tempPath]);
      return json(200, { ok: true, kind, finalUrl: newImageUrl });
    }

    return json(400, { error: 'Invalid kind' });
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
