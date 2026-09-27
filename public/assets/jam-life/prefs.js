/* <jam-appearance>: Auto / Light / Dark for the personal apps.
 *
 *   <script src="/assets/jam-life/prefs.js" defer></script>
 *   <jam-appearance></jam-appearance>            (hide-label: no visible legend)
 *
 * Writes the shared `jam_prefs` cookie exactly as the work apps do
 * (web/src/jam/prefs.ts): "theme=<t>&density=<d>", Path=/, a year, Lax, and
 * Domain=.cannoncodeconnect.com + Secure on Jimmy's hosts (host-only anywhere
 * else), plus the localStorage copy. Density is carried over, never reset.
 * Needs theme-init.js in <head> for window.jamPrefs; works without it too.
 */
(function () {
  if (window.customElements && customElements.get('jam-appearance')) return

  var KEY = 'jam_prefs'
  var YEAR = 60 * 60 * 24 * 365
  var OPTIONS = [{ key: 'auto', label: 'Auto' }, { key: 'light', label: 'Light' }, { key: 'dark', label: 'Dark' }]
  var uid = 0

  function cookieDomain(host) {
    host = host || location.hostname
    return host === 'cannoncodeconnect.com' || /\.cannoncodeconnect\.com$/.test(host) ? '.cannoncodeconnect.com' : null
  }

  function fallbackRead() {
    var root = document.documentElement
    var t = root.getAttribute('data-theme-pref')
    var d = root.getAttribute('data-density')
    return {
      theme: t === 'light' || t === 'dark' ? t : 'auto',
      density: d === 'compact' || d === 'comfortable' ? d : 'standard'
    }
  }

  function readPrefs() { return window.jamPrefs ? window.jamPrefs.read() : fallbackRead() }

  function savePrefs(patch) {
    var cur = readPrefs()
    var next = { theme: patch.theme || cur.theme, density: patch.density || cur.density }
    var value = 'theme=' + next.theme + '&density=' + next.density
    var domain = cookieDomain()
    document.cookie = KEY + '=' + value + '; Path=/; Max-Age=' + YEAR + '; SameSite=Lax' +
      (domain ? '; Domain=' + domain + '; Secure' : '')
    try { window.localStorage.setItem(KEY, value) } catch (e) { /* private mode: the cookie still carries it */ }
    if (window.jamPrefs) window.jamPrefs.apply(next)
    else {
      var root = document.documentElement
      var dark = next.theme === 'dark' || (next.theme === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches)
      root.setAttribute('data-theme', dark ? 'dark' : 'light')
      root.setAttribute('data-theme-pref', next.theme)
      root.setAttribute('data-density', next.density)
      root.style.colorScheme = dark ? 'dark' : 'light'
    }
    return next
  }

  class JamAppearance extends HTMLElement {
    connectedCallback() {
      if (!this._built) this._build()
      var self = this
      this._sync()
      if (window.jamPrefs && !this._off) this._off = window.jamPrefs.subscribe(function () { self._sync() })
    }

    disconnectedCallback() { if (this._off) { this._off(); this._off = null } }

    _build() {
      this._built = true
      var self = this
      var n = ++uid
      var fs = document.createElement('fieldset')
      fs.className = 'jl-ap'
      var legend = document.createElement('legend')
      legend.className = 'jl-ap-legend'
      legend.textContent = this.getAttribute('label') || 'Appearance'
      if (this.hasAttribute('hide-label')) legend.classList.add('jl-visually-hidden')
      fs.appendChild(legend)
      var group = document.createElement('div')
      group.className = 'jl-ap-options'
      OPTIONS.forEach(function (o) {
        var label = document.createElement('label')
        label.className = 'jl-ap-option'
        var input = document.createElement('input')
        input.type = 'radio'
        input.name = 'jl-ap-' + n
        input.value = o.key
        input.className = 'jl-ap-input'
        var text = document.createElement('span')
        text.className = 'jl-ap-text'
        text.textContent = o.label
        label.appendChild(input)
        label.appendChild(text)
        group.appendChild(label)
      })
      fs.appendChild(group)
      this.appendChild(fs)
      fs.addEventListener('change', function (e) {
        if (e.target && e.target.name === 'jl-ap-' + n) {
          savePrefs({ theme: e.target.value })
          self._sync()
        }
      })
    }

    _sync() {
      var t = readPrefs().theme
      var inputs = this.querySelectorAll('input.jl-ap-input')
      for (var i = 0; i < inputs.length; i++) inputs[i].checked = inputs[i].value === t
    }
  }

  customElements.define('jam-appearance', JamAppearance)
  window.jamLifePrefs = { read: readPrefs, save: savePrefs }
})()
