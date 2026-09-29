// POST /.netlify/functions/publish-to-jamplays
// Publishes a JamSounds library track into an existing JamPlays record.
//
// JamPlays is gated, so a song is not a file in the album folder any more:
//   - the audio goes to jamplays-private/<slug>/ in the PRIVATE R2 bucket
//     ccc-files (it was a private Supabase bucket until 2026-09-28)
//     (never the repo — the site publishes the repo root, past every grant)
//   - the track, its version and its words go into netlify/data/<slug>.json
//   - the song art goes to <slug>/song-art/ in the repo, like the others
//   - the card's "N songs" in assets/catalog.js is kept true
// The repo changes go in one commit, so Netlify builds once. The audio is
// uploaded first, so the manifest never names a file that isn't there.
//
// Request body shape:
// {
//   trackId,                       // js_tracks.id
//   albumSlug,                     // an album from list-jamplays-albums
//   position: { mode: 'append'|'insert'|'replace', n?: 1-based },
//   displayTitle,                  // editable, defaults to track title
//   trackType?,                    // '(duet)' | '(instrumental)' | ''
//   voice?,                        // version key; needed only on a his-and-hers album
//   lyrics?,                       // editable, defaults to music_brief.prompt
//   dryRun?,                       // true: plan everything, write nothing
// }
//
// New albums are refused: a JamPlays record also needs a gate entry, a
// catalog card and its own player page, which are built in the JamPlays repo.

const NodeID3 = require('node-id3');
const JP = require('../lib/jamplays');

const { denyUnlessOwner } = require('../lib/owner');
const r2 = require('../lib/ccc-r2');

