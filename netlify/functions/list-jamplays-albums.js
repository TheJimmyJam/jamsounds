// GET /.netlify/functions/list-jamplays-albums
// Reads the JamPlays repo and returns the records a JamSounds song can be
// published into, with their current track lists, so the "Publish to
// JamPlays" UI can show album/position dropdowns without retyping anything.
//
// JamPlays is gated: the album pages ship an empty TRACKS array, and the real
// track list is the manifest in netlify/data/<slug>.json. Only slugs the gate
// serves count as albums (not admin/, queue/, settings/ …), and films,
// borrowed records and replaced "earlier" editions are left off. See
// netlify/lib/jamplays.js.
//
// Words and audio never leave here: titles, numbers and voices only. Even
// those are owner-only: they come from records JamPlays keeps behind its gate.

const JP = require('../lib/jamplays');
const { denyUnlessOwner } = require('../lib/owner');

exports.handler = async (event) => {
  const denied = denyUnlessOwner(event);
  if (denied) return denied;

  const token = process.env.GITHUB_PAT;
  if (!token) return json(500, { error: 'GITHUB_PAT env var not set' });

  try {
    const { albums } = await JP.loadRecords(JP.github(token));
    return json(200, { albums });
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
