#!/usr/bin/env node
// The Playbook's third lane: curated examples of good code, good abstractions, good design.
//
// Pattern catalogs say what shape to reach for. Lessons say what trap to avoid. Neither shows an agent
// a piece of code a human actually liked. That is what the gold lane holds — one file per example, with
// the excerpt snapshotted into it so a reading agent needs no access to the repo it came from.
//
// Three scopes, resolved in this order, first writer wins on an id collision:
//
//     repo    <repo>/.masterdevs/gold/        the team's, committed alongside their code
//     local   $PLAYBOOK_DIR/gold/             yours, on this machine
//     seeds   <plugin>/playbook-seeds/gold/   shipped, read-only
//
//   node gold.mjs --list                          # every resolved entry, with the scope that won
//   node gold.mjs --list --domain backend         # …filtered; --language, --tag and --for-pattern too
//   node gold.mjs --for-pattern "Null Object"     # entries demonstrating one catalog pattern
//   node gold.mjs --validate                      # structure + anchor rot; non-zero if anything rotted
//   node gold.mjs --reindex --scope local         # regenerate INDEX.md for ONE scope
//   node gold.mjs --merge-seeds                   # add newly shipped seed entries, clobbering none
//
// Scope inputs: --repo-root <dir>, --playbook-dir <dir>, --seeds-dir <dir>, or --gold-dir <dir> to
// bypass the chain entirely and treat one directory as the only scope.
//
// Node stdlib only, no models, no network. Safe to run in a loop.
//
// WHY A SCRIPT AND NOT AN AGENT: a gold entry becomes content every future agent reads, so what
// resolves, what wins a collision, and what counts as rotted must be readable, diffable and
// re-runnable — not a judgment that varies per invocation. The judgment calls that remain (re-anchor
// this, retire that) are left for a human in `/masterdevs:playbook`.
//
// SECURITY: entry bodies are untrusted content. Nothing here executes, evaluates or shell-interpolates
// an entry — it is read and printed. `--reindex` writes ONLY frontmatter-derived fields into the index,
// never body text, so a crafted body cannot reach the file every agent loads.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execSync, execFileSync } from 'node:child_process'

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : null)

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA = JSON.parse(fs.readFileSync(path.join(HERE, '../references/gold-schema.json'), 'utf8'))
const SEEDS_DEFAULT = path.resolve(HERE, '../playbook-seeds/gold')

// Failure-tolerant shell, same shape as preflight.mjs: a non-repo cwd is normal here, not an error.
const sh = (cmd, opts = {}) => {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', ...opts }).trim()
  } catch { return null }
}

const playbookDir = val('--playbook-dir') ||
  path.join(os.homedir(), '.claude/plugins/data/masterdevs-masterclaude/playbook')
const repoRoot = val('--repo-root') || sh('git rev-parse --show-toplevel')
const seedsDir = val('--seeds-dir') || SEEDS_DEFAULT
const goldDirOverride = val('--gold-dir')

// ── The spine: one ordered scope chain ─────────────────────────────────────
// Stated once, here. Every read path below consumes it, so repo-beats-local-beats-seeds is a property
// of the loader rather than something each flag re-derives (and re-derives differently).
// Where one lane lives, by name. Spelled out once because `--reindex` also needs to pick a single
// lane out by name, and a second copy of these three paths is a copy that can drift — reindex would
// then write an index into a directory the resolver never reads.
const laneDir = (scope) =>
  scope === 'repo' ? (repoRoot ? path.join(repoRoot, '.masterdevs', 'gold') : null)
    : scope === 'local' ? path.join(playbookDir, 'gold')
      : scope === 'seeds' ? seedsDir
        : null

