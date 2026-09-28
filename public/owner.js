// JamSounds owner sign-in.
//
// Kept out of app.js on purpose: it wraps fetch, so a change the server
// refuses (401 { signin: true } on anything but a GET) opens the sign-in
// dialog. Refused reads stay quiet, so loading the page signed out never asks.
// The app's own error handling still runs; after signing in, the action is
// tapped again. Nothing is retried automatically: a retried generate would
// spend credits.
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
    const req = args[0];
    const url = String(req && req.url ? req.url : req);
    const method = String((args[1] && args[1].method) || (req && req.method) || 'GET').toUpperCase();
    if (res.status === 401 && method !== 'GET' && url.includes(API) && !url.includes(`${API}/auth`)) {
      res.clone().json().then((d) => { if (d && d.signin) open(); }).catch(() => {});
    }
    return res;
  };

  let dlg;
  function build() {
    dlg = document.createElement('dialog');
    dlg.className = 'jl-dialog';
    dlg.setAttribute('aria-labelledby', 'owner-title');
    dlg.innerHTML = `
      <form id="owner-form">
        <div class="jl-dialog-head"><img src="/assets/jam-life/apps/jamsounds.png" alt="" width="32" height="32"><h2 id="owner-title">Sign in</h2></div>
        <div class="jl-dialog-body">
          <button type="button" class="jl-btn" id="owner-send">Email me a code</button>
          <label class="jl-field"><span>Code</span><input id="owner-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" /></label>
          <p id="owner-msg" role="status"></p>
        </div>
        <div class="jl-actions">
          <button type="button" class="jl-btn" id="owner-close">Not now</button>
          <button type="submit" class="jl-btn jl-btn-primary">Sign in</button>
        </div>
      </form>`;
    document.body.appendChild(dlg);

    const msg = dlg.querySelector('#owner-msg');
    const input = dlg.querySelector('#owner-code');
    dlg.querySelector('#owner-close').addEventListener('click', () => dlg.close());
    dlg.querySelector('#owner-send').addEventListener('click', async () => {
      msg.textContent = 'Sending…';
      input.focus();
      const { ok, data } = await auth({ action: 'request' });
      msg.textContent = ok ? 'Sent.' : (data.error || 'Could not send.');
    });
    dlg.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const { ok, data } = await auth({ action: 'code', code: input.value });
      if (ok) { input.value = ''; dlg.close(); }
      else msg.textContent = data.error || 'That did not work.';
    });
  }

  function open() {
    if (!dlg) build();
    if (dlg.open) return;
    dlg.querySelector('#owner-msg').textContent = '';
    dlg.showModal();
    dlg.querySelector('#owner-send').focus();
  }

  // The emailed link lands here as ?login=<token>.
  const token = new URLSearchParams(location.search).get('login');
  if (token) {
    const clean = new URL(location.href);
    clean.searchParams.delete('login');
    history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
    auth({ action: 'verify', token }).then(({ ok }) => { if (!ok) open(); });
  }
})();
