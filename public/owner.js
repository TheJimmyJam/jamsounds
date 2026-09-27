// JamSounds owner sign-in.
//
// Kept out of app.js on purpose: it wraps fetch, so any /.netlify/functions/*
// call that comes back 401 { signin: true } opens the sign-in sheet. The app's
// own error handling still runs; after signing in, the action is tapped again.
// Nothing is retried automatically — a retried generate would spend credits.
(function () {
  const API = '/.netlify/functions';
  const origFetch = window.fetch.bind(window);

  const auth = (body) => origFetch(`${API}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  }).then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }));

  window.fetch = async (...args) => {
    const res = await origFetch(...args);
    const url = String(args[0] && args[0].url ? args[0].url : args[0]);
    if (res.status === 401 && url.includes(API) && !url.includes(`${API}/auth`)) {
      res.clone().json().then((d) => { if (d && d.signin) open(); }).catch(() => {});
    }
    return res;
  };

  let sheet;
  function build() {
    const style = document.createElement('style');
    style.textContent = `
      .js-owner { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center;
        background: var(--jl-scrim, rgba(0,0,0,.55)); padding: 16px; }
      .js-owner[hidden] { display: none; }
      .js-owner-card { width: min(340px, 100%); display: grid; gap: 12px; padding: 20px;
        background: var(--jl-panel, var(--surface, #181b22)); color: var(--jl-ink, var(--text, #e6e8eb));
        border: 1px solid var(--jl-line, var(--border, #2a2f3a)); border-radius: var(--jl-radius-dialog, 10px);
        font-family: var(--jl-font, var(--font, system-ui, sans-serif)); }
      .js-owner-card h2 { margin: 0; font-size: 18px; font-weight: 600; }
      .js-owner-card input { font: inherit; font-size: 22px; letter-spacing: 6px; text-align: center; padding: 10px;
        background: var(--jl-raised, var(--surface-2, #1f232c)); color: inherit;
        border: 1px solid var(--jl-line, var(--border, #2a2f3a)); border-radius: var(--jl-radius-control, 6px); }
      .js-owner-card button { font: inherit; padding: 10px 14px; cursor: pointer; border: 0;
        border-radius: var(--jl-radius-control, 6px);
        background: var(--jl-accent, var(--accent, #7c5cff)); color: var(--jl-on, var(--accent-text, #fff)); }
      .js-owner-card button.js-owner-quiet { background: none; color: var(--jl-muted, var(--text-2, #a4abb6)); }
      .js-owner-msg { min-height: 1.2em; margin: 0; font-size: 14px; color: var(--jl-muted, var(--text-2, #a4abb6)); }
    `;
    document.head.appendChild(style);

    sheet = document.createElement('div');
    sheet.className = 'js-owner';
    sheet.hidden = true;
    sheet.innerHTML = `
      <form class="js-owner-card" role="dialog" aria-modal="true" aria-labelledby="js-owner-title">
        <h2 id="js-owner-title">Sign in</h2>
        <button type="button" data-send>Email me a code</button>
        <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" aria-label="Code" />
        <button type="submit">Sign in</button>
        <p class="js-owner-msg" aria-live="polite"></p>
        <button type="button" class="js-owner-quiet" data-close>Not now</button>
      </form>`;
    document.body.appendChild(sheet);

    const msg = sheet.querySelector('.js-owner-msg');
    const input = sheet.querySelector('input');
    sheet.querySelector('[data-close]').addEventListener('click', close);
    sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
    sheet.querySelector('[data-send]').addEventListener('click', async () => {
      msg.textContent = 'Sending…';
      input.focus();
      const { ok, data } = await auth({ action: 'request' });
      msg.textContent = ok ? 'Sent.' : (data.error || 'Could not send.');
    });
    sheet.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const { ok, data } = await auth({ action: 'code', code: input.value });
      if (ok) { msg.textContent = ''; input.value = ''; close(); }
      else msg.textContent = data.error || 'That did not work.';
    });
  }

  function open() {
    if (!sheet) build();
    if (!sheet.hidden) return;
    sheet.hidden = false;
    sheet.querySelector('.js-owner-msg').textContent = '';
    sheet.querySelector('[data-send]').focus();
  }
  function close() { if (sheet) sheet.hidden = true; }

  // The emailed link lands here as ?login=<token>.
  const token = new URLSearchParams(location.search).get('login');
  if (token) {
    const clean = new URL(location.href);
    clean.searchParams.delete('login');
    history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
    auth({ action: 'verify', token }).then(({ ok }) => { if (!ok) open(); });
  }
})();
