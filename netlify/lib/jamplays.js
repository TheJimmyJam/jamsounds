// What JamSounds knows about JamPlays' records, and how to add a song to one.
//
// JamPlays is gated (since 2026-09-19). An album page no longer carries its
// track list: the page ships `const TRACKS = []` and fills it from the album
// function once a grant says what the listener may hear. The real record is
// three things in the jamplays repo, plus the audio outside it:
//
//   netlify/lib/gate.js           ALBUMS — the slugs the gate will serve
//   netlify/data/<slug>.json      the manifest: tracks, versions, lyrics
//   assets/catalog.js             the public card: title, edition, "N songs"
//   <slug>/song-art/*.png         per-song art (public, in the repo)
//   jamplays-private/<slug>/*.mp3 the audio, in a PRIVATE Supabase bucket
//
// The audio must never be committed: the site publishes the repo root, so a
// committed mp3 is on the open web, past every grant.
//
// Everything here except the fetch helpers is pure, so it is unit-tested
// against small fixtures in tests/jamplays.test.mjs.
'use strict';
const vm = require('vm');

const GH_OWNER = 'TheJimmyJam';
const GH_REPO = 'jamplays';
const GH_BRANCH = 'main';
const BUCKET = 'jamplays-private';
const SITE = 'https://jamplays.cannoncodeconnect.com';

// Catalog shelves that are not a place to publish a new JamSounds song:
// films have no tracks, borrowed records are other artists', and "earlier"
// editions were replaced by a newer one (Desireland His & Hers is also
// rebuilt from its own sources by build-album.py, which would drop the song).
const SKIP_KINDS = new Set(['film', 'borrowed', 'earlier']);

// ---------- parsing ----------

