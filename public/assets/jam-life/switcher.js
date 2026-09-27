/* <jam-switcher app="jamtravel">: the Jam apps picker for the personal apps.
 *
 *   <head>
 *     <script src="/assets/jam-life/theme-init.js" data-app="jamtravel"></script>
 *     <script src="/assets/jam-life/switcher.js"></script>
 *     …the app's own scripts…
 *   <body>
 *     <jam-switcher app="jamtravel"></jam-switcher>
 *
 * LOAD ORDER: theme-init.js then switcher.js, in <head>, as plain blocking
 * scripts (never defer/async/module), before any of the app's own scripts.
 * While open the picker owns the keyboard through a window capture listener,
 * and that only wins over the app's listeners registered after it. Loading
 * this file touches no DOM; it only defines the element and that listener.
 *
 * The trigger is the app's own icon + name + caret, top-left. It opens the
 * eleven Jam apps, Life first, as a modal <dialog>: a popover under the icon
 * on desktop, a tall sheet with a Close button below 768px. The rest of the
 * page is inert while it is open (showModal). Rows are real links, so Cmd-click
 * opens a new tab. Arrow keys / Home / End move, Enter follows, Escape closes
 * and hands focus back to the icon, Tab stays inside.
 *
 * Light DOM, classes prefixed jl-sw-, skinned only through the --jl-* custom
 * properties in base.css. Icons load from <kit base>apps/<id>.png. The kit
 * base is, in order: icons="<folder url>" on the element (the icons folder
 * itself), data-kit-base="<url>/" on the element or on any <script> tag, the
 * folder this file was loaded from (a classic <script>), else /assets/jam-life/
 * (bundled or module loading has no currentScript).
 */