const scopeChain = () => {
  if (goldDirOverride) return [{ scope: 'override', dir: path.resolve(goldDirOverride) }]
  // The order is written here, not read from the schema: precedence is a decision about whose entry
  // wins, and it must not change because someone reordered an enum.
  return ['repo', 'local', 'seeds']
    .map((scope) => ({ scope, dir: laneDir(scope) }))
    .filter((s) => s.dir && fs.existsSync(s.dir) && fs.statSync(s.dir).isDirectory())
}

// ── Frontmatter ────────────────────────────────────────────────────────────
// Deliberately NOT a YAML parser. Three line shapes are accepted and nothing else, because a silently
// mis-parsed anchor is worse than a refusal: an entry whose anchor was misread would validate clean
// while pointing at nothing.
//
//   key: scalar
//   key: [a, b, c]
//   key:
//     - {path: p, symbol: s, sha: h}
//
const parseFrontmatter = (text, file) => {
  const lines = text.split('\n')
  if (lines[0].trim() !== '---') throw new Error(`${file}:1 — expected a '---' frontmatter opener`)
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (end === -1) throw new Error(`${file}:1 — frontmatter is never closed by a '---' line`)

  const fields = {}
  let listKey = null
  for (let i = 1; i < end; i++) {
    const line = lines[i]
    const at = `${file}:${i + 1}`
    if (!line.trim()) continue

    const item = line.match(/^\s+-\s*\{(.*)\}\s*$/)
    if (item) {
      if (!listKey) throw new Error(`${at} — a '- {…}' item with no 'key:' line above it`)
      const obj = {}
      for (const pair of item[1].split(',')) {
        const kv = pair.match(/^\s*([A-Za-z][\w-]*)\s*:\s*(.*?)\s*$/)
        if (!kv) throw new Error(`${at} — '${pair.trim()}' is not a 'key: value' pair`)
        obj[kv[1]] = kv[2].replace(/^["']|["']$/g, '')
      }
      fields[listKey].push(obj)
      continue
    }

    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/)
    if (!kv) throw new Error(`${at} — '${line.trim()}' is not one of the three accepted shapes`)
    const [, key, raw] = kv
    if (raw === '') { listKey = key; fields[key] = []; continue }
    listKey = null
    const inline = raw.match(/^\[(.*)\]$/)
    fields[key] = inline
      ? inline[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
      : raw.replace(/^["']|["']$/g, '').trim()
  }
  return { fields, body: lines.slice(end + 1).join('\n') }
}

const isIndexFile = (name) => name === 'INDEX.md' || /^INDEX\..+\.md$/.test(name)

const loadEntries = (chain) => {
  const byId = new Map()
  const shadowed = []
  const broken = []
  for (const { scope, dir } of chain) {
    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !isIndexFile(f)).sort()) {
      const file = path.join(dir, name)
      let parsed
      try { parsed = parseFrontmatter(fs.readFileSync(file, 'utf8'), file) }
      catch (e) { broken.push({ file, id: name.replace(/\.md$/, ''), scope, problem: e.message }); continue }
      const id = parsed.fields.id || name.replace(/\.md$/, '')
      if (byId.has(id)) { shadowed.push({ id, scope }); continue }
      byId.set(id, { ...parsed.fields, body: parsed.body, id, file, filename: name, resolvedScope: scope })
    }
  }
  return { entries: [...byId.values()], shadowed, broken }
}

// ── Validation: a flat list of named single-purpose checks ─────────────────
// Each takes one entry and returns problem strings. Every list and enum comes from gold-schema.json,
// which is also what the capture prompt renders from — one contract, so capture cannot disagree with
// the validator. Adding a rule later means adding one function to this list.
const asList = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v])
const headings = (body) => [...body.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1])

