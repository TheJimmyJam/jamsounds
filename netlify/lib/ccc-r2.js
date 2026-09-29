// Files for the CCC apps live in the private Cloudflare R2 bucket `ccc-files`.
//
// They used to be in Supabase Storage on the CCC project. That project is on the
// free plan, and when storage passed 1 GB Supabase restricted the whole project,
// sign-in included. The database and auth stayed on Supabase; the files moved.
// Keys are `<old supabase bucket>/<object path>`, so "cut-private/abc/v1.mp4" is
// what Supabase called bucket cut-private, path abc/v1.mp4.
//
// SigV4 by hand, Node built-ins only, same as JamPlays' netlify/lib/r2.js.
// Every URL here is issued only after the caller's own gate has passed.
"use strict";
const crypto = require("crypto");

const ACCOUNT = process.env.CCC_R2_ACCOUNT_ID || "";
const ACCESS_KEY = process.env.CCC_R2_ACCESS_KEY_ID || "";
const SECRET = process.env.CCC_R2_SECRET_ACCESS_KEY || "";
const BUCKET = process.env.CCC_R2_BUCKET || "ccc-files";
const REGION = "auto";
const SERVICE = "s3";
const ALG = "AWS4-HMAC-SHA256";
const EMPTY_SHA = crypto.createHash("sha256").update("").digest("hex");

const configured = () => Boolean(ACCOUNT && ACCESS_KEY && SECRET && BUCKET);
const host = () => `${ACCOUNT}.r2.cloudflarestorage.com`;
const hmac = (key, msg) => crypto.createHmac("sha256", key).update(msg).digest();
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

// Each segment escaped, slashes kept: S3 canonicalises "a/b.mp4" as a path.
const encodeKey = (key) => String(key).split("/").map(encodeURIComponent).join("/");
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/** "cut-private" + "abc/v1.mp4" -> "cut-private/abc/v1.mp4" */
const keyFor = (bucket, path) => `${bucket}/${String(path).replace(/^\/+/, "")}`;

function stamps() {
  const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);
  return { stamp, day, scope: `${day}/${REGION}/${SERVICE}/aws4_request` };
}

function signingKey(day) {
  let k = hmac(`AWS4${SECRET}`, day);
  for (const part of [REGION, SERVICE, "aws4_request"]) k = hmac(k, part);
  return k;
}

/**
 * Presigned URL. method GET (read) or PUT (browser upload). For PUT the
 * browser must send exactly the Content-Type passed here, or R2 rejects it.
 * extraQuery lets a GET force a download name, e.g.
 * {"response-content-disposition": 'attachment; filename="x.pdf"'}.
 */
function presign(method, key, { ttl = 3 * 60 * 60, contentType, extraQuery } = {}) {
  if (!configured()) throw new Error("R2 is not configured (CCC_R2_* env vars)");
  const h = host();
  const path = `/${BUCKET}/${encodeKey(key)}`;
  const { stamp, day, scope } = stamps();
  const headers = { host: h };
  if (method === "PUT" && contentType) headers["content-type"] = contentType;
  const signed = Object.keys(headers).sort();
  const params = {
    "X-Amz-Algorithm": ALG,
    "X-Amz-Credential": `${ACCESS_KEY}/${scope}`,
    "X-Amz-Date": stamp,
    "X-Amz-Expires": String(Math.min(ttl, 7 * 24 * 3600)),
    "X-Amz-SignedHeaders": signed.join(";"),
    ...(extraQuery || {}),
  };
  const query = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join("&");
  const canonHeaders = signed.map((n) => `${n}:${headers[n]}\n`).join("");
  const canonical = `${method}\n${path}\n${query}\n${canonHeaders}\n${signed.join(";")}\nUNSIGNED-PAYLOAD`;
  const toSign = `${ALG}\n${stamp}\n${scope}\n${sha256(canonical)}`;
  const sig = crypto.createHmac("sha256", signingKey(day)).update(toSign).digest("hex");
  return `https://${h}${path}?${query}&X-Amz-Signature=${sig}`;
}

const signedGet = (key, opts) => presign("GET", key, opts);
const signedPut = (key, contentType, opts = {}) => presign("PUT", key, { ...opts, contentType });

/** Server-side request with header auth. body: Buffer | string | undefined. */
async function request(method, key, { body, contentType, query = "" } = {}) {
  if (!configured()) throw new Error("R2 is not configured (CCC_R2_* env vars)");
  const h = host();
  const path = `/${BUCKET}${key ? "/" + encodeKey(key) : ""}`;
  const buf = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(body);
  const payloadSha = buf ? sha256(buf) : EMPTY_SHA;
  const { stamp, day, scope } = stamps();
  const headers = { host: h, "x-amz-content-sha256": payloadSha, "x-amz-date": stamp };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonHeaders = names.map((n) => `${n}:${String(headers[n]).trim()}\n`).join("");
  const canonical = `${method}\n${path}\n${query}\n${canonHeaders}\n${names.join(";")}\n${payloadSha}`;
  const toSign = `${ALG}\n${stamp}\n${scope}\n${sha256(canonical)}`;
  const sig = crypto.createHmac("sha256", signingKey(day)).update(toSign).digest("hex");
  headers.authorization = `${ALG} Credential=${ACCESS_KEY}/${scope}, SignedHeaders=${names.join(";")}, Signature=${sig}`;
  delete headers.host;
  return fetch(`https://${h}${path}${query ? "?" + query : ""}`, { method, headers, body: buf || undefined });
}

async function put(key, body, contentType = "application/octet-stream") {
  const res = await request("PUT", key, { body, contentType });
  if (!res.ok) throw new Error(`R2 PUT ${key} -> ${res.status} ${await res.text()}`);
  return key;
}

async function get(key) {
  const res = await request("GET", key);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 GET ${key} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function head(key) {
  const res = await request("HEAD", key);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 HEAD ${key} -> ${res.status}`);
  return { size: Number(res.headers.get("content-length")), type: res.headers.get("content-type") };
}

async function del(key) {
  const res = await request("DELETE", key);
  if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE ${key} -> ${res.status}`);
  return true;
}

/** Keys under a prefix (up to 1000 per call; pass the returned token to continue). */
async function list(prefix = "", token) {
  const params = { "list-type": "2", prefix, ...(token ? { "continuation-token": token } : {}) };
  const query = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join("&");
  const res = await request("GET", "", { query });
  if (!res.ok) throw new Error(`R2 LIST ${prefix} -> ${res.status}`);
  const xml = await res.text();
  const items = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => ({
    key: (m[1].match(/<Key>([\s\S]*?)<\/Key>/) || [])[1],
    size: Number((m[1].match(/<Size>(\d+)<\/Size>/) || [])[1] || 0),
  }));
  const next = (xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/) || [])[1];
  return { items, next };
}

module.exports = { configured, keyFor, signedGet, signedPut, put, get, head, del, list, BUCKET };
