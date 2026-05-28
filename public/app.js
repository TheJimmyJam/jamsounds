// JamSounds frontend logic
// All API calls go through /.netlify/functions/*

const API = '/.netlify/functions';

const els = {
  projectBrief: document.getElementById('project-brief'),
  translateBtn: document.getElementById('translate-btn'),
  translateStatus: document.getElementById('translate-status'),
  soundsLike: document.getElementById('sounds-like'),
  soundsLikeBtn: document.getElementById('sounds-like-btn'),
  soundsLikeStatus: document.getElementById('sounds-like-status'),
  dropZone: document.getElementById('drop-zone'),
  dropZoneLabel: document.getElementById('drop-zone-label'),
  refFile: document.getElementById('ref-file'),
  refLoaded: document.getElementById('ref-loaded'),
  refName: document.getElementById('ref-name'),
  refSize: document.getElementById('ref-size'),
  refPreview: document.getElementById('ref-preview'),
  refClear: document.getElementById('ref-clear'),
  refStatus: document.getElementById('ref-status'),
  audioWeightSlider: document.getElementById('audio-weight-slider'),
  audioWeightOut: document.getElementById('audio-weight-out'),
  title: document.getElementById('title'),
  model: document.getElementById('model'),
  style: document.getElementById('style'),
  prompt: document.getElementById('prompt'),
  instrumental: document.getElementById('instrumental'),
  negativeTags: document.getElementById('negative-tags'),
  vocalGender: document.getElementById('vocal-gender'),
  styleWeight: document.getElementById('style-weight'),
  weirdness: document.getElementById('weirdness'),
  audioWeight: document.getElementById('audio-weight'),
  personaSelect: document.getElementById('persona-select'),
  duetMode: document.getElementById('duet-mode'),
  duetFields: document.getElementById('duet-fields'),
  duetNameA: document.getElementById('duet-name-a'),
  duetNameB: document.getElementById('duet-name-b'),
  duetPersonaA: document.getElementById('duet-persona-a'),
  duetPersonaB: document.getElementById('duet-persona-b'),
  duetGenderA: document.getElementById('duet-gender-a'),
  duetGenderB: document.getElementById('duet-gender-b'),
  generateBtn: document.getElementById('generate-btn'),
  generateLabel: document.getElementById('generate-label'),
  generateStatus: document.getElementById('generate-status'),
  creditsPill: document.getElementById('credits-pill'),
  tracksPill: document.getElementById('tracks-pill'),
  playerEmpty: document.getElementById('player-empty'),
  player: document.getElementById('player'),
  playerTitle: document.getElementById('player-title'),
  playerMeta: document.getElementById('player-meta'),
  audioEl: document.getElementById('audio-el'),
  saveBtn: document.getElementById('save-btn'),
  savePersonaBtn: document.getElementById('save-persona-btn'),
  downloadLink: document.getElementById('download-link'),
  libraryList: document.getElementById('library-list'),
  libraryCount: document.getElementById('library-count'),
  topPlayedList: document.getElementById('top-played-list'),
  topPlayedCount: document.getElementById('top-played-count'),
  personasList: document.getElementById('personas-list'),
  personasCount: document.getElementById('personas-count'),
  personaForm: document.getElementById('persona-form'),
  personaName: document.getElementById('persona-name'),
  personaDescription: document.getElementById('persona-description'),
  personaStart: document.getElementById('persona-start'),
  personaEnd: document.getElementById('persona-end'),
  personaFormSave: document.getElementById('persona-form-save'),
  personaFormCancel: document.getElementById('persona-form-cancel'),
  personaFormStatus: document.getElementById('persona-form-status'),
  publishBtn: document.getElementById('publish-btn'),
  publishModal: document.getElementById('publish-modal'),
  publishSource: document.getElementById('publish-source'),
  publishAlbum: document.getElementById('publish-album'),
  publishNewAlbumFields: document.getElementById('publish-new-album-fields'),
  publishNewName: document.getElementById('publish-new-name'),
  publishNewSlugPreview: document.getElementById('publish-new-slug-preview'),
  publishNewYear: document.getElementById('publish-new-year'),
  publishNewDesc: document.getElementById('publish-new-desc'),
  publishPositionMode: document.getElementById('publish-position-mode'),
  publishPositionN: document.getElementById('publish-position-n'),
  publishDisplayTitle: document.getElementById('publish-display-title'),
  publishTrackType: document.getElementById('publish-track-type'),
  publishLyrics: document.getElementById('publish-lyrics'),
  publishSubmit: document.getElementById('publish-submit'),
  publishStatus: document.getElementById('publish-status'),
};

let jamplaysAlbums = []; // cached from list-jamplays-albums
let publishContextTrack = null; // the saved-library row currently being published

let currentResults = null; // [{audio_url, image_url, title, duration, ...}, {...}]
let currentTaskId = null;
let activeVersion = 0;
let pollingTimer = null;
let savedTracks = [];
let savedPersonas = [];
let referenceUploadUrl = null; // public URL of uploaded MP3 reference (if any)
let autosavedIds = new Set(); // suno_audio_ids already autosaved for the current generation
let autosaveRunning = false;
let activeLibraryTrackId = null; // js_tracks.id of the saved track currently in the player
let playLoggedForCurrent = false; // ensures one log per track-load (no pause/resume spam)

// ---------- Init ----------

