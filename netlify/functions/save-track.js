// POST /.netlify/functions/save-track
// Downloads the Suno MP3 (and cover image), uploads to Supabase Storage, inserts a row in js_tracks.
// This is critical because Suno deletes files after 15 days.

const { createClient } = require('@supabase/supabase-js');

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

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    // 1. Download audio from Suno
    const audioRes = await fetch(suno_audio_url);
    if (!audioRes.ok) throw new Error(`Failed to download audio (${audioRes.status})`);
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

    // 2. Upload to Supabase Storage
    const audioPath = `audio/${suno_audio_id}.mp3`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(audioPath, audioBuffer, {
      contentType: 'audio/mpeg',
      upsert: true,
    });
    if (upErr) throw new Error(`Audio upload failed: ${upErr.message}`);

    const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(audioPath);
    const storage_audio_url = publicData.publicUrl;

    // 3. (Best-effort) upload cover image
    let storage_image_url = null;
    if (image_url) {
      try {
        const imgRes = await fetch(image_url);
        if (imgRes.ok) {
          const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
          const imgPath = `images/${suno_audio_id}.jpg`;
          const { error: imgErr } = await supabase.storage.from(BUCKET).upload(imgPath, imgBuffer, {
            contentType: 'image/jpeg',
            upsert: true,
          });
          if (!imgErr) {
            const { data: imgPublic } = supabase.storage.from(BUCKET).getPublicUrl(imgPath);
            storage_image_url = imgPublic.publicUrl;
          }
        }
      } catch (e) {
        // non-fatal
        console.warn('image upload skipped:', e.message);
      }
    }

    // 4. Insert row
    const { data: row, error: insErr } = await supabase
      .from('js_tracks')
      .insert({
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
      })
      .select()
      .single();

    if (insErr) throw new Error(`DB insert failed: ${insErr.message}`);

    return json(200, { track: row });
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