// The slugs gate.js actually serves, read from its ALBUMS block. A folder in
// the repo root is not an album unless the gate knows it.
function parseRegisteredAlbums(gateSrc) {
  const start = gateSrc.search(/const\s+ALBUMS\s*=\s*\{/);
  if (start < 0) return [];
  const end = gateSrc.indexOf('\n};', start);
  const block = gateSrc.slice(start, end < 0 ? undefined : end);
  const out = [];
  const re = /['"]?([\w-]+)['"]?\s*:\s*require\(\s*['"]\.\.\/data\/([\w-]+)\.json['"]\s*\)/g;
  let m;
  while ((m = re.exec(block))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

// catalog.js is `window.JP_CATALOG = [ ... ]` with comments and unquoted keys.
// It is plain data from Jimmy's own repo, so it is evaluated in an empty
// sandbox rather than picked apart with a regex.
function parseCatalog(src) {
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox, { timeout: 100 });
  const list = sandbox.window.JP_CATALOG;
  return Array.isArray(list) ? JSON.parse(JSON.stringify(list)) : [];
}

// Voice keys in first-seen order: "solo", "duet", or "jimmy"/"megi".
function albumVoices(data) {
  const out = [];
  for (const t of (data && data.tracks) || []) {
    for (const v of Object.keys(t.versions || {})) if (!out.includes(v)) out.push(v);
  }
  return out;
}

// The voices an album's player page will actually play, when it says.
// Fantasyland's page has no VOICES list; it plays each track's first version.
function pageVoices(html) {
  const m = /const\s+VOICES\s*=\s*\[([^\]]*)\]/.exec(html || '');
  if (!m) return null;
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
}

// ---------- the list JamSounds offers ----------

function publishableAlbums({ registered, catalog, data }) {
  const bySlug = new Map((catalog || []).map((c) => [c.album, c]));
  const seen = new Set();
  const out = [];
  for (const slug of registered || []) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    const d = data[slug];
    const card = bySlug.get(slug) || {};
    if (!d || !Array.isArray(d.tracks)) continue;
    if (d.borrowed || SKIP_KINDS.has(card.kind)) continue;
    out.push({
      slug,
      name: card.title || d.title || slug,
      edition: card.edition || null,
      voices: albumVoices(d),
      trackCount: d.tracks.length,
      tracks: d.tracks.map((t) => ({ n: t.n, title: t.title, art: t.art || null, voices: Object.keys(t.versions || {}) })),
    });
  }
  // Two cards with one name are told apart by edition.
  const counts = new Map();
  for (const a of out) counts.set(a.name, (counts.get(a.name) || 0) + 1);
  for (const a of out) if (counts.get(a.name) > 1 && a.edition) a.name = `${a.name} — ${a.edition}`;
  return out;
}

// ---------- adding a song ----------

function slugify(s) {
  return (s || '').toLowerCase()
    .replace(/['"’"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
function roman(n) {
  const map = [['m', 1000], ['cm', 900], ['d', 500], ['cd', 400], ['c', 100], ['xc', 90], ['l', 50], ['xl', 40], ['x', 10], ['ix', 9], ['v', 5], ['iv', 4], ['i', 1]];
  let s = '';
  for (const [r, v] of map) while (n >= v) { s += r; n -= v; }
  return s;
}
// Fantasyland numbers its songs i, ii, iii; the Desireland records 1, 2, 3.
function numberer(tracks) {
  const isRoman = tracks.length && tracks.every((t) => typeof t.n === 'string' && /^[ivxlcdm]+$/i.test(t.n));
  return isRoman ? (i) => roman(i) : (i) => i;
}

// Which voice a new song goes in as. A one-voice album decides for itself; a
// two-voice album (his and hers) has to be told.
function pickVoice({ data, html, requested, trackType }) {
  const have = albumVoices(data);
  const plays = pageVoices(html);
  const allowed = plays || (have.length ? have : ['solo']);
  if (requested) {
    if (!allowed.includes(requested)) throw userError(`This album plays ${allowed.join(', ')}; "${requested}" would never be heard.`);
    return requested;
  }
  if (trackType === '(duet)' && allowed.includes('duet')) return 'duet';
  if (allowed.length === 1) return allowed[0];
  throw userError(`This album has ${allowed.join(' and ')} versions. Say which one this is (voice).`);
}

// Plans the whole change without touching anything. Returns the new manifest,
// the new catalog source, the storage key for the audio and the repo path for
// the art, plus which existing track numbers move (a song-scoped share names
// its songs by number, so moving one would hand somebody a different song).
function planPublish({ slug, data, dataSrc, catalogSrc, html, position, displayTitle, trackType, voice, lyrics, seconds, artExt }) {
  if (!data || !Array.isArray(data.tracks)) throw userError(`No manifest for ${slug}`);
  const current = data.tracks;
  const total = current.length;
  const v = pickVoice({ data, html, requested: voice, trackType });
  // The voice is the version key, so "(duet)" is not repeated in the title.
  const title = trackType && !(trackType === '(duet)' && v === 'duet') ? `${displayTitle} ${trackType}` : displayTitle;
  const fileSlug = slugify(displayTitle) || 'track';

  const mode = (position && position.mode) || 'append';
  let at; let replacing = false;
  if (mode === 'append') at = total;
  else if (mode === 'insert') at = Math.max(0, Math.min(total, (position.n || 1) - 1));
  else if (mode === 'replace') {
    at = (position.n || 1) - 1;
    if (at < 0 || at >= total) throw userError(`Invalid replace position (album has ${total} tracks)`);
    replacing = true;
  } else throw userError(`Unknown position.mode: ${mode}`);

  const name = v === 'solo' ? `${fileSlug}.mp3` : `${fileSlug}-${v}.mp3`;
  const replaced = replacing ? current[at] : null;
  // Two songs must never share an audio object: the second upload would
  // overwrite the first one's recording under its feet.
  const clash = current.find((t, i) => !(replacing && i === at) &&
    Object.values(t.versions || {}).some((s) => s.file && s.file.split('/').pop() === name));
  if (clash) throw userError(`"${clash.title}" already uses ${name}. Give this one a different title.`);
  const artPath = artExt ? `song-art/${fileSlug}.${artExt}` : null;
  if (artPath && current.some((t, i) => !(replacing && i === at) && t.art === artPath)) {
    throw userError(`"${current.find((t) => t.art === artPath).title}" already uses ${artPath}. Give this one a different title.`);
  }

  const entry = { n: null, title };
  if (artPath) entry.art = artPath;
  entry.versions = { [v]: { file: `audio/${name}`, ...(seconds ? { seconds: Math.round(seconds * 100) / 100 } : {}) } };

  let tracks;
  if (replacing) { tracks = [...current]; tracks[at] = entry; }
  else tracks = [...current.slice(0, at), entry, ...current.slice(at)];
  const num = numberer(current);
  const moved = [];
  tracks = tracks.map((t, i) => {
    const n = num(i + 1);
    if (t === entry) return { ...t, n };
    if (String(t.n) !== String(n)) moved.push(t.n);
    return String(t.n) === String(n) ? t : { ...t, n };
  });
  const affectedNs = replacing ? [replaced.n] : moved;

  // Words live beside the tracks, keyed "Title|voice". A replaced song's words
  // and timing marks go with it, unless another song still has that title.
  const next = { ...data, tracks };
  const dropKeys = new Set();
  if (replaced && !tracks.some((t) => t.title === replaced.title)) {
    for (const rv of Object.keys(replaced.versions || {})) dropKeys.add(`${replaced.title}|${rv}`);
  }
  for (const field of ['lyrics', 'anchors']) {
    if (!data[field]) continue;
    const obj = {};
    for (const [k, val] of Object.entries(data[field])) if (!dropKeys.has(k)) obj[k] = val;
    next[field] = obj;
  }
  if (lyrics && lyrics.trim()) next.lyrics = { ...(next.lyrics || {}), [`${title}|${v}`]: lyrics.trim() };

  return {
    voice: v,
    title,
    entry: tracks[at],
    index: at,
    mode,
    replaced: replaced ? { n: replaced.n, title: replaced.title, files: Object.values(replaced.versions || {}).map((s) => s.file).filter(Boolean) } : null,
    audioKey: `${slug}/${name}`,
    artPath: artPath ? `${slug}/${artPath}` : null,
    affectedNs,
    data: next,
    dataJson: serializeManifest(next, dataSrc == null ? undefined : manifestStyle(dataSrc)),
    catalogSrc: catalogSrc == null ? null : setCatalogCount(catalogSrc, slug, tracks.length),
  };
}

// The manifests are written by different hands: compact JSON, Python's
// one-line json.dumps, or indented. A publish writes the file back in the
// style it already has, so the diff shows only the song that was added.
function manifestStyle(src) {
  const s = String(src || '');
  const ind = /^\{\n( +)"/.exec(s);
  if (ind) return { indent: ind[1].length, item: ',', key: ': ', end: s.endsWith('\n') ? '\n' : '' };
  const py = /^\{"[^"]*": /.test(s);
  return { indent: 0, item: py ? ', ' : ',', key: py ? ': ' : ':', end: s.endsWith('\n') ? '\n' : '' };
}
function serializeManifest(d, style = { indent: 1, item: ',', key: ': ', end: '\n' }) {
  const pad = (depth) => (style.indent ? '\n' + ' '.repeat(style.indent * depth) : '');
  const sep = style.indent ? ',' : style.item;
  const walk = (v, depth) => {
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      return '[' + v.map((x) => pad(depth + 1) + walk(x, depth + 1)).join(sep) + pad(depth) + ']';
    }
    if (v && typeof v === 'object') {
      const keys = Object.keys(v).filter((k) => v[k] !== undefined);
      if (!keys.length) return '{}';
      return '{' + keys.map((k) => pad(depth + 1) + JSON.stringify(k) + style.key + walk(v[k], depth + 1)).join(sep) + pad(depth) + '}';
    }
    return JSON.stringify(v);
  };
  return walk(d, 0) + style.end;
}

// "11 songs · Jimmy’s voice" -> "12 songs · Jimmy’s voice", in this album's
// card only. Leaves the source alone if the card has no count to change.
function setCatalogCount(src, slug, count) {
  const at = src.search(new RegExp(`album:\\s*['"]${escapeRegex(slug)}['"]`));
  if (at < 0) return src;
  const open = src.lastIndexOf('{', at);
  const close = src.indexOf('}', at);
  if (open < 0 || close < 0) return src;
  const card = src.slice(open, close);
  const updated = card.replace(/(sub:\s*['"])\d+ songs?\b/, `$1${count} song${count === 1 ? '' : 's'}`);
  return src.slice(0, open) + updated + src.slice(close);
}

// Live song-scoped shares on this album that name a track number this publish
// would move or replace. Album-wide shares are unaffected.
function shareConflicts(grants, affectedNs) {
  const hit = new Set(affectedNs.map(String));
  if (!hit.size) return [];
  return (grants || []).filter((g) => !g.revoked &&
    !(g.expires_at && new Date(g.expires_at).getTime() < Date.now()) &&
    g.scope && g.scope.kind === 'songs' &&
    (g.scope.items || []).some((it) => hit.has(String(it.n))));
}

// ---------- fetching ----------

function github(token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const api = async (method, path, body) => {
    const res = await fetch(`https://api.github.com${path}`, {
      method, headers: { ...headers, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  };
  // A file's bytes at main, via the contents API (the repo is private).
  const raw = async (path, { optional = false } = {}) => {
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${GH_BRANCH}`;
    const res = await fetch(url, { headers: { ...headers, Accept: 'application/vnd.github.raw' } });
    if (optional && res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub ${path}: ${res.status}`);
    return res;
  };
  const text = async (path, opts) => { const r = await raw(path, opts); return r ? r.text() : null; };
  return { api, raw, text };
}

// Everything the list and the publish both need, read once.
async function loadRecords(gh) {
  const [gateSrc, catalogSrc] = await Promise.all([gh.text('netlify/lib/gate.js'), gh.text('assets/catalog.js')]);
  const registered = parseRegisteredAlbums(gateSrc);
  const catalog = parseCatalog(catalogSrc);
  const data = {};
  await Promise.all(registered.map(async (slug) => {
    const t = await gh.text(`netlify/data/${slug}.json`, { optional: true });
    if (t) data[slug] = JSON.parse(t);
  }));
  return { registered, catalog, catalogSrc, data, albums: publishableAlbums({ registered, catalog, data }) };
}

function userError(msg) { const e = new Error(msg); e.status = 400; return e; }
function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

module.exports = {
  GH_OWNER, GH_REPO, GH_BRANCH, BUCKET, SITE,
  parseRegisteredAlbums, parseCatalog, albumVoices, pageVoices, publishableAlbums,
  slugify, roman, pickVoice, planPublish, manifestStyle, serializeManifest, setCatalogCount, shareConflicts,
  github, loadRecords,
};
