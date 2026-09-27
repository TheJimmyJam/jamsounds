/* Jam personal apps: theme + density, applied before first paint.
 *
 * Load it in <head>, before any stylesheet, as a plain blocking script (never
 * defer/async), so the first frame is already in the right theme:
 *
 *   <script src="/assets/jam-life/theme-init.js" data-app="jamtravel"
 *           data-canvas-light="#…" data-canvas-dark="#…"></script>
 *
 * This is a port of shared/jam-ui/theme-init.js (the work apps') and shares its
 * preference exactly: ONE cookie, `jam_prefs`, on .cannoncodeconnect.com, value
 * "theme=auto&density=standard", with a localStorage copy for hosts the cookie
 * cannot reach (localhost, jamsounds.netlify.app). Choosing Dark in JamPost
 * makes JamTravel dark on its first paint, and the reverse. Auto resolves
 * through prefers-color-scheme and keeps listening, so the page flips live.
 *
 * Sets on <html>: data-theme (light|dark), data-theme-pref (auto|light|dark),
 * data-density, data-app, and color-scheme. Exposes window.jamPrefs with the
 * same API as the work apps' file: read, resolved, apply, subscribe. Writing
 * the cookie is prefs.js (the <jam-appearance> element), as prefs.ts is there.
 */
(function () {
  var KEY = 'jam_prefs'
  var THEMES = { auto: 1, light: 1, dark: 1 }
  var DENSITIES = { compact: 1, standard: 1, comfortable: 1 }
  var root = document.documentElement
  var script = document.currentScript
  var ds = (script && script.dataset) || {}
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null

  if (ds.app) root.setAttribute('data-app', ds.app)

  // null when the value is malformed (decodeURIComponent throws on a stray %).
  function parse(s) {
    var out = {}
    if (!s) return out
    try {
      var parts = String(s).split('&')
      for (var i = 0; i < parts.length; i++) {
        var kv = parts[i].split('=')
        if (kv.length === 2) out[kv[0]] = decodeURIComponent(kv[1])
      }
    } catch (e) { return null }
    return out
  }

  function readCookie() {
    var m = document.cookie.match(/(?:^|;\s*)jam_prefs=([^;]*)/)
    return m ? m[1] : null
  }

  function readLocal() {
    try { return window.localStorage.getItem(KEY) } catch (e) { return null }
  }

  // The cookie, else (missing or malformed) the local copy, else defaults.
  function read() {
    var p = readCookie() ? parse(readCookie()) : null
    if (!p) p = parse(readLocal()) || {}
    return {
      theme: THEMES[p.theme] ? p.theme : 'auto',
      density: DENSITIES[p.density] ? p.density : 'standard'
    }
  }

  function resolved(theme) {
    if (theme === 'light' || theme === 'dark') return theme
    return mq && mq.matches ? 'dark' : 'light'
  }

  // The browser chrome follows the page. The canvas colours belong to the
  // chosen direction, so the app passes them on the script tag; these neutral
  // values only stand in until it does. iOS reads the status bar style when an
  // installed app launches, which is after this runs.
  var CANVAS = {
    light: ds.canvasLight || '#FFFFFF',
    dark: ds.canvasDark || '#121212'
  }
  function meta(name) {
    var all = document.querySelectorAll('meta[name="' + name + '"]')
    var m = all[0]
    for (var i = 1; i < all.length; i++) all[i].parentNode.removeChild(all[i])
    if (!m) {
      m = document.createElement('meta')
      m.setAttribute('name', name)
      document.head.appendChild(m)
    }
    m.removeAttribute('media')
    return m
  }
  function chrome(t) {
    meta('theme-color').setAttribute('content', CANVAS[t])
    meta('apple-mobile-web-app-status-bar-style').setAttribute('content', t === 'dark' ? 'black-translucent' : 'default')
  }

  function apply(p) {
    p = p || read()
    var t = resolved(p.theme)
    root.setAttribute('data-theme', t)
    root.setAttribute('data-theme-pref', p.theme)
    root.setAttribute('data-density', p.density)
    root.style.colorScheme = t
    chrome(t)
    return p
  }

  var current = apply()
  // Keep the local copy in step with the shared cookie.
  try { if (readCookie() && parse(readCookie())) window.localStorage.setItem(KEY, readCookie()) } catch (e) { /* private mode */ }

  function onDevice() {
    if (root.getAttribute('data-theme-pref') === 'auto') apply({ theme: 'auto', density: root.getAttribute('data-density') || 'standard' })
    notify()
  }
  if (mq) {
    if (mq.addEventListener) mq.addEventListener('change', onDevice)
    else if (mq.addListener) mq.addListener(onDevice)
  }

  var listeners = []
  function notify() { for (var i = 0; i < listeners.length; i++) try { listeners[i]() } catch (e) { /* a listener's problem */ } }

  // Another app (or tab) may have changed the cookie while this one was away.
  function recheck() {
    if (document.visibilityState === 'hidden') return
    var p = read()
    if (p.theme !== current.theme || p.density !== current.density) { current = apply(p); notify() }
  }
  document.addEventListener('visibilitychange', recheck)
  window.addEventListener('focus', recheck)
  window.addEventListener('storage', function (e) { if (e.key === KEY) recheck() })

  window.jamPrefs = {
    read: read,
    resolved: function () { return root.getAttribute('data-theme') || resolved(current.theme) },
    apply: function (p) { current = apply(p); notify(); return current },
    subscribe: function (fn) {
      listeners.push(fn)
      return function () { listeners = listeners.filter(function (f) { return f !== fn }) }
    }
  }
})()
