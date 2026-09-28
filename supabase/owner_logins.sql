-- JamSounds: js_owner_logins table
-- One row per emailed sign-in (link + six-digit code). Read and written only by
-- netlify/functions/auth.js with the service role; RLS on, no policies.
-- Idempotent: safe to run multiple times.

create table if not exists public.js_owner_logins (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,                        -- sha256 of the link token
  code_hash text not null,                         -- HMAC of the six-digit code
  attempts int not null default 0,                 -- wrong codes typed; 5 spends the row
  requested_ip text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists js_owner_logins_token_idx on public.js_owner_logins (token_hash);
create index if not exists js_owner_logins_created_idx on public.js_owner_logins (created_at desc);

alter table public.js_owner_logins enable row level security;
