// GET  /.netlify/functions/list-tracks         → list saved tracks
// DELETE /.netlify/functions/list-tracks?id=…  → delete a saved track (and its storage objects)

const { createClient } = require('@supabase/supabase-js');

const BUCKET = 'jamsounds-audio';
const USER_EMAIL = 'wcannon83@gmail.com';

exports.handler = async (event) => {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  if (event.httpMethod === 'GET') {
    try {
      const { data, error } = await supabase
        .from('js_tracks')
        .select('*')
        .eq('user_email', USER_EMAIL)
        .eq('saved', true)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return json(200, { tracks: data });
    } catch (e) {
      return json(500, { error: e.message });
    }
  }

  if (event.httpMethod === 'DELETE') {
    const id = event.queryStringParameters?.id;
    if (!id) return json(400, { error: 'id required' });
    try {
      // Find the row first to know which storage objects to remove
      const { data: row } = await supabase.from('js_tracks').select('*').eq('id', id).single();

      if (row?.suno_audio_id) {
        await supabase.storage.from(BUCKET).remove([
          `audio/${row.suno_audio_id}.mp3`,
          `images/${row.suno_audio_id}.jpg`,
        ]);
      }

      const { error } = await supabase.from('js_tracks').delete().eq('id', id);
      if (error) throw new Error(error.message);
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