(function () {
  if (window.customElements && customElements.get('jam-switcher')) return

  // Captured now: currentScript is only set while this file is first running.
  var HERE = document.currentScript && document.currentScript.src
  function kitBase(host) {
    var tag = document.querySelector('script[data-kit-base]')
    var base = host.getAttribute('data-kit-base') || (tag && tag.getAttribute('data-kit-base'))
    if (base) return new URL(base.replace(/\/?$/, '/'), document.baseURI).href
    if (HERE) return new URL('./', HERE).href
    return new URL('/assets/jam-life/', document.baseURI).href
  }

  // The same eleven entries as web/src/jam/suite.ts, Life first. JamSounds is
  // at its own address from stage 5 of the personal apps build.
  var APPS = [
    { id: 'jamcompare', name: 'JamCompare', url: 'https://compare.cannoncodeconnect.com/', group: 'life' },
    { id: 'jamcut', name: 'JamCut', url: 'https://jamcut.cannoncodeconnect.com/', group: 'life' },
    { id: 'jamplays', name: 'JamPlays', url: 'https://jamplays.cannoncodeconnect.com/', group: 'life' },
    { id: 'jamfit', name: 'JamFit', url: 'https://fit.cannoncodeconnect.com/', group: 'life' },
    { id: 'jamtravel', name: 'JamTravel', url: 'https://travel.cannoncodeconnect.com/', group: 'life' },
    { id: 'jamsounds', name: 'JamSounds', url: 'https://sounds.cannoncodeconnect.com/', group: 'life' },
    { id: 'jampost', name: 'JamPost', url: 'https://post.cannoncodeconnect.com/app/', group: 'work' },
    { id: 'jamplan', name: 'JamPlan', url: 'https://plan.cannoncodeconnect.com/', group: 'work' },
    { id: 'june', name: 'June', url: 'https://june.cannoncodeconnect.com/', group: 'work' },
    { id: 'jamaccounting', name: 'JamAccounting', url: 'https://accounting.cannoncodeconnect.com/', group: 'work' },
    { id: 'jamhome', name: 'JamHome', url: 'https://home.cannoncodeconnect.com/', group: 'work' }
  ]
  var GROUPS = [{ key: 'life', label: 'Life' }, { key: 'work', label: 'Work' }]
  // suite.ts ids for the two that differ.
  var ALIAS = { accounting: 'jamaccounting', home: 'jamhome', compare: 'jamcompare', cut: 'jamcut', plays: 'jamplays', fit: 'jamfit', travel: 'jamtravel', sounds: 'jamsounds', post: 'jampost', plan: 'jamplan' }

  var PHONE = window.matchMedia('(max-width: 767.98px)')
  var CARET = '<svg class="jl-sw-caret" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  var TICK = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  var uid = 0

  // While a picker is open it owns the keyboard. This window capture listener
  // is registered when this file first runs (see LOAD ORDER), so it comes
  // before the host app's own handlers (JamCut's arrows and Tab) and stops the
  // key events meant for the picker: those whose target is inside an open
  // picker, or the bare page (body/html). Keys inside anything else, such as
  // the app's own dialog opened above it, and IME composition, pass through.
  // Default actions (Enter following a link) still happen. A keyup goes with
  // its keydown: the picker takes it only if it took the keydown (Escape
  // closes on keydown), unless that key's repeats went on to reach the app
  // after the picker closed.
  var opened = new Set()
  var taken = {}
  function owner(e) {
    if (e.isComposing || e.keyCode === 229) return null
    var t = e.target
    var bare = t === window || t === document || t === document.body || t === document.documentElement
    var found = null
    opened.forEach(function (sw) { if (sw.open && (bare || sw._dialog.contains(t))) found = sw })
    return found
  }
  ;['keydown', 'keypress', 'keyup'].forEach(function (t) {
    window.addEventListener(t, function (e) {
      var sw = owner(e)
      if (!sw) {
        if (t === 'keydown') delete taken[e.code]
        else if (t === 'keyup' && taken[e.code]) { delete taken[e.code]; e.stopImmediatePropagation() }
        return
      }
      // A keyup whose keydown the app already had (Enter on the app button
      // that opened the picker, Escape in a host dialog that closed onto it)
      // belongs to the app.
      if (t === 'keyup' && !taken[e.code]) return
      e.stopImmediatePropagation()
      if (t === 'keydown') { taken[e.code] = true; sw._key(e) }
      else if (t === 'keyup') delete taken[e.code]
    }, true)
  })
  window.addEventListener('blur', function () { taken = {} })

  function el(tag, cls, attrs) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k])
    return n
  }
  function find(id) {
    id = String(id || '').toLowerCase()
    id = ALIAS[id] || id
    for (var i = 0; i < APPS.length; i++) if (APPS[i].id === id) return APPS[i]
    return null
  }
  function visible(n) { return !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length) }

  class JamSwitcher extends HTMLElement {
    connectedCallback() {
      if (!this._built) { this._built = true; this._build() }
      window.addEventListener('pagehide', this._onPage)
      window.addEventListener('pageshow', this._onPage)
    }

    // Removed while open: fully closed, so a re-attach starts clean.
    disconnectedCallback() {
      this._reset()
      window.removeEventListener('pagehide', this._onPage)
      window.removeEventListener('pageshow', this._onPage)
    }

    get open() { return !!(this._dialog && this._dialog.open) }

    _build() {
      var self = this
      var n = ++uid
      var appId = this.getAttribute('app') || document.documentElement.getAttribute('data-app')
      var me = find(appId)
      var icons = this.getAttribute('icons') || (kitBase(this) + 'apps/')
      if (icons.charAt(icons.length - 1) !== '/') icons += '/'
      this._me = me

      var trigger = el('button', 'jl-sw-trigger', { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'jl-sw-' + n })
      if (me) {
        var img = el('img', 'jl-sw-icon', { src: icons + me.id + '.png', alt: '', width: '28', height: '28', decoding: 'async' })
        var name = el('span', 'jl-sw-name')
        name.textContent = this.getAttribute('name') || me.name
        trigger.appendChild(img)
        trigger.appendChild(name)
      } else {
        var only = el('span', 'jl-sw-name')
        only.textContent = this.getAttribute('name') || 'Jam apps'
        trigger.appendChild(only)
      }
      trigger.insertAdjacentHTML('beforeend', CARET)

      var dialog = el('dialog', 'jl-sw-dialog', { id: 'jl-sw-' + n, 'aria-label': 'Jam apps' })
      var sheet = el('div', 'jl-sw-sheet')
      var head = el('div', 'jl-sw-head')
      var close = el('button', 'jl-sw-close', { type: 'button' })
      close.textContent = 'Close'
      head.appendChild(close)
      sheet.appendChild(head)

      var list = el('div', 'jl-sw-list')
      GROUPS.forEach(function (g) {
        var gid = 'jl-sw-' + n + '-' + g.key
        var group = el('div', 'jl-sw-group', { role: 'group', 'aria-labelledby': gid })
        var label = el('div', 'jl-sw-label', { id: gid })
        label.textContent = g.label
        group.appendChild(label)
        var ul = el('ul', 'jl-sw-items', { role: 'list' })
        APPS.forEach(function (a) {
          if (a.group !== g.key) return
          var here = me && a.id === me.id
          var li = el('li')
          var link = el('a', 'jl-sw-item', { href: a.url })
          if (here) link.setAttribute('aria-current', 'page')
          link.appendChild(el('img', 'jl-sw-item-icon', { src: icons + a.id + '.png', alt: '', width: '28', height: '28', loading: 'lazy', decoding: 'async' }))
          var t = el('span', 'jl-sw-item-name')
          t.textContent = a.name
          link.appendChild(t)
          if (here) {
            var mark = el('span', 'jl-sw-here')
            mark.innerHTML = TICK
            mark.appendChild(document.createTextNode('Here'))
            link.appendChild(mark)
          }
          li.appendChild(link)
          ul.appendChild(li)
        })
        group.appendChild(ul)
        list.appendChild(group)
      })
      sheet.appendChild(list)
      dialog.appendChild(sheet)

      this.appendChild(trigger)
      this.appendChild(dialog)
      this._trigger = trigger
      this._dialog = dialog
      this._close = close

      trigger.addEventListener('click', function () { self.open ? self.hide() : self.show() })
      close.addEventListener('click', function () { self.hide() })
      // Leaving for the bfcache, or coming back from it: never restore open.
      this._onPage = function (e) {
        if (e.type === 'pagehide' || e.persisted) self._reset()
      }
      // Escape arrives as `cancel`; closing ourselves keeps focus handling in one place.
      dialog.addEventListener('cancel', function (e) { e.preventDefault(); self.hide() })
      // A close the browser forced (e.g. a second Escape) still resets the trigger.
      dialog.addEventListener('close', function () { self._closed() })
      // A click on the dialog box itself, outside the sheet, is the backdrop.
      // Desktop only: on a phone the strip above the sheet is under the clock,
      // and nothing there should act; the sheet has its own Close.
      dialog.addEventListener('click', function (e) {
        if (e.target === dialog && !PHONE.matches) self.hide()
      })
      list.addEventListener('click', function (e) {
        var a = e.target.closest && e.target.closest('a.jl-sw-item')
        // The current app: nowhere to go, just close.
        if (a && a.getAttribute('aria-current') === 'page' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
          e.preventDefault()
          self.hide()
        }
      })
      this._onViewport = function () { if (self.open) self._place() }
    }

    show() {
      if (this.open || !this._dialog) return
      this._place()
      this._dialog.showModal()
      taken = {}
      opened.add(this)
      document.documentElement.classList.add('jl-sw-lock')
      this._trigger.setAttribute('aria-expanded', 'true')
      this.setAttribute('open', '')
      window.addEventListener('resize', this._onViewport)
      window.addEventListener('scroll', this._onViewport, true)
      if (PHONE.addEventListener) PHONE.addEventListener('change', this._onViewport)
      var start = this._dialog.querySelector('a.jl-sw-item[aria-current="page"]') || this._items()[0]
      if (start) start.focus()
      this._dialog.querySelector('.jl-sw-list').scrollTop = 0
      if (start && start.scrollIntoView) start.scrollIntoView({ block: 'nearest' })
    }

    hide() {
      if (!this._dialog) return
      // `close` fires a task later; reset the trigger now so state is never stale.
      if (this._dialog.open) this._dialog.close()
      this._closed()
    }

    _closed() {
      if (!this._trigger || this._trigger.getAttribute('aria-expanded') === 'false') return
      this._reset()
      this._trigger.focus()
    }

    // Closed state without moving focus: after a close, on removal, on pagehide.
    _reset() {
      if (!this._dialog) return
      if (this._dialog.open) this._dialog.close()
      this._trigger.setAttribute('aria-expanded', 'false')
      this.removeAttribute('open')
      opened.delete(this)
      // Another picker may still be open (and own the lock).
      if (!opened.size) document.documentElement.classList.remove('jl-sw-lock')
      window.removeEventListener('resize', this._onViewport)
      window.removeEventListener('scroll', this._onViewport, true)
      if (PHONE.removeEventListener) PHONE.removeEventListener('change', this._onViewport)
    }

    // Desktop: under the icon, kept on screen. The phone sheet ignores these.
    _place() {
      var r = this._trigger.getBoundingClientRect()
      var vw = document.documentElement.clientWidth
      var vh = window.innerHeight
      var w = Math.min(320, vw - 16)
      var x = Math.max(8, Math.min(r.left, vw - w - 8))
      var y = Math.round(r.bottom + 8)
      var s = this._dialog.style
      s.setProperty('--jl-sw-x', x + 'px')
      s.setProperty('--jl-sw-y', y + 'px')
      s.setProperty('--jl-sw-max-h', Math.max(200, vh - y - 16) + 'px')
    }

    _items() { return Array.prototype.slice.call(this._dialog.querySelectorAll('a.jl-sw-item')) }

    _key(e) {
      var items = this._items()
      var at = items.indexOf(document.activeElement)
      var to = null
      switch (e.key) {
        case 'ArrowDown': to = at < 0 ? 0 : (at + 1) % items.length; break
        case 'ArrowUp': to = at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length; break
        case 'Home': to = 0; break
        case 'End': to = items.length - 1; break
        case 'Escape': e.preventDefault(); this.hide(); return
        case 'Tab': {
          var ring = (visible(this._close) ? [this._close] : []).concat(items)
          var i = ring.indexOf(document.activeElement)
          var next = e.shiftKey ? (i <= 0 ? ring.length - 1 : i - 1) : (i + 1) % ring.length
          e.preventDefault()
          ring[next].focus()
          return
        }
        default: return
      }
      e.preventDefault()
      items[to].focus()
    }
  }

  customElements.define('jam-switcher', JamSwitcher)
  window.JamSwitcher = { apps: APPS.slice(), element: JamSwitcher }
})()