const CHECKS = [
  function missingFrontmatter (e) {
    // `title:` with nothing after it parses to an empty list, exactly like a list key with no items —
    // the two are indistinguishable by the time they get here, so the schema says which fields are
    // allowed to end up empty. `patterns`, `lenses` and `not-this` legitimately can; a title cannot,
    // and a blank one used to sail through into the index as an entry with no name.
    const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length)
    const optional = new Set(SCHEMA.mayBeEmpty || [])
    return SCHEMA.requiredFrontmatter
      .filter((k) => e[k] === undefined || (empty(e[k]) && !optional.has(k)))
      .map((k) => `missing or empty frontmatter field: ${k}`)
  },
  function bodyHasContent (e) {
    // `sections` is the real body check, but it stands down when `kind` is unusable. An entry with a
    // bad kind and no body at all would otherwise be reported only for the kind.
    return e.body && e.body.trim() ? [] : ['the entry has no body — every section is missing']
  },
  function enumFields (e) {
    const out = []
    if (e.kind && !SCHEMA.kinds[e.kind]) out.push(`kind '${e.kind}' is not one of ${Object.keys(SCHEMA.kinds).join(', ')}`)
    if (e.scope && !SCHEMA.scopes.includes(e.scope)) out.push(`scope '${e.scope}' is not one of ${SCHEMA.scopes.join(', ')}`)
    if (e.source && !SCHEMA.sources.includes(e.source)) out.push(`source '${e.source}' is not one of ${SCHEMA.sources.join(', ')}`)
    return out
  },
  function idMatchesFilename (e) {
    const base = e.filename.replace(/\.md$/, '')
    return e.id === base ? [] : [`id '${e.id}' does not match filename '${e.filename}'`]
  },
  function sections (e) {
    const want = SCHEMA.kinds[e.kind]
    if (!want) return []                                  // enumFields already reported it
    const got = headings(e.body)
    const expected = [SCHEMA.firstSection, ...want.sections]
    if (got.length !== expected.length || got.some((h, i) => h !== expected[i])) {
      return [`sections are ${got.length ? got.join(' / ') : '(none)'} — a ${e.kind} entry needs exactly: ${expected.join(' / ')}`]
    }
    return []
  },
  function anchorsWellFormed (e) {
    const anchors = asList(e.anchors)
    if (!anchors.length) return []                        // missingFrontmatter already reported it
    return anchors.flatMap((a, i) => ['path', 'symbol', 'sha']
      .filter((k) => !a || !a[k])
      .map((k) => `anchor ${i + 1} is missing '${k}'`))
  },
]

// ── Anchor verification: three verdicts, and the middle one is why this is trusted ──
// ok          this checkout can judge the anchor, and the code it names is still there
// rotted      this checkout can judge it, and the code it names is gone → non-zero exit, re-anchor
// unreachable this checkout cannot judge it at all → reported as a note, exit stays clean
//
// Everything rests on one gate, asked before any file is opened: is this checkout in a position to
// judge this anchor? An anchor names the commit its excerpt was taken at, and the honest test has two
// halves — the commit must be in this repository's history, AND this checkout must be standing at or
// after it. Only past both is a comparison meaningful.
//
// Without that gate a lane on this machine gets judged against whatever repository the shell happens
// to be in, and every entry whose path also exists there — `README.md`, `src/index.ts`,
// `scripts/build.sh` — is reported ROTTED against a file it was never about. The false alarm is
// expensive: `/masterdevs:playbook` mode 5 offers a rotted entry up for retirement, so a wrong
// verdict costs a curated example its life, and a validator that cries wolf from every other
// directory is one people stop reading.
//
// Past the gate the reverse holds, and that is what the gate buys. A missing file is then not "cannot
// tell from here" — it is the commonest way an example actually goes stale, renamed or deleted, and
// the one case most worth catching. Reporting it as rot is only safe because every other checkout has
// already been excluded.
//
// The gate fails safe in one direction on purpose. A shallow clone, a history rewritten since capture,
// or a branch cut before the anchor commit will not satisfy it, so those anchors read as not-checkable
// rather than as rot: a missed rot is one line in a report, while a false rot deletes an entry.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Reasons are CODES first, prose second. Mode 5 tells a human "leave this alone" for one skip reason
// and "re-anchor it" for another, so the distinction has to be something a test can assert on. Prose
// alone means a wording tweak can silently invert the advice with every check still green.
const SKIP = {
  NOT_THIS_REPO: 'not the repository this excerpt came from — its anchor commit is not in this history',
  BEHIND_ANCHOR: 'this checkout is older than the excerpt — its anchor commit is not an ancestor of HEAD',
  OUTSIDE_REPO: 'the recorded path points outside the repository — refusing to read it',
}
const ROT = {
  FILE_GONE: 'the file is gone from the repository this excerpt came from',
  SYMBOL_GONE: 'the file is still here but no longer contains the symbol',
  RANGE_SHORT: 'the file is shorter than the recorded line range',
}

