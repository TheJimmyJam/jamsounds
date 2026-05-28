// GET /.netlify/functions/list-jamplays-albums
// Reads the JamPlays GitHub repo and returns the existing albums plus their
// current TRACKS arrays, so the JamSounds "Publish to JamPlays" UI can show
// album/position dropdowns without the user having to retype anything.

const GH_REPO_OWNER = 'TheJimmyJam';
const GH_REPO_NAME = 'jamplays';
const GH_BRANCH = 'main';

exports.handler = async () => {
  const token = process.env.GITHUB_PAT;
  if (!token) return json(500, { error: 'GITHUB_PAT env var not set' });

  const gh = async (path) => {
    const url = `https://api.github.com${path}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`GitHub ${path}: ${res.status} ${t}`);
    }
    return res.json();
  };

  try {
    // List root contents to find album folders (every dir except .github and
    // anything starting with a dot is treated as an album folder)
    const root = await gh(`/repos/${GH_REPO_OWNER}/${GH_REPO_NAME}/contents/?ref=${GH_BRANCH}`);
    const albumDirs = root.filter(e => e.type === 'dir' && !e.name.startsWith('.') && e.name !== 'node_modules');

    const albums = await Promise.all(albumDirs.map(async (dir) => {
      try {
        // Download each album's index.html so we can extract TRACKS + title
        const indexRes = await fetch(
          `https://raw.githubusercontent.com/${GH_REPO_OWNER}/${GH_REPO_NAME}/${GH_BRANCH}/${dir.name}/index.html`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!indexRes.ok) return null;
        const html = await indexRes.text();

        const titleMatch = html.match(/<h1[^>]*class="album-title"[^>]*>([\s\S]*?)<\/h1>/i)
          || html.match(/<title>([^<]+)<\/title>/i);
        const albumTitle = titleMatch
          ? titleMatch[1].replace(/<[^>]+>/g, '').replace(/&middot;/g, '·').replace(/—.*$/, '').trim()
          : dir.name;

        // Pull the TRACKS array literal out of the index.html JS — we don't
        // execute it, just regex-parse the n/title/file/art fields.
        const tracksMatch = html.match(/const\s+TRACKS\s*=\s*\[([\s\S]*?)\];/);
        const tracks = [];
        if (tracksMatch) {
          const body = tracksMatch[1];
          // Match { n: 'i', title: '...', file: '...', art: '...' } entries
          const entryRe = /\{\s*n:\s*['"]([^'"]*)['"]\s*,\s*title:\s*(?:'([^']*)'|"([^"]*)")\s*,\s*file:\s*['"]([^'"]*)['"]\s*,\s*art:\s*['"]([^'"]*)['"]\s*\}/g;
          let m;
          while ((m = entryRe.exec(body)) !== null) {
            tracks.push({
              n: m[1],
              title: (m[2] || m[3] || '').replace(/\\'/g, "'").replace(/\\"/g, '"'),
              file: m[4],
              art: m[5],
            });
          }
        }

        return { slug: dir.name, name: albumTitle, trackCount: tracks.length, tracks };
      } catch (e) {
        console.warn(`failed to parse album ${dir.name}:`, e.message);
        return { slug: dir.name, name: dir.name, trackCount: 0, tracks: [] };
      }
    }));

    return json(200, { albums: albums.filter(Boolean) });
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
