// netlify/lib/jamplays.js: reading JamPlays' gated records and planning a
// publish into one. Fixtures are small stand-ins shaped like the real files
// (this repo is public; the real manifests carry private lyrics).
//
//   npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const JP = require('../netlify/lib/jamplays.js')

const GATE = `
const ALBUMS = {
  "desireland-population-2": require("../data/desireland-population-2.json"),
  "fantasyland-population-1": require("../data/fantasyland-population-1.json"),
  "desireland-population-2-v3": require("../data/desireland-population-2-v3.json"),
  // A borrowed record.
  "flying": require("../data/flying.json"),
};
const DEFAULT_ALBUM = "desireland-population-2";
const FILMS = require("../data/films.json");
`

const CATALOG = `// comments, unquoted keys, the real thing's shape
window.JP_CATALOG = [
  { album: "fantasyland-population-1", title: "Fantasyland, Population 1", edition: "Edition 1", sub: "2 songs · 2026", key: "fl1-key" },
  { kind: "earlier", album: "desireland-population-2", title: "Desireland, Population 2", edition: "His & Hers", sub: "1 song · His & Hers" },
  {
    album: "desireland-population-2-v3",
    title: "Desireland v3 — Jimmy’s voice",
    edition: "Jimmy’s voice",
    sub: "2 songs · Jimmy’s voice",
  },
  { kind: "film", album: "house-tour", title: "House Tour", sub: "8 min \\u00b7 Dallas" },
  { kind: "borrowed", album: "flying", title: "Flying", sub: "12 hours · for sleeping" },
];
`

const V3 = {
  album: 'desireland-population-2-v3',
  title: 'Desireland v3',
  tracks: [
    { n: 1, title: 'Song A', art: 'song-art/a.png', versions: { duet: { file: 'audio/song-a-duet.mp3', peaks: [1, 2], seconds: 200.5 } } },
    { n: 2, title: 'Song B', art: 'song-art/b.png', versions: { duet: { file: 'audio/song-b-duet.mp3' } } },
  ],
  lyrics: { 'Song A|duet': 'a words', 'Song B|duet': 'b words' },
  book: { file: 'book.pdf' },
}
const FL = {
  album: 'fantasyland-population-1',
  title: 'Fantasyland, Population 1',
  tracks: [
    { n: 'i', title: 'One', art: 'song-art/01-one.png', versions: { solo: { file: 'audio/01-one.mp3' } } },
    { n: 'ii', title: 'Two', art: 'song-art/02-two.png', versions: { solo: { file: 'audio/02-two.mp3' } } },
  ],
  lyrics: { 'One|solo': '1', 'Two|solo': '2' },
  anchors: { 'Two|solo': [[1.0, 0, 1]] },
}
const DL2 = {
  album: 'desireland-population-2',
  title: 'Desireland, Population 2',
  tracks: [{ n: 1, title: 'X', versions: { jimmy: { file: 'audio/x-jimmy.mp3' }, megi: { file: 'audio/x-megi.mp3' } } }],
}
const FLYING = { album: 'flying', title: 'Flying', borrowed: true, tracks: [{ n: 1, title: 'Flying', versions: { solo: { r2: 'flying/f.m4a' } } }] }

const clone = (o) => JSON.parse(JSON.stringify(o))

test('only slugs the gate serves are albums (no admin/, queue/, settings/)', () => {
  assert.deepEqual(JP.parseRegisteredAlbums(GATE),
    ['desireland-population-2', 'fantasyland-population-1', 'desireland-population-2-v3', 'flying'])
})

test('catalog.js parses with comments and unquoted keys', () => {
  const cat = JP.parseCatalog(CATALOG)
  assert.equal(cat.length, 5)
  assert.equal(cat[3].sub, '8 min · Dallas')
})