// Anchor shas come out of entry files, which are untrusted content (see SECURITY at the top). A sha
// never reaches a shell: it is refused unless it is sha-shaped, and git is then handed an argv.
const isShaShaped = (sha) => /^[0-9a-f]{7,40}$/i.test(String(sha ?? ''))

const gitOk = (root, args) => {
  try { execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' }); return true }
  catch { return false }
}

// Two questions, not one, and conflating them produced a false alarm in every feature worktree.
// `cat-file -e` answers "is this commit in the object store", which fetching someone else's branch
// satisfies. What decides whether the working tree is comparable to the excerpt is "does the history
// I am standing on include the commit this was captured at" — so a checkout cut BEFORE the anchor
// commit must read as not-comparable rather than as rot.
const anchorReach = new Map()
const reachOf = (root, sha) => {
  if (!root || !isShaShaped(sha)) return 'NOT_THIS_REPO'
  const key = `${root} ${sha}`
  if (!anchorReach.has(key)) {
    anchorReach.set(key, !gitOk(root, ['cat-file', '-e', `${sha}^{commit}`]) ? 'NOT_THIS_REPO'
      : !gitOk(root, ['merge-base', '--is-ancestor', sha, 'HEAD']) ? 'BEHIND_ANCHOR'
        : 'OK')
  }
  return anchorReach.get(key)
}

// `\b` only asserts a boundary between a word and a non-word character, so it can never match on the
// punctuated side of a symbol: `@pytest.fixture` was reported rotted against a file containing it
// literally. Apply each boundary only where that end of the symbol is itself a word character.
const symbolRe = (symbol) => {
  const s = String(symbol)
  return new RegExp(`${/^\w/.test(s) ? '\\b' : ''}${escapeRe(s)}${/\w$/.test(s) ? '\\b' : ''}`)
}

// An anchor path is untrusted entry content, so it gets the same containment treatment `--reindex`
// gives its writes: resolve it, then prove it is still inside the repository being judged.
const withinRepo = (root, file) =>
  file === path.resolve(root) || file.startsWith(path.resolve(root) + path.sep)

const checkAnchor = (anchor, root) => {
  // This guard also settles `root`: with no repository to resolve against there is nothing to judge,
  // so everything below can rely on having one.
  const reach = reachOf(root, anchor.sha)
  if (reach !== 'OK') return { verdict: 'unreachable', reason: reach, why: SKIP[reach] }

  const file = path.resolve(root, anchor.path)
  if (!withinRepo(root, file)) {
    return { verdict: 'unreachable', reason: 'OUTSIDE_REPO', why: SKIP.OUTSIDE_REPO }
  }
  // Past the reach gate this IS the repository the excerpt came from, standing at or after the commit
  // it was captured at — so a missing file is not "cannot judge from here", it is the commonest way an
  // example actually goes stale: renamed or deleted. Calling that rot is only safe because the gate
  // above has already excluded every other checkout, which is the whole reason the gate exists.
  if (!fs.existsSync(file)) return { verdict: 'rotted', reason: 'FILE_GONE', why: ROT.FILE_GONE }

  const text = fs.readFileSync(file, 'utf8')
  const range = String(anchor.symbol).match(/^L(\d+)-L(\d+)$/)
  if (range) {
    return text.split('\n').length >= Number(range[2])
      ? { verdict: 'ok' }
      : { verdict: 'rotted', reason: 'RANGE_SHORT', why: ROT.RANGE_SHORT }
  }
  // Language-agnostic on purpose: the same check has to work for a Python `def`, a TypeScript export
  // and a Terraform block. Parsing any of those properly is not this script's job.
  return symbolRe(anchor.symbol).test(text)
    ? { verdict: 'ok' }
    : { verdict: 'rotted', reason: 'SYMBOL_GONE', why: ROT.SYMBOL_GONE }
}

// ── Filters: a table of predicate builders, AND-composed ──────────────────
// Four flags that cannot grow an if-ladder. Adding a fifth is one line.
const FILTERS = {
  domain: (v) => (e) => e.domain === v,
  language: (v) => (e) => e.language === v,
  tag: (v) => (e) => asList(e.lenses).includes(v) || asList(e.patterns).includes(v),
  'for-pattern': (v) => (e) => asList(e.patterns).some((p) => p.toLowerCase() === v.toLowerCase()),
}
const applyFilters = (entries) => {
  const active = Object.entries(FILTERS)
    .filter(([flag]) => has(`--${flag}`))
    .map(([flag, build]) => build(val(`--${flag}`)))
  return entries.filter((e) => active.every((p) => p(e)))
}

// ── Index rendering ────────────────────────────────────────────────────────
const INDEX_HEADER = '# Gold Lane Index\n' +
  'Generated by `gold.mjs --reindex` from each entry\'s frontmatter — do not hand-edit.\n'

const entryLine = (e) =>
  `- \`${e.id}\` — ${e.title} — ${e.kind}, ${e.language} — patterns: ${asList(e.patterns).join(', ') || '—'}`

const renderIndex = (entries, target) => {
  const byDomain = new Map()
  for (const e of entries) {
    const d = e.domain || 'unsorted'
    if (!byDomain.has(d)) byDomain.set(d, [])
    byDomain.get(d).push(e)
  }
  const files = []
  let main = INDEX_HEADER
  if (!entries.length) return [{ file: path.join(target, 'INDEX.md'), text: `${main}\n_No entries._\n` }]

  for (const domain of [...byDomain.keys()].sort()) {
    const lines = byDomain.get(domain).map(entryLine).sort()
    const block = `\n## ${domain}\n\n${lines.join('\n')}\n`
    if (block.split('\n').length > SCHEMA.indexSplitLines) {
      const spill = `INDEX.${domain}.md`
      files.push({ file: path.join(target, spill), text: `${INDEX_HEADER}\n## ${domain}\n\n${lines.join('\n')}\n` })
      main += `\n## ${domain}\n\n- ${lines.length} entries — see [\`${spill}\`](./${spill})\n`
    } else {
      main += block
    }
  }
  files.unshift({ file: path.join(target, 'INDEX.md'), text: main })
  return files
}

// "entry"/"entries" is rendered at four call sites below (the shadow footer, --list, --validate,
// --reindex) — one pluralizer instead of four copies of the same ternary.
const entryWord = (n) => `entr${n === 1 ? 'y' : 'ies'}`

// ── Actions ────────────────────────────────────────────────────────────────
const chain = scopeChain()
const { entries, shadowed, broken } = chain.length
  ? loadEntries(chain)
  : { entries: [], shadowed: [], broken: [] }

const footer = () => {
  if (shadowed.length) {
    console.log(`  ${shadowed.length} ${entryWord(shadowed.length)} shadowed by a higher scope: ` +
      shadowed.map((s) => `${s.id} (${s.scope})`).join(', '))
  }
}

const doList = () => {
  const hits = applyFilters(entries)
  console.log(`\nGold lane — ${hits.length} ${entryWord(hits.length)}` +
    `${chain.length ? `   scopes: ${chain.map((c) => c.scope).join(' → ')}` : '   (no gold directory found)'}\n`)
  if (hits.length) {
    console.log('  id                             scope   kind          domain        title')
    console.log('  ' + '─'.repeat(94))
    for (const e of hits.sort((a, b) => a.id.localeCompare(b.id))) {
      console.log(`  ${e.id.padEnd(30)} ${String(e.resolvedScope).padEnd(7)} ${String(e.kind).padEnd(13)} ` +
        `${String(e.domain).padEnd(13)} ${e.title}`)
    }
    console.log('  ' + '─'.repeat(94))
  }
  footer()
  if (broken.length) console.log(`\n  ${broken.length} file(s) could not be parsed — run --validate to see why.`)
  console.log(hits.length
    ? `\n  Read one with: cat <gold dir>/<id>.md\n`
    : '\n  Capture one with /masterdevs:gold — it is the only writer of this lane.\n')
  process.exit(0)
}

const doValidate = () => {
  const problems = []      // structural or rotted → non-zero exit
  const notes = []         // unreachable → reported only

  // Same for every entry this run: with --gold-dir, only an EXPLICIT --repo-root anchors resolution —
  // an ambient git checkout the caller never named must not silently supply it.
  const anchorRoot = goldDirOverride ? (val('--repo-root') || null) : repoRoot

  for (const b of broken) problems.push(`${b.id} — ${b.problem}`)

  for (const e of entries) {
    for (const check of CHECKS) {
      for (const p of check(e)) problems.push(`${e.id} (${e.filename}) — ${p}`)
    }
    for (const a of asList(e.anchors)) {
      if (!a || !a.path || !a.symbol) continue            // anchorsWellFormed already reported it
      const { verdict, reason, why } = checkAnchor(a, anchorRoot)
      // The code is printed alongside the prose so mode 5 branches on the code rather than
      // pattern-matching the sentence, and so a test can assert which case fired.
      if (verdict === 'rotted') problems.push(`${e.id} — ${a.path}#${a.symbol} [${reason}] ${why}`)
      if (verdict === 'unreachable') notes.push(`${e.id} — ${a.path} [${reason}] ${why}`)
    }
  }

  console.log(`\nGold lane — validate   ${entries.length} ${entryWord(entries.length)}` +
    `${chain.length ? `   scopes: ${chain.map((c) => c.scope).join(' → ')}` : ''}\n`)
  if (problems.length) {
    console.log(`  ${problems.length} problem(s) — a rotted anchor or a malformed entry:`)
    for (const p of problems) console.log(`    ✗ ${p}`)
    console.log('')
  }
  if (notes.length) {
    console.log(`  ${notes.length} unreachable anchor(s) — NOT rot, and nothing to fix. An anchor is judged`)
    console.log('  only from a checkout whose history holds the commit it was captured at, standing at or')
    console.log('  after that commit. Each of these was skipped, for the reason given:')
    for (const n of notes) console.log(`    · ${n}`)
    console.log('')
  }
  footer()
  console.log(problems.length
    ? '  Re-anchor or retire each one with /masterdevs:playbook (mode 5).\n'
    : '  Every entry is well-formed and every anchor this checkout could judge still resolves.\n')
  process.exit(problems.length ? 1 : 0)
}

// Shared by --reindex and --merge-seeds, because a merge that adds entries and leaves a stale index
// behind has added entries no agent will find.
const writeIndex = (scope, target) => {
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true })
  // Index only what lives in the target scope — an index in one lane must not list another lane's
  // entries, or a user's file would describe entries they cannot see.
  const own = loadEntries([{ scope, dir: target }]).entries
  const files = renderIndex(own, target)
  for (const f of files) {
    if (!path.resolve(f.file).startsWith(path.resolve(target) + path.sep)) {
      console.error(`\nRefusing to write outside the ${scope} lane: ${f.file}\n`)
      process.exit(1)
    }
    fs.writeFileSync(f.file, f.text)
  }
  return { count: own.length, files }
}

