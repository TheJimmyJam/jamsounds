// The branded dialogs (ask / tell / askText in public/app.js) share one
// <dialog>. A notice that fires while a confirm is open must not take over the
// confirm, and its OK must never answer the confirm (it once sent a DELETE).
// A dialog shown straight after another closes must ignore the second half of
// a double-click / repeated Enter for a moment (that also once sent a DELETE).
//
//   npm test   (node --test tests/*.test.mjs; APP_JS=<path> tests another copy)
import { test as nodeTest } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Every test fails after 3s instead of hanging on a promise that never settles.
const test = (name, fn) => nodeTest(name, { timeout: 3000 }, fn)

const src = readFileSync(process.env.APP_JS || new URL('../public/app.js', import.meta.url), 'utf8')
const block = src.slice(src.indexOf('// ---------- Branded dialogs'), src.indexOf('// ---------- Views'))

// Just enough DOM for the dialog code: elements with listeners, a dialog, focus.
function el(id, doc) {
  const ls = {}
  return {
    id, hidden: false, textContent: '', className: '', value: '', open: false,
    addEventListener(t, f) { (ls[t] ||= []).push(f) },
    removeEventListener(t, f) { ls[t] = (ls[t] || []).filter((g) => g !== f) },
    fire(t, extra = {}) {
      const e = { type: t, defaultPrevented: false, preventDefault() { this.defaultPrevented = true }, ...extra }
      for (const f of [...(ls[t] || [])]) f(e)
      return e
    },
    count(t) { return (ls[t] || []).length },
    showModal() { this.open = true }, // already open and modal: a no-op, as in current browsers
    close() { this.open = false },
    focus() { doc.activeElement = this },
  }
}
function load() {
  const doc = { activeElement: null, contains: () => true }
  const ids = ['ask', 'ask-form', 'ask-title', 'ask-body', 'ask-field', 'ask-field-label', 'ask-input', 'ask-yes', 'ask-no']
  const map = Object.fromEntries(ids.map((i) => [i, el(i, doc)]))
  doc.getElementById = (i) => map[i]
  const api = new Function('document', `${block}; return { ask, tell, askText, askEls }`)(doc)
  return { ...api, map, doc }
}
const tick = () => new Promise((r) => setTimeout(r, 0))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const ARMED = 350 // past the 300ms a handed-off dialog ignores activation

test('a notice during an open confirm waits, and its OK never answers the confirm', async () => {
  const { ask, tell, map } = load()
  let deleted = null
  const confirm = ask({ title: 'Delete "Track"?', action: 'Delete track' }).then((ok) => { deleted = ok })
  assert.equal(map['ask-title'].textContent, 'Delete "Track"?')
  const notice = tell({ title: 'Save failed', body: 'boom' })
  // The confirm is still what is on screen.
  assert.equal(map['ask-title'].textContent, 'Delete "Track"?')
  assert.equal(map['ask-yes'].textContent, 'Delete track')
  // Cancel the confirm: resolves false, then the notice shows.
  map['ask-no'].fire('click'); await tick()
  assert.equal(deleted, false)
  assert.equal(map['ask-title'].textContent, 'Save failed')
  assert.equal(map['ask'].open, true)
  // OK on the notice (once it is armed) resolves only the notice.
  await wait(ARMED)
  map['ask-form'].fire('submit')
  assert.equal(await notice, true)
  await confirm
  assert.equal(deleted, false)
  assert.equal(map['ask'].open, false)
})

test('pressing the one button on screen answers only what is on screen', async () => {
  // The reported bug: "Save failed" arrived over "Delete …?", and its OK
  // resolved the delete confirm as true, which sent the DELETE.
  const { ask, tell, map } = load()
  let deleted = null
  ask({ title: 'Delete "Track"?', action: 'Delete track' }).then((ok) => { deleted = ok })
  tell({ title: 'Save failed', body: 'boom' })
  // The user answers what is on screen: OK on the notice, Cancel on the delete.
  for (let i = 0; i < 4 && map['ask'].open; i++) {
    if (map['ask-title'].textContent === 'Save failed') map['ask-form'].fire('submit')
    else map['ask-no'].fire('click')
    await wait(ARMED)
  }
  assert.notEqual(deleted, true, 'OK on "Save failed" must not confirm the delete')
  assert.equal(map['ask'].open, false)
})

