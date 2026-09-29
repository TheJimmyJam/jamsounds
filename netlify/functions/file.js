// GET /files/jamsounds-audio/<path>   (rewritten here by netlify.toml)
// GET /.netlify/functions/file?k=jamsounds-audio/<path>
//
// The jamsounds-audio files used to sit in a PUBLIC Supabase bucket, so rows
// and other tools hold plain links to them. They live in the private R2
// bucket now; this answers each old-style link with a 302 to a short-lived
// signed R2 URL. Still open to anyone, like the public bucket was, but only
// for keys under jamsounds-audio/ — the rest of ccc-files is other apps'.

const { signedGet } = require('../lib/ccc-r2');

const PREFIX = 'jamsounds-audio/';

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
    return { statusCode: 405, body: 'GET only' };
  }

  let key = event.queryStringParameters?.k || '';
  if (!key) {
    const m = /\/(?:files|\.netlify\/functions\/file)\/(.+)$/.exec(event.path || '');
    key = m ? m[1] : '';
  }
  try { key = decodeURIComponent(key); } catch { return { statusCode: 400, body: 'Bad key' }; }

  const parts = key.split('/');
  if (!key.startsWith(PREFIX) || parts.some((p) => !p || p === '.' || p === '..')) {
    return { statusCode: 404, body: 'Not found' };
  }

  try {
    return {
      statusCode: 302,
      headers: {
        Location: signedGet(key, { ttl: 3600 }),
        'Cache-Control': 'private, max-age=3000',
      },
      body: '',
    };
  } catch (e) {
    return { statusCode: 500, body: e.message };
  }
};