async function init() {
  await Promise.all([refreshCredits(), refreshLibrary(), refreshPersonas()]);

  els.translateBtn.addEventListener('click', handleTranslate);
  els.soundsLikeBtn.addEventListener('click', handleSoundsLike);
  els.generateBtn.addEventListener('click', handleGenerate);
  els.saveBtn.addEventListener('click', handleSave);
  if (els.savePersonaBtn) els.savePersonaBtn.addEventListener('click', openPersonaForm);
  if (els.personaFormSave) els.personaFormSave.addEventListener('click', handleSavePersona);
  if (els.personaFormCancel) els.personaFormCancel.addEventListener('click', closePersonaForm);

  // Reference MP3 upload — drag/drop + file picker
  els.dropZone.addEventListener('click', () => els.refFile.click());
  els.refFile.addEventListener('change', e => e.target.files[0] && handleReferenceFile(e.target.files[0]));
  els.dropZone.addEventListener('dragover', e => { e.preventDefault(); els.dropZone.classList.add('dragover'); });
  els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('dragover'));
  els.dropZone.addEventListener('drop', e => {
    e.preventDefault();
    els.dropZone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleReferenceFile(e.dataTransfer.files[0]);
  });
  els.refClear.addEventListener('click', clearReference);
  els.audioWeightSlider.addEventListener('input', () => {
    els.audioWeightOut.textContent = parseFloat(els.audioWeightSlider.value).toFixed(2);
  });

  // Duet mode toggle — reveal/hide voice fields and update credit label.
  if (els.duetMode) {
    els.duetMode.addEventListener('change', () => {
      els.duetFields.classList.toggle('hidden', !els.duetMode.checked);
      updateGenerateLabel();
    });
  }

  document.querySelectorAll('.version-btn').forEach(btn => {
    btn.addEventListener('click', () => switchVersion(parseInt(btn.dataset.version, 10)));
  });

  // Log a play the first time audio starts for the currently-loaded library
  // track. Only saved library tracks (those with a js_tracks.id) are tracked;
  // freshly-generated tracks aren't counted until they're saved.
  if (els.audioEl) {
    els.audioEl.addEventListener('play', () => {
      if (!activeLibraryTrackId || playLoggedForCurrent) return;
      playLoggedForCurrent = true;
      logPlay(activeLibraryTrackId);
    });
  }

  // Publish-to-JamPlays handlers
  if (els.publishBtn) els.publishBtn.addEventListener('click', openPublishModalFromPlayer);
  document.querySelectorAll('[data-publish-close]').forEach(el => el.addEventListener('click', closePublishModal));
  if (els.publishAlbum) els.publishAlbum.addEventListener('change', onPublishAlbumChange);
  if (els.publishPositionMode) els.publishPositionMode.addEventListener('change', updatePositionUI);
  if (els.publishNewName) els.publishNewName.addEventListener('input', () => {
    const slug = slugifyClient(els.publishNewName.value);
    els.publishNewSlugPreview.textContent = `URL: jamplays.netlify.app/${slug || '—'}/`;
  });
  if (els.publishSubmit) els.publishSubmit.addEventListener('click', handlePublishSubmit);

  // Prefetch JamPlays albums in the background so the modal opens fast
  refreshJamplaysAlbums();
}

async function logPlay(trackId) {
  try {
    const res = await fetch(`${API}/log-play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: trackId }),
    });
    if (!res.ok) throw new Error(`log-play ${res.status}`);
    const data = await res.json();
    // Update the in-memory row so the badge bumps immediately without a full refetch.
    const t = savedTracks.find(x => x.id === trackId);
    if (t) {
      t.play_count = data.play_count;
      t.last_played_at = new Date().toISOString();
    }
    renderLibrary();
    renderTopPlayed();
  } catch (e) {
    console.warn('logPlay failed', e);
  }
}

// ---------- Credits ----------

async function refreshCredits() {
  try {
    const res = await fetch(`${API}/get-credits`);
    const data = await res.json();
    if (data.credits != null) {
      els.creditsPill.textContent = `${data.credits} credits`;
    }
  } catch (e) {
    console.error('credits', e);
    els.creditsPill.textContent = 'credits ?';
  }
}

// ---------- Translate brief ----------

async function handleTranslate() {
  const brief = els.projectBrief.value.trim();
  if (!brief) {
    setStatus(els.translateStatus, 'Type a project description first.', 'error');
    return;
  }

  els.translateBtn.disabled = true;
  setStatus(els.translateStatus, 'Asking Claude...', '');

  try {
    const res = await fetch(`${API}/translate-brief`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Translation failed');

    if (data.title) els.title.value = data.title;
    if (data.style) els.style.value = data.style;
    if (data.prompt) els.prompt.value = data.prompt;
    if (data.instrumental != null) els.instrumental.value = String(!!data.instrumental);
    if (data.negativeTags) els.negativeTags.value = data.negativeTags;
    if (data.vocalGender) els.vocalGender.value = data.vocalGender;

    setStatus(els.translateStatus, 'Filled. Edit anything before generating.', 'success');
  } catch (e) {
    setStatus(els.translateStatus, `Error: ${e.message}`, 'error');
  } finally {
    els.translateBtn.disabled = false;
  }
}

// ---------- Sounds like (reference song) ----------

async function handleSoundsLike() {
  const query = els.soundsLike.value.trim();
  if (!query) {
    setStatus(els.soundsLikeStatus, 'Type a song name (e.g. "Dylan LeBlanc Coyote").', 'error');
    return;
  }

  els.soundsLikeBtn.disabled = true;
  setStatus(els.soundsLikeStatus, 'Looking up on Last.fm...', '');

  try {
    const res = await fetch(`${API}/sounds-like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sounds-like failed');

    if (data.style) els.style.value = data.style;
    if (data.vocalGender) els.vocalGender.value = data.vocalGender;

    const ref = data.reference || {};
    const refText = ref.name && ref.artist
      ? `Matched: "${ref.name}" by ${ref.artist}. Style filled in. ${data.notes || ''}`
      : 'Style filled in.';
    setStatus(els.soundsLikeStatus, refText, 'success');
  } catch (e) {
    setStatus(els.soundsLikeStatus, `Error: ${e.message}`, 'error');
  } finally {
    els.soundsLikeBtn.disabled = false;
  }
}

// ---------- Reference MP3 upload ----------

async function handleReferenceFile(file) {
  if (!file.type.startsWith('audio/')) {
    setStatus(els.refStatus, 'Please choose an audio file (MP3).', 'error');
    return;
  }
  if (file.size > 6 * 1024 * 1024) {
    setStatus(els.refStatus, `${(file.size/1024/1024).toFixed(1)}MB is over the 6MB limit. Trim to a 30-60s clip.`, 'error');
    return;
  }

  setStatus(els.refStatus, `Uploading ${file.name}...`, '');
  els.dropZoneLabel.textContent = 'Uploading...';

  try {
    const res = await fetch(`${API}/upload-reference`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/mpeg' },
      body: file,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');

    referenceUploadUrl = data.publicUrl;
    els.refName.textContent = file.name;
    els.refSize.textContent = `(${(data.sizeBytes/1024/1024).toFixed(2)}MB)`;
    els.refPreview.src = data.publicUrl;
    els.refLoaded.classList.remove('hidden');
    els.dropZone.classList.add('loaded');
    els.dropZoneLabel.textContent = 'Reference loaded — see preview below';
    setStatus(els.refStatus, 'Reference uploaded. Suno will mimic its feel when you Generate.', 'success');
    updateGenerateLabel();
  } catch (e) {
    setStatus(els.refStatus, `Error: ${e.message}`, 'error');
    els.dropZoneLabel.textContent = 'Drag MP3 here or click to choose';
    referenceUploadUrl = null;
  }
}

function clearReference() {
  referenceUploadUrl = null;
  els.refFile.value = '';
  els.refPreview.src = '';
  els.refLoaded.classList.add('hidden');
  els.dropZone.classList.remove('loaded');
  els.dropZoneLabel.textContent = 'Drag MP3 here or click to choose';
  setStatus(els.refStatus, '', '');
  updateGenerateLabel();
}

function updateGenerateLabel() {
  const duet = els.duetMode && els.duetMode.checked;
  if (referenceUploadUrl) {
    els.generateLabel.textContent = duet
      ? 'Generate duet from MP3 reference · ~20 credits'
      : 'Generate from MP3 reference · ~10 credits';
  } else {
    els.generateLabel.textContent = duet
      ? 'Generate duet · ~16 credits'
      : 'Generate · ~8 credits';
  }
}

// ---------- Generate ----------

async function handleGenerate() {
  if (els.duetMode && els.duetMode.checked) {
    return handleGenerateDuet();
  }
  const payload = collectPayload();
  if (!payload.style || !payload.title) {
    setStatus(els.generateStatus, 'Style and title are required.', 'error');
    return;
  }

  els.generateBtn.disabled = true;
  setStatus(els.generateStatus, 'Submitting to Suno...', '');
  // Clear any stale state from a previous generation so a leftover poll
  // can't autosave the old tracks under this new task.
  if (pollingTimer) { clearTimeout(pollingTimer); pollingTimer = null; }
  currentResults = null;
  currentTaskId = null;
  activeLibraryTrackId = null;
  playLoggedForCurrent = false;
  autosavedIds = new Set();

  try {
    const res = await fetch(`${API}/generate-music`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Generation failed');
    if (!data.taskId) throw new Error('Suno did not return a taskId');

    currentTaskId = data.taskId;
    setStatus(els.generateStatus, 'Task started. Polling for results...', '');
    pollForResults();
  } catch (e) {
    setStatus(els.generateStatus, `Error: ${e.message}`, 'error');
    els.generateBtn.disabled = false;
  }
}

function collectPayload() {
  const payload = {
    title: els.title.value.trim(),
    style: els.style.value.trim(),
    prompt: els.prompt.value.trim(),
    model: els.model.value,
    instrumental: els.instrumental.value === 'true',
    negativeTags: els.negativeTags.value.trim(),
    vocalGender: els.vocalGender.value || null,
    styleWeight: parseFloat(els.styleWeight.value) || null,
    weirdnessConstraint: parseFloat(els.weirdness.value) || null,
    projectBrief: els.projectBrief.value.trim(),
  };
  if (referenceUploadUrl) {
    payload.uploadUrl = referenceUploadUrl;
    payload.audioWeight = parseFloat(els.audioWeightSlider.value);
  } else {
    payload.audioWeight = parseFloat(els.audioWeight.value) || null;
  }
  if (els.personaSelect && els.personaSelect.value) {
    payload.personaId = els.personaSelect.value;
    payload.personaModel = 'style_persona';
  }
  return payload;
}

// ---------- Duet mode ----------

function splitLyricsByDuet(lyrics, voiceA, voiceB) {
  // Returns { a, b } — lyrics for each voice's stem.
  // Recognized tags:
  //   [Section: VoiceName ...]   — whole section goes to that voice
  //   [Section: both / harmonized / call and response / VoiceA and VoiceB] — shared
  //   (VoiceName) line text      — single line goes to that voice
  //   plain line                 — inherits the current section's voice
  // Section headers themselves are kept in BOTH stems so structure stays aligned.
  const lines = (lyrics || '').split('\n');
  const aLines = [];
  const bLines = [];
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const aRe = new RegExp(`\\b${esc(voiceA)}\\b`, 'i');
  const bRe = new RegExp(`\\b${esc(voiceB)}\\b`, 'i');
  let target = 'both';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { aLines.push(line); bLines.push(line); continue; }

    const section = trimmed.match(/^\[([^\]]+)\]\s*$/);
    if (section) {
      const inner = section[1];
      const hasA = aRe.test(inner);
      const hasB = bRe.test(inner);
      if (hasA && !hasB) target = 'a';
      else if (hasB && !hasA) target = 'b';
      else target = 'both';
      aLines.push(line);
      bLines.push(line);
      continue;
    }

    const inline = trimmed.match(/^\(([^)]+)\)\s*(.*)$/);
    if (inline) {
      const speaker = inline[1];
      const content = inline[2];
      const isA = aRe.test(speaker);
      const isB = bRe.test(speaker);
      if (isA && !isB) aLines.push(content);
      else if (isB && !isA) bLines.push(content);
      else { aLines.push(content); bLines.push(content); }
      continue;
    }

    if (target === 'a') aLines.push(line);
    else if (target === 'b') bLines.push(line);
    else { aLines.push(line); bLines.push(line); }
  }

  return { a: aLines.join('\n').trim(), b: bLines.join('\n').trim() };
}

