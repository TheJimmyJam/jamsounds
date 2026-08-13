# JamSounds

Tailored AI music for your projects. Describe what you're building, get a custom soundtrack.

## How it works

1. Type a project description (or skip this step).
2. Claude Haiku translates the brief into Suno parameters (title, style, lyrics, mood).
3. You edit the parameters if you want, then hit Generate.
4. Suno returns 2 versions in ~2 minutes.
5. Save the keeper. Audio is downloaded to Supabase Storage so it survives Suno's 15-day deletion.

## Stack

- Frontend: vanilla HTML/CSS/JS
- Backend: Netlify Functions (Node 18+)
- AI: Suno via sunoapi.org wrapper, Anthropic Claude Haiku for brief translation
- Storage + DB: Supabase (Cannon Code Connect project, `js_` prefixed tables)
- Hosting: Netlify

## Environment variables (set in Netlify dashboard)

| Key | Source |
|-----|--------|
| `SUNO_API_KEY` | sunoapi.org dashboard |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `SUPABASE_URL` | Cannon Code Connect Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | Cannon Code Connect Supabase project |

## Database

Table `public.js_tracks` (created in the Cannon Code Connect Supabase project). RLS enabled — only service-role can read/write. Storage bucket `jamsounds-audio` (public, audio/image MIME types only).

## Functions

- `GET /api/get-credits` — current Suno credit balance
- `POST /api/translate-brief` — Claude Haiku turns a project description into Suno parameters
- `POST /api/generate-music` — kicks off a Suno generation task
- `GET /api/check-status?taskId=…` — polls a Suno task
- `POST /api/save-track` — downloads MP3 from Suno, uploads to Supabase Storage, inserts row
- `GET /api/list-tracks` — returns saved library
- `DELETE /api/list-tracks?id=…` — deletes a saved track
- `POST /api/extend-music` — continues an existing track (polls via `check-status`)
- `POST /api/add-vocals` — sings lyrics over an uploaded instrumental
- `POST /api/add-instrumental` — builds an arrangement under an uploaded vocal
- `POST /api/separate-vocals` — stem separation
- `POST /api/convert-wav` — WAV master of a generated track
- `GET /api/check-task?kind=wav|stems&taskId=…` — polls WAV / stem tasks
- `POST /api/boost-style` — expands a terse style line into a fuller one
- `POST /api/timestamped-lyrics` — word-level lyric timings (synchronous)

## Notes on Suno parameters

- **`duration`** (10–360s) is **V5_5 + custom mode only**. Sending it on an older model
  makes Suno reject the whole request, so both the UI control and `generate-music.js`
  gate on the model. The length slider is off by default — unchecked means Suno picks.
- **`personaModel`** is `style_persona` (minted from a generated song) or `voice_persona`
  (a Suno Voice). Voices **cannot be created through the API** — Suno requires a live
  challenge-phrase recording in their own app as an anti-impersonation check. Create the
  Voice at suno.com, then paste its ID into the Personas panel to register it here.
- **Polling is not uniform.** Music generation and extends read `data.status` from
  `/generate/record-info` (`check-status.js`); WAV and stem tasks read `data.successFlag`
  from their own record-info endpoints (`check-task.js`). They can't share a handler.
- **`add-instrumental` takes `tags`, not `style`** — the only generate endpoint that does.
  The function accepts `style` as an alias and renames it before sending.