test('publishable list skips films, borrowed and earlier editions, and carries the real tracks', () => {
  const albums = JP.publishableAlbums({
    registered: JP.parseRegisteredAlbums(GATE),
    catalog: JP.parseCatalog(CATALOG),
    data: { 'desireland-population-2': DL2, 'fantasyland-population-1': FL, 'desireland-population-2-v3': V3, flying: FLYING },
  })
  assert.deepEqual(albums.map((a) => a.slug), ['fantasyland-population-1', 'desireland-population-2-v3'])
  const v3 = albums[1]
  assert.equal(v3.name, 'Desireland v3 — Jimmy’s voice')
  assert.equal(v3.trackCount, 2)
  assert.deepEqual(v3.tracks.map((t) => t.title), ['Song A', 'Song B'])
  assert.deepEqual(v3.voices, ['duet'])
  // Nothing private rides along.
  assert.ok(!JSON.stringify(albums).includes('words'))
  assert.ok(!JSON.stringify(albums).includes('.mp3'))
})

test('a slug listed twice appears once; a shared name is told apart by edition', () => {
  const albums = JP.publishableAlbums({
    registered: ['a', 'a', 'b'],
    catalog: [{ album: 'a', title: 'Same', edition: 'One' }, { album: 'b', title: 'Same', edition: 'Two' }],
    data: { a: { tracks: [] }, b: { tracks: [] } },
  })
  assert.deepEqual(albums.map((a) => a.name), ['Same — One', 'Same — Two'])
})

test('page VOICES are read from the player page', () => {
  assert.deepEqual(JP.pageVoices("const VOICES = ['jimmy','megi'];"), ['jimmy', 'megi'])
  assert.equal(JP.pageVoices('<script>const TRACKS = [];</script>'), null)
})

test('append to v3: duet version, next number, words keyed Title|voice, catalog count bumped', () => {
  const p = JP.planPublish({
    slug: 'desireland-population-2-v3', data: clone(V3), catalogSrc: CATALOG,
    html: "const VOICES = ['duet'];", position: { mode: 'append' },
    displayTitle: 'New One', trackType: '(duet)', lyrics: 'new words\n', seconds: 181.234, artExt: 'png',
  })
  assert.equal(p.voice, 'duet')
  assert.deepEqual(p.entry, { n: 3, title: 'New One', art: 'song-art/new-one.png', versions: { duet: { file: 'audio/new-one-duet.mp3', seconds: 181.23 } } })
  assert.equal(p.audioKey, 'desireland-population-2-v3/new-one-duet.mp3')
  assert.equal(p.artPath, 'desireland-population-2-v3/song-art/new-one.png')
  assert.equal(p.data.lyrics['New One|duet'], 'new words')
  assert.deepEqual(p.affectedNs, [])
  assert.match(p.catalogSrc, /sub: "3 songs · Jimmy’s voice"/)
  // Only the v3 card changed.
  assert.match(p.catalogSrc, /sub: "2 songs · 2026"/)
  // Untouched tracks are the same objects' data, peaks and all.
  assert.deepEqual(p.data.tracks[0], V3.tracks[0])
  assert.deepEqual(p.data.book, V3.book)
})

test('insert on Fantasyland keeps roman numerals and reports the numbers that move', () => {
  const p = JP.planPublish({
    slug: 'fantasyland-population-1', data: clone(FL), catalogSrc: CATALOG, html: '',
    position: { mode: 'insert', n: 2 }, displayTitle: 'Middle', trackType: '', lyrics: '',
  })
  assert.deepEqual(p.data.tracks.map((t) => [t.n, t.title]), [['i', 'One'], ['ii', 'Middle'], ['iii', 'Two']])
  assert.equal(p.voice, 'solo')
  assert.equal(p.audioKey, 'fantasyland-population-1/middle.mp3')
  assert.deepEqual(p.affectedNs, ['ii'])
  assert.equal(p.entry.art, undefined)
  // Words and timing marks stay with their song, which is keyed by title.
  assert.deepEqual(p.data.anchors, FL.anchors)
  assert.match(p.catalogSrc, /sub: "3 songs · 2026"/)
})