async function handleGenerateDuet() {
  const base = collectPayload();
  if (!base.style || !base.title) {
    setStatus(els.generateStatus, 'Style and title are required.', 'error');
    return;
  }
  if (base.instrumental) {
    setStatus(els.generateStatus, 'Duet mode requires vocals. Set Instrumental to No.', 'error');
    return;
  }
  if (!base.prompt) {
    setStatus(els.generateStatus, 'Duet mode needs lyrics with speaker tags.', 'error');
    return;
  }
  const voiceA = (els.duetNameA.value || 'Voice A').trim();
  const voiceB = (els.duetNameB.value || 'Voice B').trim();
  if (!voiceA || !voiceB) {
    setStatus(els.generateStatus, 'Both Voice A and Voice B names are required.', 'error');
    return;
  }
  if (voiceA.toLowerCase() === voiceB.toLowerCase()) {
    setStatus(els.generateStatus, 'Voice A and Voice B need different names.', 'error');
    return;
  }

  els.generateBtn.disabled = true;
  setStatus(els.generateStatus, 'Splitting lyrics and submitting both voices to Suno...', '');
  // Clear single-track state so a leftover poll can't interfere.
  if (pollingTimer) { clearTimeout(pollingTimer); pollingTimer = null; }
  currentResults = null;
  currentTaskId = null;
  activeLibraryTrackId = null;
  playLoggedForCurrent = false;
  autosavedIds = new Set();

  const { a: lyricsA, b: lyricsB } = splitLyricsByDuet(base.prompt, voiceA, voiceB);
  const duetPairId = (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : `pair-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const buildPayload = (name, gender, personaId, lyrics) => {
    const p = { ...base };
    p.title = `${base.title} — ${name}`;
    p.prompt = lyrics || base.prompt; // fall back if split produced nothing
    p.vocalGender = gender || null;
    if (personaId) {
      p.personaId = personaId;
      p.personaModel = 'style_persona';
    } else {
      delete p.personaId;
      delete p.personaModel;
    }
    return p;
  };

  const payloadA = buildPayload(voiceA, els.duetGenderA.value, els.duetPersonaA.value, lyricsA);
  const payloadB = buildPayload(voiceB, els.duetGenderB.value, els.duetPersonaB.value, lyricsB);

  const runVoice = async (payload, role, voiceName, partnerName) => {
    // 1. Kick off Suno generation
    const res = await fetch(`${API}/generate-music`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Generation failed');
    if (!data.taskId) throw new Error('Suno did not return a taskId');

    // 2. Poll until complete
    const tracks = await pollDuetTask(data.taskId, voiceName);

    // 3. Show the first complete voice in the player so the user has audio
    if (!currentResults) {
      currentTaskId = data.taskId;
      currentResults = tracks;
      showResults();
    }

    // 4. Autosave both versions with duet metadata
    const duetMeta = { pair_id: duetPairId, role, voice_name: voiceName, partner_name: partnerName };
    await autosaveDuetTracks(tracks, data.taskId, payload, duetMeta);
    return tracks;
  };

  setStatus(els.generateStatus, `Both voices generating in parallel — this takes ~2–3 minutes.`, '');

  const [resA, resB] = await Promise.allSettled([
    runVoice(payloadA, 'a', voiceA, voiceB),
    runVoice(payloadB, 'b', voiceB, voiceA),
  ]);

  els.generateBtn.disabled = false;
  refreshCredits();
  await refreshLibrary();

  const fails = [resA, resB].filter(r => r.status === 'rejected');
  if (fails.length === 0) {
    setStatus(els.generateStatus, 'Duet complete. Both voices saved to library.', 'success');
  } else if (fails.length === 1) {
    const which = resA.status === 'rejected' ? voiceA : voiceB;
    const reason = fails[0].reason && fails[0].reason.message || String(fails[0].reason);
    setStatus(els.generateStatus, `${which} failed: ${reason}. The other voice was saved.`, 'error');
  } else {
    const msgs = fails.map(f => f.reason && f.reason.message || String(f.reason)).join(' | ');
    setStatus(els.generateStatus, `Both generations failed: ${msgs}`, 'error');
  }
}

async function pollDuetTask(taskId, voiceName) {
  // Polls one Suno task to completion. Returns the final tracks array.
  // Independent of the single-track currentTaskId so two of these can run in parallel.
  const maxAttempts = 60; // ~5 minutes
  await sleep(8000);
  for (let attempts = 1; attempts <= maxAttempts; attempts++) {
    let data;
    try {
      const res = await fetch(`${API}/check-status?taskId=${encodeURIComponent(taskId)}`);
      data = await res.json();
    } catch (e) {
      // Transient network error — try again
      await sleep(5000);
      continue;
    }
    if (data.status === 'complete') return data.tracks || [];
    if (data.status === 'error') throw new Error(data.message || `${voiceName}: Suno reported an error`);
    setStatus(els.generateStatus, `[${voiceName}] ${data.status || 'pending'} (${attempts * 5}s)...`, '');
    await sleep(5000);
  }
  throw new Error(`${voiceName}: timed out`);
}

async function autosaveDuetTracks(tracks, taskId, payload, duetMeta) {
  const briefSnapshot = { ...collectPayload(), prompt: payload.prompt, title: payload.title };
  briefSnapshot.duet = duetMeta;

  const ops = (tracks || []).filter(t => t && t.id).map(async (track) => {
    try {
      const res = await fetch(`${API}/save-track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suno_audio_id: track.id,
          suno_task_id: taskId,
          suno_audio_url: track.audio_url || track.stream_audio_url,
          title: payload.title,
          style: payload.style,
          prompt: payload.prompt,
          model: track.model_name || payload.model,
          instrumental: !!payload.instrumental,
          duration: track.duration,
          image_url: track.image_url,
          tags: track.tags,
          project_brief: payload.projectBrief,
          music_brief: briefSnapshot,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `save failed (${res.status})`);
      }
    } catch (e) {
      console.error(`duet autosave failed for ${duetMeta.voice_name} ${track.id}`, e);
    }
  });
  await Promise.all(ops);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function pollForResults() {
  if (pollingTimer) { clearTimeout(pollingTimer); pollingTimer = null; }
  let attempts = 0;
  const maxAttempts = 60; // 5 minutes at 5s interval
  // Capture the task ID this poller belongs to. If currentTaskId changes
  // (user kicked off a new generation), this poller exits silently — it
  // must NOT autosave the old task's tracks under the new task's context.
  const myTaskId = currentTaskId;

  const poll = async () => {
    attempts++;
    if (currentTaskId !== myTaskId) return; // superseded by a newer generation
    try {
      const res = await fetch(`${API}/check-status?taskId=${myTaskId}`);
      const data = await res.json();
      if (currentTaskId !== myTaskId) return; // changed while we were awaiting

      if (data.status === 'streaming' || data.status === 'complete') {
        // We have at least streaming URLs
        currentResults = data.tracks;
        showResults();
        if (data.status === 'complete') {
          setStatus(els.generateStatus, `Done. Saving ${data.tracks.length} tracks to library...`, '');
          els.generateBtn.disabled = false;
          refreshCredits();
          pollingTimer = null;
          await autosaveAll(data.tracks);
          return;
        } else {
          setStatus(els.generateStatus, 'Streaming ready. Final files baking...', '');
        }
      } else if (data.status === 'error') {
        throw new Error(data.message || 'Suno reported an error');
      } else {
        setStatus(els.generateStatus, `Generating... (${attempts * 5}s)`, '');
      }

      if (attempts < maxAttempts) {
        pollingTimer = setTimeout(poll, 5000);
      } else {
        setStatus(els.generateStatus, 'Timed out waiting. Refresh to retry.', 'error');
        els.generateBtn.disabled = false;
        pollingTimer = null;
      }
    } catch (e) {
      setStatus(els.generateStatus, `Error: ${e.message}`, 'error');
      els.generateBtn.disabled = false;
      pollingTimer = null;
    }
  };

  pollingTimer = setTimeout(poll, 8000); // first poll after 8s
}