// Bring newly shipped seed entries into this machine's lane. This is code rather than a documented
// `cp` for one reason: it was documented, in two skills, and the two copies drifted — and both of them
// assumed `$PLAYBOOK_DIR/gold/` already existed. On a Playbook seeded before this lane shipped it does
// not, so the very first bootstrap command failed and the lane never appeared at all.
//
// Whole files, keyed by `<id>.md`, and never over an existing one. An id names ONE curated example, so
// absence is the only question there is to ask — there is no row to merge, and a user's edited entry
// under a shipped id must survive byte-for-byte.
const doMergeSeeds = () => {
  // The destination is always this machine's lane. `--gold-dir` would look like it redirected that, so
  // it is refused rather than ignored — a flag that silently does nothing is how a merge lands somewhere
  // nobody checks.
  if (goldDirOverride) {
    console.error('\n--merge-seeds always writes this machine\'s local lane. Point it with --playbook-dir; ' +
      '--gold-dir is not accepted here.\n')
    process.exit(1)
  }
  const target = laneDir('local')
  const isEntry = (f) => f.endsWith('.md') && !isIndexFile(f)
  if (!fs.existsSync(seedsDir)) {
    console.log(`\nNo shipped gold seeds at ${seedsDir} — nothing to merge.\n`)
    process.exit(0)
  }
  fs.mkdirSync(target, { recursive: true })

  const added = []
  const kept = []
  for (const name of fs.readdirSync(seedsDir).filter(isEntry).sort()) {
    const dest = path.join(target, name)
    if (fs.existsSync(dest)) { kept.push(name); continue }
    fs.copyFileSync(path.join(seedsDir, name), dest)
    added.push(name)
  }

  const { count } = writeIndex('local', target)
  console.log(`\nGold lane — merged shipped seeds into the local lane`)
  console.log(`${target}\n`)
  console.log(`  added ${added.length} new ${entryWord(added.length)}${added.length ? `: ${added.join(', ')}` : ''}`)
  console.log(`  left ${kept.length} existing ${entryWord(kept.length)} untouched`)
  console.log(`  index now lists ${count} ${entryWord(count)}\n`)
  process.exit(0)
}

