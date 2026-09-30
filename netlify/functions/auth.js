// POST /.netlify/functions/auth   Body: { action, ... }
//   me       → { owner: bool }
//   request  → emails Jimmy a link and a six-digit code (the code is in the subject)
//   code     → { code } — the typed code; sets the js_owner session cookie
//   verify   → { token } — the link; sets the same cookie
//   logout   → clears the cookie
//
// Only one address ever gets mail, so `request` takes no email: nobody can use
// it to aim mail anywhere else. The typed code exists because an installed app
// never sees a link tapped in Mail — that opens the browser instead.

const crypto = require('crypto');
const O = require('../lib/owner');

const RESEND_KEY = process.env.JAMSOUNDS_RESEND_KEY || '';
// Sign-in codes go out as CannonCodeConnect (Jimmy, 2026-09-29), whatever
// the *_MAIL_FROM env says: CODE_FROM in lib/ccc-code-mail.js.
const { CODE_FROM, codeMail, codeSubject } = require('../lib/ccc-code-mail.js');
const SECRET = process.env.JAMSOUNDS_SESSION_SECRET || '';
const LOGIN_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const TABLE = '/rest/v1/js_owner_logins';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if (!SECRET) return json(500, { error: 'Sign-in is not configured' });

  let req;
  try { req = event.body ? JSON.parse(event.body) : {}; } catch { return json(400, { error: 'Invalid JSON' }); }
  const action = req.action || 'me';

  try {
    if (action === 'me') return json(200, { owner: O.isOwner(event) });

    if (action === 'logout') return withCookie(200, { ok: true }, '', 0);

    if (action === 'request') {
      const [last] = await sb(`${TABLE}?order=created_at.desc&limit=1`);
      // One mail per half minute at most; a second tap just says "sent".
      if (last && Date.now() - new Date(last.created_at).getTime() < 30000) return json(200, { ok: true });

      await sb(`${TABLE}?used_at=is.null`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {});

      const token = crypto.randomBytes(32).toString('base64url');
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      await sb(TABLE, {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          token_hash: sha(token),
          code_hash: mac(code),
          expires_at: new Date(Date.now() + LOGIN_MINUTES * 60000).toISOString(),
          requested_ip: (event.headers || {})['x-nf-client-connection-ip'] || null,
        }),
      });
      await send(codeSubject(code), mail(`${siteUrl(event)}/?login=${encodeURIComponent(token)}`, code));
      return json(200, { ok: true });
    }

    if (action === 'verify') {
      const token = String(req.token || '');
      if (!token) return json(400, { error: 'missing' });
      const [row] = await sb(`${TABLE}?token_hash=eq.${sha(token)}&limit=1`);
      if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
        return json(403, { error: 'That link has been used or has expired.' });
      }
      await spend(row.id);
      return withCookie(200, { ok: true }, O.newSession(), O.SESSION_DAYS * 86400);
    }

    if (action === 'code') {
      const code = String(req.code || '').replace(/\D/g, '');
      if (code.length !== 6) return json(400, { error: 'Type the six digits from the email.' });
      const [row] = await sb(`${TABLE}?used_at=is.null&order=created_at.desc&limit=1`);
      if (!row || new Date(row.expires_at).getTime() < Date.now() || (row.attempts || 0) >= MAX_ATTEMPTS) {
        await pause();
        return json(403, { error: 'That code has expired. Send a new one.' });
      }
      if (!safeEqual(row.code_hash, mac(code))) {
        const attempts = (row.attempts || 0) + 1;
        await sb(`${TABLE}?id=eq.${row.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(attempts >= MAX_ATTEMPTS ? { attempts, used_at: new Date().toISOString() } : { attempts }),
        }).catch(() => {});
        await pause();
        return json(403, { error: attempts >= MAX_ATTEMPTS ? 'Too many tries. Send a new code.' : "That's not the code." });
      }
      await spend(row.id);
      return withCookie(200, { ok: true }, O.newSession(), O.SESSION_DAYS * 86400);
    }

    return json(400, { error: 'unknown action' });
  } catch (e) {
    return json(502, { error: e.message });
  }
};

// The code mail is CannonCodeConnect's, the same in every app (lib/ccc-code-mail.js).
function mail(link, code) {
  return codeMail({ code, link, app: 'JamSounds', minutes: LOGIN_MINUTES, host: new URL(link).host });
}

async function send(subject, html) {
  if (!RESEND_KEY) throw new Error('No Resend key configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: CODE_FROM, to: [O.OWNER_EMAIL], subject, html }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `resend ${res.status}`);
}

async function sb(path, init = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase ${res.status}: ${text}`);
  return text ? JSON.parse(text) : [];
}

const spend = (id) => sb(`${TABLE}?id=eq.${id}`, {
  method: 'PATCH',
  headers: { Prefer: 'return=minimal' },
  body: JSON.stringify({ used_at: new Date().toISOString() }),
});

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const mac = (s) => crypto.createHmac('sha256', SECRET).update(`code:${s}`).digest('hex');
const pause = () => new Promise((r) => setTimeout(r, 600));

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// The link goes back to whichever of our own hosts asked, never to a host a
// request header names: a forged Host would otherwise aim Jimmy's sign-in link
// at somebody else's site.
const HOSTS = ['sounds.cannoncodeconnect.com', 'jamsounds.netlify.app'];
function siteUrl(event) {
  const host = String((event.headers || {}).host || '').toLowerCase();
  return `https://${HOSTS.includes(host) ? host : HOSTS[0]}`;
}

function withCookie(statusCode, body, value, seconds) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': O.sessionCookie(value, seconds) },
    body: JSON.stringify(body),
  };
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}
