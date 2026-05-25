// POST /.netlify/functions/sounds-like
// Body: { query: string }   e.g. "Dylan LeBlanc - Coyote" or just "Coyote Dylan LeBlanc"
// Returns: { style, vocalGender, reference: { name, artist, album, lastfmUrl, tags, similar }, notes }
// Uses Last.fm to look up real song metadata, then Claude Haiku to translate into a Suno style string.

const LFM = 'http://ws.audioscrobbler.com/2.0/';

const SYSTEM_PROMPT = `You are a music director. Given real metadata about a reference song (tags, genres, similar artists, bio), produce a Suno-compatible style string that captures the song's musical feel.

The user wants their generated song to "sound like" the reference. So describe:
- Genre and subgenre (be specific — not "folk" but "intimate Americana folk")
- Instrumentation (acoustic guitar fingerpicking, brushed drums, Wurlitzer, etc.)
- Tempo (rough BPM, e.g. 75 BPM for a ballad)
- Vocal feel (warm baritone, breathy female, etc.)
- Production feel (analog warmth, lo-fi, lush reverb, dry/intimate)

Output ONLY this JSON:
{
  "style": "<5-10 specific Suno descriptors, comma-separated, including tempo>",
  "vocalGender": "<empty OR 'm' OR 'f' if the reference has a clear vocal gender>",
  "notes": "<one short sentence about what you keyed on>"
}

Use your musical knowledge to fill gaps — if you know the reference song, lean on that. If only genre tags are provided, infer typical instrumentation for that genre.`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: 'Invalid JSON' }); }

  const query = (body.query || '').trim();
  if (!query) return json(400, { error: 'query required' });

  const LFM_KEY = process.env.LASTFM_API_KEY;
  if (!LFM_KEY) return json(500, { error: 'LASTFM_API_KEY not set' });

  try {
    // 1. Search for the track
    const searchUrl = `${LFM}?method=track.search&track=${encodeURIComponent(query)}&api_key=${LFM_KEY}&format=json&limit=1`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    const top = searchData.results?.trackmatches?.track;
    const match = Array.isArray(top) ? top[0] : top;
    if (!match || !match.name) return json(404, { error: 'No track matched on Last.fm', query });

    const trackName = match.name;
    const artistName = match.artist;
    const lastfmUrl = match.url;

    // 2. Track + artist details in parallel
    const [infoRes, artistRes] = await Promise.all([
      fetch(`${LFM}?method=track.getInfo&track=${encodeURIComponent(trackName)}&artist=${encodeURIComponent(artistName)}&api_key=${LFM_KEY}&format=json`),
      fetch(`${LFM}?method=artist.getInfo&artist=${encodeURIComponent(artistName)}&api_key=${LFM_KEY}&format=json`),
    ]);
    const infoData = await infoRes.json();
    const artistData = await artistRes.json();

    const trackTags = (infoData.track?.toptags?.tag || []).map(t => t.name);
    const album = infoData.track?.album?.title || null;
    const wiki = infoData.track?.wiki?.summary || null;

    const artistTags = (artistData.artist?.tags?.tag || []).map(t => t.name);
    const similar = (artistData.artist?.similar?.artist || []).map(a => a.name);
    const artistBio = artistData.artist?.bio?.summary || null;

    // 3. Build description for Claude
    const description = `Reference song: "${trackName}" by ${artistName}
Album: ${album || 'unknown'}
Track tags: ${trackTags.length ? trackTags.join(', ') : '(none)'}
Artist genres/tags: ${artistTags.length ? artistTags.join(', ') : '(none)'}
Similar artists: ${similar.length ? similar.slice(0, 6).join(', ') : '(none)'}
${artistBio ? `Artist context: ${artistBio.replace(/<[^>]*>/g, '').slice(0, 300)}` : ''}

Translate this into a Suno style string. Return JSON only.`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: description }],
      }),
    });
    const claudeData = await claudeRes.json();
    if (!claudeRes.ok) {
      return json(claudeRes.status, { error: claudeData.error?.message || 'Anthropic error' });
    }
    const text = claudeData.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { style: '', vocalGender: '', notes: '' };

    return json(200, {
      style: parsed.style || '',
      vocalGender: parsed.vocalGender || '',
      notes: parsed.notes || '',
      reference: {
        name: trackName,
        artist: artistName,
        album,
        lastfmUrl,
        tags: artistTags,
        similar: similar.slice(0, 5),
      },
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
