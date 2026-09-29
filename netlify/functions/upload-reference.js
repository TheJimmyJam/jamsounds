// POST /.netlify/functions/upload-reference
// Body: binary MP3 (Content-Type: audio/mpeg)
// Returns: { publicUrl, fileName, sizeBytes }
//
// Netlify limits function request bodies to ~6MB (Lambda default).
// For longer/larger MP3s, the user should trim the file to a 30-60s clip — that's plenty for a reference.

const BUCKET = 'jamsounds-audio';
// Files live in R2; this is the public link that redirects to them (functions/file.js).
const FILES = 'https://sounds.cannoncodeconnect.com/files/';

const { denyUnlessOwner } = require('../lib/owner');
const r2 = require('../lib/ccc-r2');

exports.handler = async (event) => {
  const denied = denyUnlessOwner(event);
  if (denied) return denied;

  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  if (!r2.configured()) return json(500, { error: 'R2 env not set' });

  const contentType = (event.headers['content-type'] || event.headers['Content-Type'] || '').toLowerCase();
  if (!contentType.includes('audio/')) {
    return json(400, { error: 'Content-Type must be an audio/* type (audio/mpeg recommended)' });
  }

  try {
    const buf = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body);
    const sizeBytes = buf.length;
    if (sizeBytes > 6 * 1024 * 1024) {
      return json(413, { error: `File too large (${(sizeBytes / 1024 / 1024).toFixed(1)}MB). Netlify limit is 6MB. Trim the MP3 to a 30-60s clip — that's plenty for a reference.` });
    }
    if (sizeBytes < 1024) {
      return json(400, { error: 'File too small (<1KB)' });
    }

    // Unique filename in references/ folder
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const fileName = `references/${ts}-${rand}.mp3`;

    const key = r2.keyFor(BUCKET, fileName);
    try {
      await r2.put(key, buf, 'audio/mpeg');
    } catch (e) {
      return json(500, { error: `Upload failed: ${e.message}` });
    }

    const publicUrl = FILES + key;
    return json(200, { publicUrl, fileName, sizeBytes });
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
