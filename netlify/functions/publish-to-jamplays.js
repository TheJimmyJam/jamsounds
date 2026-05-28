// POST /.netlify/functions/publish-to-jamplays
// Publishes a JamSounds library track to a JamPlays album. Handles:
//   - Appending, inserting at position N (with file renames), or replacing at N
//   - Creating brand-new albums (scaffolds folder + updates root landing page)
//   - All changes go in a single GitHub commit so Netlify builds once
//
// Request body shape:
// {
//   trackId,                       // js_tracks.id
//   albumSlug?,                    // pick existing album by slug
//   newAlbum?: { name, year?, description?, useTrackCoverAsAlbumCover? },
//   position: { mode: 'append'|'insert'|'replace', n?: 1-based },
//   displayTitle,                  // editable, defaults to track title
//   trackType?,                    // '(duet)' | '(instrumental)' | ''
//   lyrics?,                       // editable, defaults to music_brief.prompt
// }

const NodeID3 = require('node-id3');

// Track id is globally unique (uuid) — no need to scope by user_email or profile here.
const GH_OWNER = 'TheJimmyJam';
const GH_REPO = 'jamplays';
const GH_BRANCH = 'main';
const TEMPLATE_ALBUM = 'fantasyland-population-1'; // copied as scaffold for new albums

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: 'Invalid JSON' }); }
  const { trackId, albumSlug, newAlbum, position, displayTitle, trackType, lyrics } = body;

  if (!trackId) return json(400, { error: 'trackId required' });
  if (!albumSlug && !newAlbum) return json(400, { error: 'albumSlug or newAlbum required' });
  if (!position || !position.mode) return json(400, { error: 'position.mode required' });
  if (!displayTitle) return json(400, { error: 'displayTitle required' });

  const token = process.env.GITHUB_PAT;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token) return json(500, { error: 'GITHUB_PAT env not set' });

  const sbHeaders = { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY };
  const ghHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
  const gh = async (method, path, body) => {
    const res = await fetch(`https://api.github.com${path}`, {
      method, headers: ghHeaders, body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`GitHub ${method} ${path}: ${res.status} ${t}`);
    }
    return res.json();
  };
  const ghRaw = async (path) => {
    const r = await fetch(`https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error(`raw ${path}: ${r.status}`);
    return r;
  };

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

    // 2. Download audio + cover from Supabase Storage
    const audioUrl = track.storage_audio_url || track.suno_audio_url;
    const coverUrl = track.image_url;
    if (!audioUrl) return json(400, { error: 'Track has no audio URL' });
    const audioBuf = Buffer.from(await (await fetch(audioUrl)).arrayBuffer());
    let coverBuf = null;
    let coverMime = 'image/png';
    if (coverUrl) {
      try {
        const cr = await fetch(coverUrl);
        if (cr.ok) {
          coverBuf = Buffer.from(await cr.arrayBuffer());
          const ct = (cr.headers.get('content-type') || '').toLowerCase();
          coverMime = ct.includes('jpeg') || ct.includes('jpg') ? 'image/jpeg' : 'image/png';
        }
      } catch (e) { console.warn('cover fetch failed:', e.message); }
    }

    // 3. Resolve the album: either existing or new
    let targetSlug = albumSlug;
    let isNewAlbum = false;
    let currentTracks = [];
    let albumIndexHtml = null;

    if (newAlbum && newAlbum.name) {
      targetSlug = slugify(newAlbum.name);
      isNewAlbum = true;
      // Fetch template for cloning
      const templateRes = await ghRaw(`${TEMPLATE_ALBUM}/index.html`);
      albumIndexHtml = await templateRes.text();
    } else {
      // Existing album — fetch its index.html and parse TRACKS
      const idxRes = await ghRaw(`${targetSlug}/index.html`);
      albumIndexHtml = await idxRes.text();
      currentTracks = parseTracks(albumIndexHtml);
    }

    // 4. Compute final TRACKS array + file operations
    const fileSlug = slugify(displayTitle);
    const fullTitle = trackType ? `${displayTitle} ${trackType}` : displayTitle;
    const total = currentTracks.length;

    let insertAt; // 0-based index in array
    let replacing = false;
    if (position.mode === 'append' || isNewAlbum) {
      insertAt = total;
    } else if (position.mode === 'replace') {
      insertAt = (position.n || 1) - 1;
      if (insertAt < 0 || insertAt >= total) return json(400, { error: `Invalid replace position (album has ${total} tracks)` });
      replacing = true;
    } else if (position.mode === 'insert') {
      insertAt = Math.max(0, Math.min(total, (position.n || 1) - 1));
    } else {
      return json(400, { error: `Unknown position.mode: ${position.mode}` });
    }

    // Build the new track entry. File numbering is recomputed for every
    // affected track so file paths match playback order.
    const newEntry = {
      n: roman(insertAt + 1),
      title: fullTitle,
      file: `audio/${pad2(insertAt + 1)}-${fileSlug}.mp3`,
      art: `song-art/${pad2(insertAt + 1)}-${fileSlug}.png`,
    };

    // newTracks is the post-publish ordering
    let newTracks;
    if (replacing) {
      newTracks = [...currentTracks];
      newTracks[insertAt] = newEntry;
    } else {
      newTracks = [...currentTracks.slice(0, insertAt), newEntry, ...currentTracks.slice(insertAt)];
    }
    // Renumber n and file paths for every entry so display order = file order
    newTracks = newTracks.map((t, i) => {
      const slug = t === newEntry ? fileSlug : slugFromPath(t.file);
      return {
        n: roman(i + 1),
        title: t.title,
        file: `audio/${pad2(i + 1)}-${slug}.mp3`,
        art: `song-art/${pad2(i + 1)}-${slug}.png`,
        _origFile: t._origFile || (t === newEntry ? null : t.file),
        _origArt: t._origArt || (t === newEntry ? null : t.art),
      };
    });

    // 5. Update the album's index.html
    let updatedAlbumHtml = replaceTracksArray(albumIndexHtml, newTracks);
    updatedAlbumHtml = upsertLyric(updatedAlbumHtml, fullTitle, lyrics || '');
    updatedAlbumHtml = updateAlbumMetaCounts(updatedAlbumHtml, newTracks.length);

    if (isNewAlbum) {
      updatedAlbumHtml = retitleAlbumScaffold(updatedAlbumHtml, {
        name: newAlbum.name,
        slug: targetSlug,
        year: newAlbum.year || new Date().getFullYear(),
        description: newAlbum.description || `A ${newTracks.length}-song album by jamsounds.`,
      });
      // Reset LYRICS to only the new track's lyric
      updatedAlbumHtml = resetLyrics(updatedAlbumHtml, fullTitle, lyrics || '');
    }

    // 6. Re-tag audio MP3 with proper ID3 (title, artist, album, cover)
    let taggedAudio = audioBuf;
    try {
      const tags = {
        title: displayTitle,
        artist: 'JamSounds',
        album: isNewAlbum ? newAlbum.name : await albumTitleFromHtml(albumIndexHtml, targetSlug),
      };
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

    // 7. Collect all blobs to upload (audio, cover, renames)
    const blobs = [];
    const pushBlob = async (path, content, isBinary) => {
      const blob = await gh('POST', `/repos/${GH_OWNER}/${GH_REPO}/git/blobs`, {
        content: isBinary ? content.toString('base64') : content,
        encoding: isBinary ? 'base64' : 'utf-8',
      });
      blobs.push({ path: `${targetSlug}/${path}`, mode: '100644', type: 'blob', sha: blob.sha });
    };

    // The new track files (always at newEntry.file / newEntry.art positions)
    await pushBlob(newEntry.file, taggedAudio, true);
    if (coverBuf) await pushBlob(newEntry.art, coverBuf, true);

    // Rename: for every entry that moved positions, fetch its old file and
    // write it at the new path; collect old paths to delete.
    const toDelete = []; // paths relative to repo root
    for (const t of newTracks) {
      if (t === newEntry || (t._origFile == null)) continue;
      if (t._origFile === t.file && t._origArt === t.art) continue; // unchanged
      try {
        const audioOld = await ghRaw(`${targetSlug}/${t._origFile}`);
        const audioBufOld = Buffer.from(await audioOld.arrayBuffer());
        await pushBlob(t.file, audioBufOld, true);
        toDelete.push(`${targetSlug}/${t._origFile}`);
      } catch (e) { console.warn(`old audio fetch failed ${t._origFile}:`, e.message); }
      try {
        const artOld = await ghRaw(`${targetSlug}/${t._origArt}`);
        const artBufOld = Buffer.from(await artOld.arrayBuffer());
        await pushBlob(t.art, artBufOld, true);
        toDelete.push(`${targetSlug}/${t._origArt}`);
      } catch (e) { console.warn(`old art fetch failed ${t._origArt}:`, e.message); }
    }
    // If replacing, also delete the slot's old files (unless paths collided)
    if (replacing) {
      const original = currentTracks[insertAt];
      const replacedNew = newTracks[insertAt];
      if (original && original.file !== replacedNew.file) toDelete.push(`${targetSlug}/${original.file}`);
      if (original && original.art !== replacedNew.art) toDelete.push(`${targetSlug}/${original.art}`);
    }

    // The updated album index.html
    {
      const blob = await gh('POST', `/repos/${GH_OWNER}/${GH_REPO}/git/blobs`, {
        content: updatedAlbumHtml, encoding: 'utf-8',
      });
      blobs.push({ path: `${targetSlug}/index.html`, mode: '100644', type: 'blob', sha: blob.sha });
    }

    // For new albums: also upload an album-level cover.png AND update root index.html
    if (isNewAlbum) {
      if (coverBuf) {
        const blob = await gh('POST', `/repos/${GH_OWNER}/${GH_REPO}/git/blobs`, {
          content: coverBuf.toString('base64'), encoding: 'base64',
        });
        blobs.push({ path: `${targetSlug}/cover.png`, mode: '100644', type: 'blob', sha: blob.sha });
      }
      // Pull root index.html, add new album card before footer
      const rootHtml = await (await ghRaw('index.html')).text();
      const newRootHtml = addAlbumCardToRoot(rootHtml, {
        slug: targetSlug,
        name: newAlbum.name,
        trackCount: newTracks.length,
        year: newAlbum.year || new Date().getFullYear(),
      });
      const rootBlob = await gh('POST', `/repos/${GH_OWNER}/${GH_REPO}/git/blobs`, {
        content: newRootHtml, encoding: 'utf-8',
      });
      blobs.push({ path: 'index.html', mode: '100644', type: 'blob', sha: rootBlob.sha });
    }

    // 8. Build new tree, commit, update main
    const refData = await gh('GET', `/repos/${GH_OWNER}/${GH_REPO}/git/ref/heads/${GH_BRANCH}`);
    const baseCommitSha = refData.object.sha;
    const baseCommit = await gh('GET', `/repos/${GH_OWNER}/${GH_REPO}/git/commits/${baseCommitSha}`);
    const baseTreeSha = baseCommit.tree.sha;

    // Add deletion entries (sha: null tells GitHub to remove the path)
    const treeEntries = [
      ...blobs,
      ...toDelete.map(path => ({ path, mode: '100644', type: 'blob', sha: null })),
    ];
    // De-dupe by path (later wins) — important when an insert moves a file and
    // its old slot is also marked for delete; keep the addition, drop the delete
    const finalMap = new Map();
    for (const entry of treeEntries) finalMap.set(entry.path, entry);
    const finalEntries = [...finalMap.values()];

    const newTree = await gh('POST', `/repos/${GH_OWNER}/${GH_REPO}/git/trees`, {
      base_tree: baseTreeSha,
      tree: finalEntries,
    });
    const commitMsg = isNewAlbum
      ? `JamPlays: new album "${newAlbum.name}" with "${displayTitle}"`
      : `JamPlays: ${replacing ? 'replace' : (position.mode === 'append' ? 'add' : 'insert')} "${displayTitle}" in ${targetSlug}`;
    const newCommit = await gh('POST', `/repos/${GH_OWNER}/${GH_REPO}/git/commits`, {
      message: commitMsg,
      tree: newTree.sha,
      parents: [baseCommitSha],
    });
    await gh('PATCH', `/repos/${GH_OWNER}/${GH_REPO}/git/refs/heads/${GH_BRANCH}`, {
      sha: newCommit.sha,
      force: false,
    });

    return json(200, {
      ok: true,
      slug: targetSlug,
      url: `https://jamplays.netlify.app/${targetSlug}/`,
      commit: newCommit.sha.slice(0, 7),
      trackCount: newTracks.length,
    });
  } catch (e) {
    return json(500, { error: e.message });
  }
};