// ---------- Display results ----------

function showResults() {
  els.playerEmpty.classList.add('hidden');
  els.player.classList.remove('hidden');
  switchVersion(0);
}

function switchVersion(idx) {
  if (!currentResults || !currentResults[idx]) return;
  activeVersion = idx;
  const track = currentResults[idx];

  els.playerTitle.textContent = track.title || 'Untitled';
  els.playerMeta.textContent = `${formatDuration(track.duration)} · ${track.tags || ''} · ${track.model_name || ''}`;

  const url = track.audio_url || track.stream_audio_url;
  els.audioEl.src = url;
  els.downloadLink.href = url;
  els.downloadLink.setAttribute('download', `${track.title || 'jamsounds'}-v${idx + 1}.mp3`);

  document.querySelectorAll('.version-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i === idx);
  });

  // Show ✓ if this version was already (auto)saved, otherwise ♡.
  updateSaveButtonForActive();
  // Reset persona button to default for whichever track is now active.
  if (els.savePersonaBtn) {
    els.savePersonaBtn.textContent = '👤';
    els.savePersonaBtn.disabled = false;
  }
}

function formatDuration(seconds) {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ---------- Save ----------

async function handleSave() {
  if (!currentResults) return;
  const track = currentResults[activeVersion];
  if (!track) return;

  els.saveBtn.disabled = true;
  els.saveBtn.textContent = '...';

  try {
    const res = await fetch(`${API}/save-track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        suno_audio_id: track.id,
        suno_task_id: currentTaskId,
        suno_audio_url: track.audio_url || track.stream_audio_url,
        title: els.title.value.trim() || track.title,
        style: els.style.value.trim(),
        prompt: els.prompt.value.trim(),
        model: track.model_name || els.model.value,
        instrumental: els.instrumental.value === 'true',
        duration: track.duration,
        image_url: track.image_url,
        tags: track.tags,
        project_brief: els.projectBrief.value.trim(),
        music_brief: collectPayload(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');

    els.saveBtn.classList.add('saved');
    els.saveBtn.textContent = '✓';
    if (track.id) autosavedIds.add(track.id);
    await refreshLibrary();
  } catch (e) {
    alert(`Save error: ${e.message}`);
    els.saveBtn.textContent = '♡';
  } finally {
    els.saveBtn.disabled = false;
  }
}

// ---------- Autosave (both versions, on generation complete) ----------

async function autosaveAll(tracks) {
  if (autosaveRunning) return;
  autosaveRunning = true;

  const briefSnapshot = collectPayload();
  const projectBrief = els.projectBrief.value.trim();
  const styleVal = els.style.value.trim();
  const promptVal = els.prompt.value.trim();
  const instrumentalVal = els.instrumental.value === 'true';
  const titleVal = els.title.value.trim();

  const toSave = tracks.filter(t => t && t.id && !autosavedIds.has(t.id));
  let okCount = 0;
  const failures = [];

  // Run in parallel — save-track is independent per track.
  await Promise.all(toSave.map(async (track) => {
    try {
      const res = await fetch(`${API}/save-track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suno_audio_id: track.id,
          suno_task_id: currentTaskId,
          suno_audio_url: track.audio_url || track.stream_audio_url,
          title: titleVal || track.title,
          style: styleVal,
          prompt: promptVal,
          model: track.model_name || els.model.value,
          instrumental: instrumentalVal,
          duration: track.duration,
          image_url: track.image_url,
          tags: track.tags,
          project_brief: projectBrief,
          music_brief: briefSnapshot,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      autosavedIds.add(track.id);
      okCount++;
    } catch (e) {
      console.error('autosave failed for', track.id, e);
      failures.push({ id: track.id, msg: e.message });
    }
  }));

  await refreshLibrary();
  updateSaveButtonForActive();

  if (failures.length === 0) {
    setStatus(els.generateStatus, `Done. ${okCount} tracks saved to library.`, 'success');
  } else {
    setStatus(
      els.generateStatus,
      `Saved ${okCount}/${tracks.length}. ${failures.length} failed — try the ♡ button to retry.`,
      'error'
    );
  }

  autosaveRunning = false;
}