test('a double-click on a notice never answers the confirm queued behind it', async () => {
  // Reported: a notice with a delete confirm queued behind it; two clicks on
  // OK <= 250ms apart sent DELETE list-tracks.
  const { ask, tell, map } = load()
  let deleted = null
  const notice = tell({ title: 'Download failed', body: 'HTTP 404' })
  ask({ title: 'Delete "Track"?', action: 'Delete track' }).then((ok) => { deleted = ok })
  map['ask-form'].fire('submit') // first click: OK on the notice
  assert.equal(await notice, true)
  assert.equal(map['ask-title'].textContent, 'Delete "Track"?')
  await wait(120)
  map['ask-form'].fire('submit') // second click lands on "Delete track"
  map['ask-no'].fire('click')
  const enter = map['ask'].fire('keydown', { key: 'Enter' })
  const space = map['ask'].fire('keydown', { key: ' ' })
  await tick()
  assert.equal(deleted, null, 'the confirm must still be waiting')
  assert.equal(map['ask'].open, true)
  assert.equal(enter.defaultPrevented, true)
  assert.equal(space.defaultPrevented, true)
  // Escape still cancels while it is arming.
  map['ask'].fire('cancel')
  await tick()
  assert.equal(deleted, false)
})

test('a prompt queued behind a confirm ignores a second submit, then works', async () => {
  const { ask, askText, map } = load()
  const confirm = ask({ title: 'Q', action: 'Go', danger: false })
  const name = askText({ title: 'New profile', label: 'Name', action: 'Create profile' })
  let named
  name.then((v) => { named = v })
  map['ask-form'].fire('submit') // answers the confirm
  assert.equal(await confirm, true)
  map['ask-form'].fire('submit') // the repeat must not submit an empty prompt
  await tick()
  assert.equal(named, undefined)
  assert.equal(map['ask-title'].textContent, 'New profile')
  await wait(ARMED)
  map['ask-input'].value = 'Courtney'
  map['ask-form'].fire('submit')
  assert.equal(await name, 'Courtney')
})

test('a dialog opened on its own responds at once', async () => {
  const { ask, map } = load()
  const a = ask({ title: 'Q', action: 'Go' })
  map['ask-form'].fire('submit')
  assert.equal(await a, true)
})

test('Escape cancels; askText resolves null on cancel, the text on submit', async () => {
  const { ask, askText, map } = load()
  const a = ask({ title: 'Q', action: 'Go' })
  map['ask'].fire('cancel')
  assert.equal(await a, false)
  const n1 = askText({ title: 'New profile', label: 'Name', action: 'Create profile' })
  map['ask'].fire('cancel')
  assert.equal(await n1, null)
  const n2 = askText({ title: 'New profile', label: 'Name', action: 'Create profile' })
  map['ask-input'].value = 'A very long profile name that is well over sixty characters long, really'
  map['ask-form'].fire('submit')
  assert.equal(await n2, 'A very long profile name that is well over sixty characters long, really')
})

test('no listener survives a settled request', async () => {
  const { ask, tell, map } = load()
  const a = ask({ title: 'One', action: 'Go' }); tell({ title: 'Two' })
  map['ask-form'].fire('submit'); await a; await tick()
  // Only the notice's own listeners are attached now.
  assert.equal(map['ask-form'].count('submit'), 1)
  assert.equal(map['ask-no'].count('click'), 1)
  assert.equal(map['ask'].count('cancel'), 1)
  await wait(ARMED)
  map['ask-form'].fire('submit'); await tick()
  assert.equal(map['ask-form'].count('submit'), 0)
  assert.equal(map['ask-no'].count('click'), 0)
  assert.equal(map['ask'].count('cancel'), 0)
  assert.equal(map['ask'].count('keydown'), 0)
  assert.equal(map['ask'].open, false)
})