// ----- helpers -----

function slugify(s) {
  return (s || '').toLowerCase()
    .replace(/['"’"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
function slugFromPath(p) {
  // "audio/02-midnight-your-time.mp3" -> "midnight-your-time"
  const m = (p || '').match(/[^/]+$/);
  if (!m) return 'track';
  return m[0].replace(/^\d+-/, '').replace(/\.(mp3|png|jpg|jpeg|webp)$/i, '');
}
function pad2(n) { return String(n).padStart(2, '0'); }
function roman(n) {
  const map = [['M',1000],['CM',900],['D',500],['CD',400],['C',100],['XC',90],['L',50],['XL',40],['X',10],['IX',9],['V',5],['IV',4],['I',1]];
  let s = '';
  for (const [r, v] of map) { while (n >= v) { s += r; n -= v; } }
  return s.toLowerCase();
}
function parseTracks(html) {
  const m = html.match(/const\s+TRACKS\s*=\s*\[([\s\S]*?)\];/);
  if (!m) return [];
  const entryRe = /\{\s*n:\s*['"]([^'"]*)['"]\s*,\s*title:\s*(?:'([^']*)'|"([^"]*)")\s*,\s*file:\s*['"]([^'"]*)['"]\s*,\s*art:\s*['"]([^'"]*)['"]\s*\}/g;
  const out = [];
  let mm;
  while ((mm = entryRe.exec(m[1])) !== null) {
    out.push({
      n: mm[1],
      title: (mm[2] || mm[3] || '').replace(/\\'/g, "'").replace(/\\"/g, '"'),
      file: mm[4],
      art: mm[5],
      _origFile: mm[4],
      _origArt: mm[5],
    });
  }
  return out;
}
function escJs(s) {
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n');
}
function replaceTracksArray(html, tracks) {
  const lines = tracks.map(t =>
    `      { n: '${escJs(t.n)}', title: '${escJs(t.title)}', file: '${escJs(t.file)}', art: '${escJs(t.art)}' }`
  ).join(',\n');
  return html.replace(/const\s+TRACKS\s*=\s*\[[\s\S]*?\];/,
    `const TRACKS = [\n${lines}\n    ];`);
}
function upsertLyric(html, title, lyric) {
  if (!lyric) return html;
  const key = title.replace(/'/g, "\\'");
  const lyricBlock = "`" + lyric.replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + "`";
  // If a LYRICS object exists, check whether this title already has an entry
  const lyricsMatch = html.match(/const\s+LYRICS\s*=\s*\{([\s\S]*?)\n\s*\};/);
  if (!lyricsMatch) return html;
  const existingKeyRe = new RegExp(`(['"])${escapeRegex(title)}\\1\\s*:\\s*\`[\\s\\S]*?\``);
  if (existingKeyRe.test(html)) {
    return html.replace(existingKeyRe, `'${key}': ${lyricBlock}`);
  }
  // Insert as the last entry — find the closing brace, insert before it
  const block = lyricsMatch[1];
  const trimmed = block.replace(/[\s,]+$/, '');
  const newBlock = `${trimmed}${trimmed ? ',' : ''}\n      '${key}': ${lyricBlock}\n    `;
  return html.replace(lyricsMatch[0], `const LYRICS = {${newBlock}};`);
}
function resetLyrics(html, title, lyric) {
  const key = title.replace(/'/g, "\\'");
  const lyricBlock = "`" + lyric.replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + "`";
  return html.replace(/const\s+LYRICS\s*=\s*\{[\s\S]*?\n\s*\};/,
    `const LYRICS = {\n      '${key}': ${lyricBlock}\n    };`);
}
function updateAlbumMetaCounts(html, count) {
  // "a 8-song album" / "A 8-song album" / "8 songs" — replace numeric prefix
  return html
    .replace(/a\s+\d+-song\s+album/gi, `a ${count}-song album`)
    .replace(/A\s+\d+-song\s+album/g, `A ${count}-song album`)
    .replace(/(\d+)\s+song(s?)/gi, `${count} song${count === 1 ? '' : 's'}`);
}
function retitleAlbumScaffold(html, { name, slug, year, description }) {
  let out = html;
  // <title>...
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(name)} — jamsounds</title>`);
  out = out.replace(/<h1[^>]*class="album-title"[^>]*>[\s\S]*?<\/h1>/,
    `<h1 class="album-title">${escapeHtml(name)}</h1>`);
  // canonical, og:url
  out = out.replace(/https:\/\/jamplays\.netlify\.app\/[^/"\s]+\//g, `https://jamplays.netlify.app/${slug}/`);
  // descriptions
  out = out.replace(/(<meta[^>]+name="description"[^>]+content=")[^"]*("\s*\/?>)/i, `$1${escapeHtml(description)}$2`);
  out = out.replace(/(<meta[^>]+property="og:description"[^>]+content=")[^"]*("\s*\/?>)/i, `$1${escapeHtml(description)}$2`);
  out = out.replace(/(<meta[^>]+name="twitter:description"[^>]+content=")[^"]*("\s*\/?>)/i, `$1${escapeHtml(description)}$2`);
  return out;
}
async function albumTitleFromHtml(html /*, slug */) {
  const m = html.match(/<h1[^>]*class="album-title"[^>]*>([\s\S]*?)<\/h1>/);
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : 'JamSounds';
}
function addAlbumCardToRoot(html, { slug, name, trackCount, year }) {
  const card = `\n    <a class="album-card" href="${slug}/">\n      <img src="${slug}/cover.png" alt="${escapeHtml(name)} — album cover" />\n      <div class="album-meta">\n        <p class="by">JAMSOUNDS</p>\n        <h2>${escapeHtml(name)}</h2>\n        <p class="details">${trackCount} song${trackCount === 1 ? '' : 's'} &middot; ${year}</p>\n        <span class="cta">Listen &amp; download &nbsp;→</span>\n      </div>\n    </a>\n`;
  // Insert just before the footer div
  if (html.includes('<div class="footer">')) {
    return html.replace('<div class="footer">', `${card}\n    <div class="footer">`);
  }
  return html + card;
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