function updateSaveButtonForActive() {
  const track = currentResults && currentResults[activeVersion];
  if (!track) return;
  if (autosavedIds.has(track.id)) {
    els.saveBtn.classList.add('saved');
    els.saveBtn.textContent = '✓';
    els.saveBtn.disabled = true;
    els.saveBtn.title = 'Already in library';
  } else {
    els.saveBtn.classList.remove('saved');
    els.saveBtn.textContent = '♡';
    els.saveBtn.disabled = false;
    els.saveBtn.title = 'Save to library';
  }
}

// ---------- Library ----------

async function refreshLibrary() {
  try {
    const res = await fetch(`${API}/list-tracks`);
    const data = await res.json();
    savedTracks = data.tracks || [];
    renderLibrary();
    renderTopPlayed();
    els.tracksPill.textContent = `${savedTracks.length} saved`;
    els.libraryCount.textContent = `${savedTracks.length} saved`;
  } catch (e) {
    console.error('library', e);
  }
}

function renderLibrary() {
  if (!savedTracks.length) {
    els.libraryList.innerHTML = '<p class="empty-hint">No saved tracks yet.</p>';
    return;
  }

  els.libraryList.innerHTML = savedTracks.map(t => {
    const duet = t.music_brief && t.music_brief.duet;
    const duetBadge = duet
      ? `<span class="duet-badge" title="Duet pair ${escapeAttr(duet.pair_id || '')}">DUET · ${escapeHtml((duet.role || '').toUpperCase())} · ${escapeHtml(duet.voice_name || '')}</span>`
      : '';
    const plays = t.play_count || 0;
    const playBadge = plays > 0
      ? `<span class="play-count-badge${plays >= 5 ? ' hot' : ''}" title="${plays} play${plays === 1 ? '' : 's'}">▶ ${plays}</span>`
      : '';
    const dlUrl = t.storage_audio_url || t.suno_audio_url || '';
    const dlName = `${(t.title || 'untitled').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60)}.mp3`;
    const downloadBtn = dlUrl
      ? `<button class="library-item-download" data-url="${escapeAttr(dlUrl)}" data-name="${escapeAttr(dlName)}" title="Download MP3">↓</button>`
      : '';
    return `
    <div class="library-item" data-id="${t.id}">
      <div class="library-item-info">
        <p class="library-item-title">${escapeHtml(t.title || 'Untitled')} ${duetBadge}</p>
        <p class="library-item-meta">${escapeHtml(t.style || '')} · ${formatDuration(t.duration)}</p>
      </div>
      ${playBadge}
      <span class="library-item-date">${formatDate(t.created_at)}</span>
      ${downloadBtn}
      <button class="library-item-delete" data-id="${t.id}" title="Delete">×</button>
    </div>
  `;
  }).join('');

  els.libraryList.querySelectorAll('.library-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('library-item-delete')) return;
      if (e.target.classList.contains('library-item-download')) return;
      const id = item.dataset.id;
      const t = savedTracks.find(x => x.id === id);
      if (!t) return;
      playSavedTrack(t);
    });
  });

  els.libraryList.querySelectorAll('.library-item-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this track?')) return;
      const id = btn.dataset.id;
      try {
        await fetch(`${API}/list-tracks?id=${id}`, { method: 'DELETE' });
        await refreshLibrary();
      } catch (e) {
        alert(`Delete error: ${e.message}`);
      }
    });
  });

  els.libraryList.querySelectorAll('.library-item-download').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const url = btn.dataset.url;
      const name = btn.dataset.name || 'track.mp3';
      if (!url) return;
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = '…';
      try {
        await downloadFromUrl(url, name);
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1200);
      } catch (err) {
        console.error('download failed', err);
        alert(`Download failed: ${err.message}`);
        btn.textContent = original;
        btn.disabled = false;
      }
    });
  });
}

