// Owner gate for JamSounds.
//
// Everything that spends Suno or Anthropic credit, or changes a saved track,
// persona, profile or JamPlays, answers only to Jimmy. Reads stay open so the
// library still browses and plays signed out.
//
// Two ways to be the owner:
//   * a signed session cookie (js_owner), minted by auth.js after sign-in
//   * the standing key in the x-jamsounds-owner-key header, for scripts
//
// Fails closed: with no JAMSOUNDS_SESSION_SECRET set, nobody is the owner.
//
// Lives in netlify/lib, not netlify/functions — every file in that folder is
// published as its own public endpoint.
"use strict";
const crypto = require("crypto");

const SESSION_SECRET = process.env.JAMSOUNDS_SESSION_SECRET || "";
const OWNER_KEY = process.env.JAMSOUNDS_OWNER_KEY || "";
const OWNER_EMAIL = (process.env.JAMSOUNDS_OWNER_EMAIL || "wcannon83@gmail.com").trim().toLowerCase();

const COOKIE = "js_owner";
const SESSION_DAYS = 30;

const b64 = (s) => Buffer.from(s).toString("base64url");

function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verify(raw) {
  if (!raw || !SESSION_SECRET) return null;
  const [body, mac] = String(raw).split(".");
  if (!body || !mac) return null;
  const want = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  const a = Buffer.from(mac), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch (e) { return null; }
  if (!p || !p.exp || p.exp < Date.now() || p.sub !== OWNER_EMAIL) return null;
  return p;
}

function cookieFrom(event, name) {
  const h = event.headers || {};
  const raw = h.cookie || h.Cookie || "";
  const hit = raw.split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

const newSession = () => sign({ sub: OWNER_EMAIL, exp: Date.now() + SESSION_DAYS * 864e5 });

const sessionCookie = (value, seconds) =>
  `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;

function keyMatches(key) {
  if (!OWNER_KEY || !key) return false;
  const a = crypto.createHash("sha256").update(String(key)).digest();
  const b = crypto.createHash("sha256").update(OWNER_KEY).digest();
  return crypto.timingSafeEqual(a, b);
}

function isOwner(event) {
  const h = event.headers || {};
  return Boolean(verify(cookieFrom(event, COOKIE))) || keyMatches(h["x-jamsounds-owner-key"]);
}

// Returns a 401 response for anyone but the owner, or null to carry on.
// `signin: true` is what the frontend keys on to open the sign-in sheet.
function denyUnlessOwner(event) {
  if (isOwner(event)) return null;
  return {
    statusCode: 401,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({ error: "Sign in to do that.", signin: true }),
  };
}

module.exports = {
  COOKIE, SESSION_DAYS, OWNER_EMAIL,
  isOwner, denyUnlessOwner, newSession, sessionCookie,
};
