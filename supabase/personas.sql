-- JamSounds: js_personas table
-- Paste this into the Supabase SQL Editor (Cannon Code Connect project) and click Run.
-- Idempotent: safe to run multiple times.

create table if not exists public.js_personas (
  id uuid primary key default gen_random_uuid(),
  user_email text not null default 'wcannon83@gmail.com',
  persona_id text not null,                        -- Suno's persona ID
  name text not null,                              -- e.g. "Megi" / "Jimmy"
  description text,                                -- the description sent to Suno
  source_track_id uuid references public.js_tracks(id) on delete set null,
  source_suno_audio_id text,                       -- Suno's audioId used to create the persona
  source_suno_task_id text,                        -- Suno's taskId used to create the persona
  vocal_start numeric,                             -- segment start sec sent to Suno (optional)
  vocal_end numeric,                               -- segment end sec sent to Suno (optional)
  persona_model text not null default 'style_persona',
  created_at timestamptz not null default now()
);

create index if not exists js_personas_user_email_idx on public.js_personas (user_email);
create index if not exists js_personas_created_at_idx on public.js_personas (created_at desc);
create unique index if not exists js_personas_persona_id_uidx on public.js_personas (persona_id);

alter table public.js_personas enable row level security;

-- No public policies — service role only (same pattern as js_tracks).