test('replace keeps the number, drops the old song\'s words and marks', () => {
  const p = JP.planPublish({
    slug: 'fantasyland-population-1', data: clone(FL), catalogSrc: CATALOG, html: '',
    position: { mode: 'replace', n: 2 }, displayTitle: 'Two Again', trackType: '(instrumental)', lyrics: '',
  })
  assert.deepEqual(p.data.tracks.map((t) => [t.n, t.title]), [['i', 'One'], ['ii', 'Two Again (instrumental)']])
  assert.deepEqual(p.affectedNs, ['ii'])
  assert.deepEqual(p.replaced, { n: 'ii', title: 'Two', files: ['audio/02-two.mp3'] })
  assert.equal(p.data.lyrics['Two|solo'], undefined)
  assert.deepEqual(p.data.anchors, {})
  assert.match(p.catalogSrc, /sub: "2 songs · 2026"/)
})

test('a his-and-hers album needs to be told the voice, and only a voice it plays', () => {
  const base = { slug: 'desireland-population-2', data: clone(DL2), html: "const VOICES = ['jimmy','megi'];", position: { mode: 'append' }, displayTitle: 'Y' }
  assert.throws(() => JP.planPublish(base), /jimmy and megi/)
  assert.throws(() => JP.planPublish({ ...base, voice: 'duet' }), /would never be heard/)
  assert.equal(JP.planPublish({ ...base, voice: 'megi' }).audioKey, 'desireland-population-2/y-megi.mp3')
})

test('a title that would reuse another song\'s audio or art is refused', () => {
  assert.throws(() => JP.planPublish({
    slug: 'desireland-population-2-v3', data: clone(V3), html: "const VOICES = ['duet'];",
    position: { mode: 'append' }, displayTitle: 'Song A',
  }), /already uses song-a-duet\.mp3/)
})

test('bad positions are refused', () => {
  const base = { slug: 's', data: clone(V3), html: '', displayTitle: 'Z' }
  assert.throws(() => JP.planPublish({ ...base, position: { mode: 'replace', n: 3 } }), /album has 2 tracks/)
  assert.throws(() => JP.planPublish({ ...base, position: { mode: 'sideways' } }), /Unknown position/)
})

test('song-scoped shares on a moved number are conflicts; album-wide, revoked and expired ones are not', () => {
  const grants = [
    { label: 'Megi', scope: { kind: 'songs', items: [{ n: 'ii', voice: 'both' }] } },
    { label: 'Mom', scope: { kind: 'album' } },
    { label: 'Old', revoked: true, scope: { kind: 'songs', items: [{ n: 'ii', voice: 'both' }] } },
    { label: 'Gone', expires_at: '2020-01-01T00:00:00Z', scope: { kind: 'songs', items: [{ n: 'ii', voice: 'both' }] } },
    { label: 'Other', scope: { kind: 'songs', items: [{ n: 'i', voice: 'both' }] } },
  ]
  assert.deepEqual(JP.shareConflicts(grants, ['ii']).map((g) => g.label), ['Megi'])
  assert.deepEqual(JP.shareConflicts(grants, []), [])
  assert.deepEqual(JP.shareConflicts([{ scope: { kind: 'songs', items: [{ n: 2 }] } }], [2]).length, 1)
})

test('manifests are written back in the style they came in', () => {
  const d = { a: 1, b: [1, 2.5], c: { d: 'é' } }
  for (const src of [
    JSON.stringify(d),
    '{"a": 1, "b": [1, 2.5], "c": {"d": "é"}}\n',
    JSON.stringify(d, null, 1) + '\n',
  ]) assert.equal(JP.serializeManifest(JSON.parse(src), JP.manifestStyle(src)), src)
})
