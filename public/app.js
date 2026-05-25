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
  downloadLink: document.getElementById('download-link'),
  libraryList: document.getElementById('library-list'),
  libraryCount: document.getElementById('library-count'),
};

let currentResults = null; // [{audio_url, image_url, title, duration, ...}, {...}]
let currentTaskId = null;
let activeVersion = 0;
let pollingTimer = null;
let savedTracks = [];
let referenceUploadUrl = null; // public URL of uploaded MP3 reference (if any)

// ---------- Init ----------

async function init() {
  await Promise.all([refreshCredits(), refreshLibrary()]);

  els.translateBtn.addEventListener('click', handleTranslate);
  els.soundsLikeBtn.addEventListener('click', handleSoundsLike);
  els.generateBtn.addEventListener('click', handleGenerate);
  els.saveBtn.addEventListener('click', handleSave);

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

  document.querySelectorAll('.version-btn').forEach(btn => {
    btn.addEventListener('click', () => switchVersion(parseInt(btn.dataset.version, 10)));
  });
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
  if (referenceUploadUrl) {
    els.generateLabel.textContent = 'Generate from MP3 reference · ~10 credits';
  } else {
    els.generateLabel.textContent = 'Generate · ~8 credits';
  }
}

// ---------- Generate ----------

async function handleGenerate() {
  const payload = collectPayload();
  if (!payload.style || !payload.title) {
    setStatus(els.generateStatus, 'Style and title are required.', 'error');
    return;
  }

  els.generateBtn.disabled = true;
  setStatus(els.generateStatus, 'Submitting to Suno...', '');

  try {
    const res = await fetch(`${API}/generate-music`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Generation failed');

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
  return payload;
}

function pollForResults() {
  if (pollingTimer) clearTimeout(pollingTimer);
  let attempts = 0;
  const maxAttempts = 60; // 5 minutes at 5s interval

  const poll = async () => {
    attempts++;
    try {
      const res = await fetch(`${API}/check-status?taskId=${currentTaskId}`);
      const data = await res.json();

      if (data.status === 'streaming' || data.status === 'complete') {
        // We have at least streaming URLs
        currentResults = data.tracks;
        showResults();
        if (data.status === 'complete') {
          setStatus(els.generateStatus, `Done. ${data.tracks.length} tracks ready.`, 'success');
          els.generateBtn.disabled = false;
          refreshCredits();
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
      }
    } catch (e) {
      setStatus(els.generateStatus, `Error: ${e.message}`, 'error');
      els.generateBtn.disabled = false;
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

  // Reset save button state
  els.saveBtn.classList.remove('saved');
  els.saveBtn.textContent = '♡';
  els.saveBtn.disabled = false;
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
        title: track.title,
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
    await refreshLibrary();
  } catch (e) {
    alert(`Save error: ${e.message}`);
    els.saveBtn.textContent = '♡';
  } finally {
    els.saveBtn.disabled = false;
  }
}

// ---------- Library ----------

async function refreshLibrary() {
  try {
    const res = await fetch(`${API}/list-tracks`);
    const data = await res.json();
    savedTracks = data.tracks || [];
    renderLibrary();
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

  els.libraryList.innerHTML = savedTracks.map(t => `
    <div class="library-item" data-id="${t.id}">
      <div class="library-item-info">
        <p class="library-item-title">${escapeHtml(t.title || 'Untitled')}</p>
        <p class="library-item-meta">${escapeHtml(t.style || '')} · ${formatDuration(t.duration)}</p>
      </div>
      <span class="library-item-date">${formatDate(t.created_at)}</span>
      <button class="library-item-delete" data-id="${t.id}" title="Delete">×</button>
    </div>
  `).join('');

  els.libraryList.querySelectorAll('.library-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('library-item-delete')) return;
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
  els.playerEmpty.classList.add('hidden');
  els.player.classList.remove('hidden');
  switchVersion(0);
  // hide v2 since saved tracks are single
  document.querySelectorAll('.version-btn')[1].style.display = 'none';
  document.querySelectorAll('.version-btn')[0].textContent = 'saved';
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

init();