function renderTopPlayed() {
  if (!els.topPlayedList) return;
  const played = savedTracks.filter(t => (t.play_count || 0) > 0);
  const totalPlays = played.reduce((sum, t) => sum + (t.play_count || 0), 0);
  els.topPlayedCount.textContent = totalPlays
    ? `${totalPlays} play${totalPlays === 1 ? '' : 's'} · ${played.length} track${played.length === 1 ? '' : 's'}`
    : '—';

  if (!played.length) {
    els.topPlayedList.innerHTML = '<p class="empty-hint">No plays yet. Press play on a library track to start counting.</p>';
    return;
  }

  const top = [...played].sort((a, b) => (b.play_count || 0) - (a.play_count || 0)).slice(0, 10);
  const max = top[0].play_count || 1;

  els.topPlayedList.innerHTML = top.map((t, i) => {
    const plays = t.play_count || 0;
    const pct = Math.max(4, Math.round((plays / max) * 100));
    const lastPlayed = t.last_played_at
      ? `last ${formatDate(t.last_played_at)}`
      : '';
    return `
    <div class="library-item" data-id="${t.id}">
      <div class="library-item-info">
        <p class="library-item-title">${i + 1}. ${escapeHtml(t.title || 'Untitled')}</p>
        <p class="library-item-meta">${escapeHtml(t.style || '')} · ${plays} play${plays === 1 ? '' : 's'}${lastPlayed ? ' · ' + lastPlayed : ''}</p>
        <div class="top-played-bar"><span style="width:${pct}%;"></span></div>
      </div>
    </div>
  `;
  }).join('');

  // Click a top-played row → load that track into the player (same as library).
  els.topPlayedList.querySelectorAll('.library-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      const t = savedTracks.find(x => x.id === id);
      if (t) playSavedTrack(t);
    });
  });
}

// Fetches a remote file and triggers a save dialog with the chosen filename.
// Needed because the <a download> attribute is ignored for cross-origin URLs
// (e.g. Supabase Storage), so the browser would otherwise just navigate to it.
async function downloadFromUrl(url, filename) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been handled.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function playSavedTrack(t) {
  currentResults = [{
    id: t.suno_audio_id,
    title: t.title,
    duration: t.duration,
    audio_url: t.storage_audio_url || t.suno_audio_url,
    stream_audio_url: t.storage_audio_url || t.suno_audio_url,
    image_url: t.image_url,
    tags: t.style,
    model_name: t.model,
  }];
  // Restore the original Suno task ID so Save-as-Persona works for library tracks too.
  currentTaskId = t.suno_task_id || null;
  // Mark this as the active library track so a 'play' event logs against it,
  // and reset the once-per-load flag so a fresh click counts again.
  activeLibraryTrackId = t.id;
  playLoggedForCurrent = false;
  els.playerEmpty.classList.add('hidden');
  els.player.classList.remove('hidden');
  switchVersion(0);
  // hide v2 since saved tracks are single
  document.querySelectorAll('.version-btn')[1].style.display = 'none';
  document.querySelectorAll('.version-btn')[0].textContent = 'saved';

  // Repopulate the brief fields so the user can tweak and re-generate from the
  // same starting point. Prefer the saved music_brief snapshot; fall back to
  // the row's direct columns for tracks saved before music_brief existed.
  repopulateFormFromTrack(t);
}

function repopulateFormFromTrack(t) {
  const b = (t && t.music_brief) || {};
  const setVal = (el, v) => { if (el && v != null && v !== '') el.value = v; };
  const setNum = (el, v) => { if (el && v != null && !Number.isNaN(Number(v))) el.value = v; };

  // Strip the duet name suffix (" — Jimmy") so the title is editable as-is.
  let titleVal = b.title || t.title || '';
  if (b.duet && b.duet.voice_name && titleVal.endsWith(` — ${b.duet.voice_name}`)) {
    titleVal = titleVal.slice(0, -1 * (` — ${b.duet.voice_name}`.length));
  }
  setVal(els.title, titleVal);
  setVal(els.model, b.model || t.model);
  setVal(els.style, b.style || t.style);
  setVal(els.prompt, b.prompt || t.prompt);
  setVal(els.projectBrief, b.projectBrief || t.project_brief);

  if (els.instrumental) {
    const inst = b.instrumental != null ? b.instrumental : t.instrumental;
    if (inst != null) els.instrumental.value = String(!!inst);
  }
  setVal(els.negativeTags, b.negativeTags);
  if (els.vocalGender) els.vocalGender.value = b.vocalGender || '';

  setNum(els.styleWeight, b.styleWeight);
  setNum(els.weirdness, b.weirdnessConstraint);
  setNum(els.audioWeight, b.audioWeight);

  // Persona — only restore if it still exists in the saved list.
  if (els.personaSelect) {
    const personaStillExists = b.personaId && savedPersonas.some(p => p.persona_id === b.personaId);
    els.personaSelect.value = personaStillExists ? b.personaId : '';
  }

  // Reference MP3: we can't re-upload the original file, so just clear any
  // stale reference state and note it for the user.
  if (referenceUploadUrl) clearReference();

  // Duet mode: leave the checkbox off (each saved track is one stem). But if
  // this row was part of a duet pair, restore that voice's gender/persona
  // into the duet sub-fields so the user can flip duet mode back on with the
  // original assignments still in place.
  if (b.duet && els.duetGenderA) {
    const role = b.duet.role; // 'a' or 'b'
    const voiceName = b.duet.voice_name || '';
    if (role === 'a') {
      setVal(els.duetNameA, voiceName);
      els.duetGenderA.value = b.vocalGender || '';
      if (els.duetPersonaA) els.duetPersonaA.value = (b.personaId && savedPersonas.some(p => p.persona_id === b.personaId)) ? b.personaId : '';
    } else if (role === 'b') {
      setVal(els.duetNameB, voiceName);
      els.duetGenderB.value = b.vocalGender || '';
      if (els.duetPersonaB) els.duetPersonaB.value = (b.personaId && savedPersonas.some(p => p.persona_id === b.personaId)) ? b.personaId : '';
    }
  }

  updateGenerateLabel();

  const note = b.duet
    ? `Loaded settings from "${t.title}" (duet · ${b.duet.voice_name || b.duet.role}). Tweak and Generate to recreate.`
    : `Loaded settings from "${t.title}". Tweak anything and Generate to recreate.`;
  setStatus(els.generateStatus, note, 'success');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function setStatus(el, msg, kind) {
  el.textContent = msg;
  el.className = 'status-line' + (kind ? ` ${kind}` : '');
}

// ---------- Personas ----------

async function refreshPersonas() {
  try {
    const res = await fetch(`${API}/list-personas`);
    const data = await res.json();
    savedPersonas = data.personas || [];
    renderPersonas();
    renderPersonaSelect();
  } catch (e) {
    console.error('personas', e);
  }
}

function renderPersonaSelect() {
  const optionsHtml = '<option value="">None</option>' + savedPersonas.map(p =>
    `<option value="${escapeAttr(p.persona_id)}">${escapeHtml(p.name)}</option>`
  ).join('');
  const isValid = (v) => v && savedPersonas.some(p => p.persona_id === v);
  for (const sel of [els.personaSelect, els.duetPersonaA, els.duetPersonaB]) {
    if (!sel) continue;
    const current = sel.value;
    sel.innerHTML = optionsHtml;
    if (isValid(current)) sel.value = current;
  }
}

function renderPersonas() {
  if (!els.personasList) return;
  els.personasCount.textContent = `${savedPersonas.length} saved`;
  if (!savedPersonas.length) {
    els.personasList.innerHTML = '<p class="empty-hint">No personas yet.</p>';
    return;
  }
  els.personasList.innerHTML = savedPersonas.map(p => `
    <div class="library-item" data-id="${escapeAttr(p.id)}">
      <div class="library-item-info">
        <p class="library-item-title">${escapeHtml(p.name)}</p>
        <p class="library-item-meta">${escapeHtml((p.description || '').slice(0, 80))}</p>
      </div>
      <span class="library-item-date">${formatDate(p.created_at)}</span>
      <button class="library-item-delete" data-id="${escapeAttr(p.id)}" title="Delete">×</button>
    </div>
  `).join('');

  els.personasList.querySelectorAll('.library-item-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this persona? Songs already generated with it are unaffected.')) return;
      const id = btn.dataset.id;
      try {
        await fetch(`${API}/list-personas?id=${id}`, { method: 'DELETE' });
        await refreshPersonas();
      } catch (e) {
        alert(`Delete error: ${e.message}`);
      }
    });
  });

  // Click a persona row to auto-select it in the generate form.
  els.personasList.querySelectorAll('.library-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('library-item-delete')) return;
      const id = item.dataset.id;
      const p = savedPersonas.find(x => x.id === id);
      if (p && els.personaSelect) {
        els.personaSelect.value = p.persona_id;
        setStatus(els.generateStatus, `Persona "${p.name}" selected for next generation.`, 'success');
      }
    });
  });
}