exports.handler = async (event) => {
  const denied = denyUnlessOwner(event);
  if (denied) return denied;

  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: 'Invalid JSON' }); }
  const { trackId, albumSlug, newAlbum, position, displayTitle, trackType, voice, lyrics } = body;
  const dryRun = body.dryRun === true;

  if (!trackId) return json(400, { error: 'trackId required' });
  if (newAlbum) {
    return json(400, { error: 'New JamPlays albums are made in the JamPlays repo (gate entry, catalog card, player page). Create it there, then publish into it.' });
  }
  if (!albumSlug) return json(400, { error: 'albumSlug required' });
  if (!position || !position.mode) return json(400, { error: 'position.mode required' });
  if (!displayTitle) return json(400, { error: 'displayTitle required' });

  const token = process.env.GITHUB_PAT;
  // JamPlays' bucket and grants live in the same Supabase project as
  // JamSounds; the JAMPLAYS_* names win if the two are ever split.
  const SUPABASE_URL = (process.env.JAMPLAYS_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const SERVICE_KEY = process.env.JAMPLAYS_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token) return json(500, { error: 'GITHUB_PAT env not set' });
  if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: 'Supabase env not set' });

  const sbHeaders = { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY };
  const gh = JP.github(token);
  const { GH_OWNER, GH_REPO, GH_BRANCH } = JP;

  try {
    // 1. Look up the track row
    const lookupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/js_tracks?id=eq.${encodeURIComponent(trackId)}&select=*`,
      { headers: sbHeaders }
    );
    if (!lookupRes.ok) throw new Error('track lookup failed');
    const rows = await lookupRes.json();
    if (!rows.length) return json(404, { error: 'Track not found' });
    const track = rows[0];
    const audioUrl = track.storage_audio_url || track.suno_audio_url;
    if (!audioUrl) return json(400, { error: 'Track has no audio URL' });

    // 2. The album as JamPlays has it now
    const records = await JP.loadRecords(gh);
    const album = records.albums.find((a) => a.slug === albumSlug);
    if (!album) return json(400, { error: `"${albumSlug}" is not a JamPlays album JamSounds can publish into` });
    const [dataSrc, pageHtml] = await Promise.all([
      gh.text(`netlify/data/${albumSlug}.json`),
      gh.text(`${albumSlug}/index.html`, { optional: true }),
    ]);

    // 3. Cover art, which decides whether the song gets art of its own
    let coverBuf = null;
    let coverMime = 'image/png';
    if (track.image_url) {
      try {
        const cr = await fetch(track.image_url);
        if (cr.ok) {
          coverBuf = Buffer.from(await cr.arrayBuffer());
          const ct = (cr.headers.get('content-type') || '').toLowerCase();
          coverMime = ct.includes('jpeg') || ct.includes('jpg') ? 'image/jpeg' : 'image/png';
        }
      } catch (e) { console.warn('cover fetch failed:', e.message); }
    }

    // 4. Plan the change
    let plan;
    try {
      plan = JP.planPublish({
        slug: albumSlug,
        data: JSON.parse(dataSrc),
        dataSrc,
        catalogSrc: records.catalogSrc,
        html: pageHtml,
        position,
        displayTitle,
        trackType,
        voice,
        lyrics,
        seconds: Number(track.duration) || null,
        artExt: coverBuf ? (coverMime === 'image/jpeg' ? 'jpg' : 'png') : null,
      });
    } catch (e) {
      return json(e.status || 500, { error: e.message });
    }

    // A song-scoped share names its songs by number. Moving or replacing a
    // number someone was given would quietly hand them a different song.
    if (plan.affectedNs.length) {
      const gr = await fetch(
        `${SUPABASE_URL}/rest/v1/jamplays_grants?album=eq.${encodeURIComponent(albumSlug)}&select=id,label,scope,revoked,expires_at`,
        { headers: sbHeaders }
      );
      if (!gr.ok) throw new Error(`share lookup failed: ${gr.status}`);
      const conflicts = JP.shareConflicts(await gr.json(), plan.affectedNs);
      if (conflicts.length) {
        const who = conflicts.map((g) => g.label || 'a share').join(', ');
        return json(409, { error: `That would change which song ${who} was given (by track number). Append instead, or change the share in JamPlays admin first.` });
      }
    }

    const summary = {
      slug: albumSlug,
      mode: plan.mode,
      track: { n: plan.entry.n, title: plan.title, voice: plan.voice },
      replaced: plan.replaced ? { n: plan.replaced.n, title: plan.replaced.title } : null,
      renumbered: plan.mode === 'replace' ? [] : plan.affectedNs,
      trackCount: plan.data.tracks.length,
      audio: `${JP.BUCKET}/${plan.audioKey}`,
      repoFiles: [`netlify/data/${albumSlug}.json`, ...(plan.artPath ? [plan.artPath] : []),
        ...(plan.catalogSrc !== records.catalogSrc ? ['assets/catalog.js'] : [])],
      url: `${JP.SITE}/${albumSlug}/`,
    };
    if (dryRun) return json(200, { ok: true, dryRun: true, ...summary });

    // 5. Tag the audio (title, artist, album, cover) and put it in the bucket
    const audioBuf = Buffer.from(await (await fetch(audioUrl)).arrayBuffer());
    let taggedAudio = audioBuf;
    try {
      const tags = { title: displayTitle, artist: 'JamSounds', album: album.name };
      if (coverBuf) {
        tags.image = {
          mime: coverMime,
          type: { id: 3, name: 'front cover' },
          description: 'Cover (front)',
          imageBuffer: coverBuf,
        };
      }
      const out = NodeID3.write(tags, audioBuf);
      if (Buffer.isBuffer(out)) taggedAudio = out;
    } catch (e) {
      console.warn('id3 embed failed:', e.message);
    }
    const sameKey = plan.replaced && plan.replaced.files.some((f) => f.split('/').pop() === plan.audioKey.split('/').pop());
    // R2 always overwrites, so the old no-upsert refusal is checked by hand.
    const audioKey = r2.keyFor(JP.BUCKET, plan.audioKey);
    if (!sameKey && await r2.head(audioKey)) throw new Error(`audio upload failed: ${audioKey} already exists`);
    await r2.put(audioKey, taggedAudio, 'audio/mpeg');

    // 6. One commit: manifest, song art, catalog count
    const blobs = [];
    const pushBlob = async (path, content, isBinary) => {
      const blob = await gh.api('POST', `/repos/${GH_OWNER}/${GH_REPO}/git/blobs`, {
        content: isBinary ? content.toString('base64') : content,
        encoding: isBinary ? 'base64' : 'utf-8',
      });
      blobs.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    };
    await pushBlob(`netlify/data/${albumSlug}.json`, plan.dataJson, false);
    if (plan.artPath) await pushBlob(plan.artPath, coverBuf, true);
    if (plan.catalogSrc !== records.catalogSrc) await pushBlob('assets/catalog.js', plan.catalogSrc, false);

    const refData = await gh.api('GET', `/repos/${GH_OWNER}/${GH_REPO}/git/ref/heads/${GH_BRANCH}`);
    const baseCommitSha = refData.object.sha;
    const baseCommit = await gh.api('GET', `/repos/${GH_OWNER}/${GH_REPO}/git/commits/${baseCommitSha}`);
    const newTree = await gh.api('POST', `/repos/${GH_OWNER}/${GH_REPO}/git/trees`, {
      base_tree: baseCommit.tree.sha,
      tree: blobs,
    });
    const verb = plan.mode === 'replace' ? 'replace' : (plan.mode === 'append' ? 'add' : 'insert');
    const newCommit = await gh.api('POST', `/repos/${GH_OWNER}/${GH_REPO}/git/commits`, {
      message: `JamPlays: ${verb} "${plan.title}" in ${albumSlug} (from JamSounds)`,
      tree: newTree.sha,
      parents: [baseCommitSha],
    });
    await gh.api('PATCH', `/repos/${GH_OWNER}/${GH_REPO}/git/refs/heads/${GH_BRANCH}`, {
      sha: newCommit.sha,
      force: false,
    });

    return json(200, { ok: true, ...summary, commit: newCommit.sha.slice(0, 7) });
  } catch (e) {
    return json(500, { error: e.message });
  }
};

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
