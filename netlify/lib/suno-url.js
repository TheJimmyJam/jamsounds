// Suno fetches reference audio itself, and nobody has checked that it follows
// the /files/ redirect. So a JamSounds file link is swapped for a signed R2
// GET URL, good for a day, at the moment it is handed to Suno. Rows and the UI
// keep the /files/ link. Any other URL passes through untouched.
"use strict";
const r2 = require("./ccc-r2");

const PREFIXES = [
  "https://sounds.cannoncodeconnect.com/files/",
  // Links from before the move, if one is still sitting in a page or brief.
  "https://azkyohtmhlvnkziuvgvk.supabase.co/storage/v1/object/public/",
];

function sunoUrl(url) {
  const s = String(url || "");
  for (const p of PREFIXES) {
    if (!s.startsWith(p)) continue;
    const key = decodeURIComponent(s.slice(p.length).split(/[?#]/)[0]);
    if (key.startsWith("jamsounds-audio/")) return r2.signedGet(key, { ttl: 24 * 3600 });
  }
  return url;
}

module.exports = { sunoUrl };