function openPersonaForm() {
  if (!currentResults) return;
  const track = currentResults[activeVersion];
  if (!track || !track.id || !currentTaskId) {
    alert('No active track to make a persona from. Generate or open a saved track first.');
    return;
  }
  // Pre-fill defaults using current track context.
  if (els.personaForm) els.personaForm.classList.remove('hidden');
  if (els.personaName && !els.personaName.value) els.personaName.value = '';
  if (els.personaDescription && !els.personaDescription.value) {
    els.personaDescription.value = els.style.value || '';
  }
  // Cap vocalEnd to the track duration if known (Suno requires ≤ duration).
  if (els.personaEnd) {
    const dur = Math.floor(track.duration || 0);
    if (dur && dur >= 10) {
      els.personaEnd.max = dur;
      // If the field is at default 30 but the track is shorter, clamp it.
      if (parseInt(els.personaEnd.value, 10) > dur) els.personaEnd.value = dur;
    }
  }
  setStatus(els.personaFormStatus, '', '');
  if (els.personaName) els.personaName.focus();
}

function closePersonaForm() {
  if (els.personaForm) els.personaForm.classList.add('hidden');
  setStatus(els.personaFormStatus, '', '');
}

async function handleSavePersona() {
  if (!currentResults) return;
  const track = currentResults[activeVersion];
  if (!track || !track.id || !currentTaskId) {
    setStatus(els.personaFormStatus, 'No active track. Generate or open a saved track first.', 'error');
    return;
  }

  const name = (els.personaName?.value || '').trim();
  const description = (els.personaDescription?.value || '').trim();
  const vocalStart = parseInt(els.personaStart?.value, 10);
  const vocalEnd = parseInt(els.personaEnd?.value, 10);

  if (!name) {
    setStatus(els.personaFormStatus, 'Name required.', 'error');
    return;
  }
  if (!description) {
    setStatus(els.personaFormStatus, 'Description required — Suno needs it.', 'error');
    return;
  }
  if (Number.isNaN(vocalStart) || Number.isNaN(vocalEnd)) {
    setStatus(els.personaFormStatus, 'Vocal start/end must be numbers (seconds).', 'error');
    return;
  }
  const span = vocalEnd - vocalStart;
  if (span < 10 || span > 30) {
    setStatus(els.personaFormStatus, `Window is ${span}s — must be between 10 and 30 seconds.`, 'error');
    return;
  }

  els.personaFormSave.disabled = true;
  els.personaFormCancel.disabled = true;
  setStatus(els.personaFormStatus, `Minting persona "${name}"...`, '');

  try {
    const res = await fetch(`${API}/create-persona`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: currentTaskId,
        audioId: track.id,
        name,
        description,
        vocalStart,
        vocalEnd,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Persona creation failed');

    await refreshPersonas();
    if (els.personaSelect && data.persona?.persona_id) {
      els.personaSelect.value = data.persona.persona_id;
    }
    setStatus(els.generateStatus, `Persona "${name}" saved. Selected for next generation.`, 'success');
    els.savePersonaBtn.textContent = '✓';
    // Reset + close the form.
    if (els.personaName) els.personaName.value = '';
    if (els.personaDescription) els.personaDescription.value = '';
    if (els.personaStart) els.personaStart.value = 0;
    if (els.personaEnd) els.personaEnd.value = 30;
    closePersonaForm();
  } catch (e) {
    setStatus(els.personaFormStatus, `Suno error: ${e.message}. Try a different ${span}s window where the vocal is clearer.`, 'error');
  } finally {
    els.personaFormSave.disabled = false;
    els.personaFormCancel.disabled = false;
  }
}

function escapeAttr(s) {
  return escapeHtml(s);
}

// ---------- Publish to JamPlays ----------

function slugifyClient(s) {
  return (s || '').toLowerCase()
    .replace(/['"’"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function refreshJamplaysAlbums() {
  try {
    const res = await fetch(`${API}/list-jamplays-albums`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'fetch failed');
    jamplaysAlbums = data.albums || [];
  } catch (e) {
    console.warn('jamplays albums fetch failed', e);
    jamplaysAlbums = [];
  }
}

function openPublishModalFromPlayer() {
  // Only saved library tracks can be published (need the row id)
  if (!activeLibraryTrackId) {
    alert('Save this track to your library first, then publish.');
    return;
  }
  const t = savedTracks.find(x => x.id === activeLibraryTrackId);
  if (!t) return;
  openPublishModal(t);
}

async function openPublishModal(track) {
  publishContextTrack = track;
  els.publishModal.classList.remove('hidden');
  els.publishSource.textContent = `Publishing: "${track.title}" · ${track.style || ''}`;
  els.publishDisplayTitle.value = track.title || '';
  els.publishTrackType.value = guessTrackType(track);
  els.publishLyrics.value = cleanupLyrics(track.music_brief?.prompt || track.prompt || '');
  els.publishNewYear.value = new Date().getFullYear();
  els.publishNewName.value = '';
  els.publishNewSlugPreview.textContent = 'URL: jamplays.netlify.app/—/';
  els.publishNewDesc.value = '';
  setStatus(els.publishStatus, '', '');

  // Refresh albums if we don't have them cached
  if (!jamplaysAlbums.length) {
    setStatus(els.publishStatus, 'Loading JamPlays albums...', '');
    await refreshJamplaysAlbums();
    setStatus(els.publishStatus, '', '');
  }
  renderAlbumDropdown();
  onPublishAlbumChange();
}

function closePublishModal() {
  els.publishModal.classList.add('hidden');
  publishContextTrack = null;
}

function renderAlbumDropdown() {
  const opts = jamplaysAlbums.map(a =>
    `<option value="${escapeAttr(a.slug)}">${escapeHtml(a.name)} (${a.trackCount} song${a.trackCount === 1 ? '' : 's'})</option>`
  ).join('');
  els.publishAlbum.innerHTML = opts + '<option value="__new__">+ Create new album…</option>';
}

function onPublishAlbumChange() {
  const isNew = els.publishAlbum.value === '__new__';
  els.publishNewAlbumFields.classList.toggle('hidden', !isNew);

  // For new albums, position is always "append" to the empty album
  if (isNew) {
    els.publishPositionMode.value = 'append';
    els.publishPositionMode.disabled = true;
    els.publishPositionN.disabled = true;
    els.publishPositionN.innerHTML = '<option>—</option>';
  } else {
    els.publishPositionMode.disabled = false;
  }
  updatePositionUI();
}

function updatePositionUI() {
  const isNew = els.publishAlbum.value === '__new__';
  const mode = els.publishPositionMode.value;
  const album = jamplaysAlbums.find(a => a.slug === els.publishAlbum.value);
  const tracks = album?.tracks || [];

  if (isNew || mode === 'append') {
    els.publishPositionN.disabled = true;
    els.publishPositionN.innerHTML = isNew
      ? '<option>—</option>'
      : `<option>${tracks.length + 1}</option>`;
    return;
  }

  els.publishPositionN.disabled = false;
  if (mode === 'insert') {
    // Can insert at any slot from 1 to count+1
    let html = '';
    for (let i = 1; i <= tracks.length + 1; i++) {
      const labelTrack = i <= tracks.length ? tracks[i - 1] : null;
      const label = labelTrack
        ? `${i} (before "${labelTrack.title}")`
        : `${i} (at end)`;
      html += `<option value="${i}">${escapeHtml(label)}</option>`;
    }
    els.publishPositionN.innerHTML = html;
  } else if (mode === 'replace') {
    if (!tracks.length) {
      els.publishPositionN.innerHTML = '<option>—</option>';
      els.publishPositionN.disabled = true;
      return;
    }
    els.publishPositionN.innerHTML = tracks.map((t, i) =>
      `<option value="${i + 1}">${i + 1}. ${escapeHtml(t.title)}</option>`
    ).join('');
  }
}

function guessTrackType(t) {
  const brief = t.music_brief || {};
  if (brief.duet) return '(duet)';
  if (brief.instrumental || t.instrumental) return '(instrumental)';
  const title = (t.title || '').toLowerCase();
  if (title.includes('(duet)')) return '(duet)';
  if (title.includes('(instrumental)')) return '(instrumental)';
  return '';
}

function cleanupLyrics(raw) {
  if (!raw) return '';
  // Strip [Section] headers and (Speaker) prefixes that Suno used but JamPlays
  // shouldn't display. Keep the actual lyric lines.
  return raw.split('\n').map(line => {
    let l = line.trim();
    if (!l) return '';
    if (/^\[[^\]]+\]$/.test(l)) return ''; // section headers like [Verse 1]
    l = l.replace(/^\([^)]+\)\s*/, ''); // leading (Speaker)
    return l;
  }).filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n').trim();
}

async function handlePublishSubmit() {
  if (!publishContextTrack) return;
  const isNew = els.publishAlbum.value === '__new__';
  const displayTitle = els.publishDisplayTitle.value.trim();
  if (!displayTitle) {
    setStatus(els.publishStatus, 'Display title required.', 'error');
    return;
  }

  const payload = {
    trackId: publishContextTrack.id,
    displayTitle,
    trackType: els.publishTrackType.value || '',
    lyrics: els.publishLyrics.value,
    position: { mode: els.publishPositionMode.value },
  };
  if (payload.position.mode !== 'append') {
    payload.position.n = parseInt(els.publishPositionN.value, 10);
    if (!payload.position.n) {
      setStatus(els.publishStatus, 'Pick a position.', 'error');
      return;
    }
  }
  if (isNew) {
    const name = els.publishNewName.value.trim();
    if (!name) {
      setStatus(els.publishStatus, 'New album name required.', 'error');
      return;
    }
    payload.newAlbum = {
      name,
      year: parseInt(els.publishNewYear.value, 10) || new Date().getFullYear(),
      description: els.publishNewDesc.value.trim() || `A new album by JamSounds.`,
    };
  } else {
    payload.albumSlug = els.publishAlbum.value;
  }

  els.publishSubmit.disabled = true;
  setStatus(els.publishStatus, 'Publishing — this can take 30-60 seconds...', '');

  try {
    const res = await fetch(`${API}/publish-to-jamplays`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Publish failed');
    setStatus(
      els.publishStatus,
      `Published! ${data.url} (commit ${data.commit}). Netlify is deploying — refresh JamPlays in a minute.`,
      'success'
    );
    // Refresh cached albums so the next publish sees the updated tracklist
    refreshJamplaysAlbums();
  } catch (e) {
    setStatus(els.publishStatus, `Error: ${e.message}`, 'error');
  } finally {
    els.publishSubmit.disabled = false;
  }
}

init();