const doReindex = () => {
  // The ONLY mutating flag in this file. --scope has no default on purpose: an accidental default is
  // exactly how mutable state lands under CLAUDE_PLUGIN_ROOT.
  const scope = val('--scope')
  if (!SCHEMA.scopes.includes(scope)) {
    console.error(`\n--reindex requires an explicit --scope ${SCHEMA.scopes.join('|')} — refusing to guess ` +
      'which lane to write.\n')
    process.exit(1)
  }
  const target = goldDirOverride ? path.resolve(goldDirOverride) : laneDir(scope)
  if (!target) {
    console.error('\nNo repo root — run --reindex --scope repo from inside a git checkout.\n')
    process.exit(1)
  }
  if (scope === 'seeds') {
    const top = sh('git rev-parse --show-toplevel')
    if (!top || !path.resolve(target).startsWith(path.resolve(top) + path.sep)) {
      console.error('\nThe shipped seed lane is read-only outside the plugin\'s own checkout. Regenerate it ' +
        'from a clone of the plugin repo, or reindex --scope local instead.\n')
      process.exit(1)
    }
  }
  const { count, files } = writeIndex(scope, target)
  console.log(`\nGold lane — reindexed ${count} ${entryWord(count)} in the ${scope} lane`)
  console.log(`${target}\n`)
  for (const f of files) console.log(`  wrote ${path.basename(f.file)}`)
  console.log(`\n  Check it with: node gold.mjs --validate --gold-dir "${target}"\n`)
  process.exit(0)
}

if (has('--merge-seeds')) doMergeSeeds()
else if (has('--reindex')) doReindex()
else if (has('--validate')) doValidate()
else doList()
