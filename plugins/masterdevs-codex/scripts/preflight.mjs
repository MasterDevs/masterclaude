#!/usr/bin/env node
// Is this checkout fit to start work in?
//
// Runs right after the interview, before any planning — while the user is still sitting there, and
// before twenty minutes go into a plan written against the wrong tree. Everything after the approval
// gate runs unattended, so a dirty or stale checkout is not a problem the run can raise with anyone;
// it just absorbs it and reports the damage at the end.
//
//   node preflight.mjs            # human-readable
//   node preflight.mjs --json     # machine-readable, for the skill to summarize
//
// Measured across real runs, these checks cover the environment problems that actually happened:
// another effort's uncommitted work sitting in the same tree ("my change cannot be committed by
// staging everything"), being started on the shared mainline, a stale local test database producing 29
// phantom failures in an unrelated area, and a migration number that collides with one that landed on
// the default branch.
//
// It REPORTS, it does not fix. One of those runs found the stale test database, knew rebuilding was
// the fix, and correctly declined — rebuilding would have dropped databases another session was using.
// That judgment belongs to the user, so this prints the recommendation and stops.
//
// Project-specific checks live in `.masterdevs/preflight.json` at the repo root:
//
//   { "checks": [
//       { "label": "test database has its seeded reference data",
//         "run":   "psql -tAc 'select count(*) from los_category' myapp_test",
//         "expect": "48",
//         "onFail": "rebuild with `make test-db` (~4 min); drops DBs other sessions may be using" }
//   ] }
//
// `expect` is a substring match against stdout. Omit it and the check passes on exit code 0. Keeping
// these out of the plugin is deliberate: migrations and test databases are Django-shaped, and this
// plugin is meant to stay language-agnostic.

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const asJson = process.argv.includes('--json')
const findings = []   // {level: 'ok'|'warn', label, detail, action}
const ok = (label, detail) => findings.push({ level: 'ok', label, detail })
const warn = (label, detail, action) => findings.push({ level: 'warn', label, detail, action })

const sh = (cmd, opts = {}) => {
  try {
    return { out: execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', ...opts }).trim(), code: 0 }
  } catch (e) {
    return { out: (e.stdout || '').toString().trim(), code: e.status == null ? 1 : e.status }
  }
}

// ── Is this even a git repo? ────────────────────────────────────────────────
const top = sh('git rev-parse --show-toplevel')
if (top.code !== 0) {
  const msg = 'not a git repository — cannot check branch or working tree state'
  if (asJson) console.log(JSON.stringify({ findings: [{ level: 'warn', label: 'git', detail: msg }] }, null, 2))
  else console.log(`\nPreflight\n  ⚠ ${msg}\n`)
  process.exit(0)
}
const ROOT = top.out
// In a linked worktree ".git" is a file pointing at the real git dir, so path.join(ROOT, '.git', …)
// throws ENOTDIR and every check that reads a git file silently reports "missing". Ask git instead.
// `--git-common-dir` answers relative to the current directory, so ask it from ROOT and resolve there.
const GIT_DIR = (() => {
  const r = sh('git rev-parse --git-common-dir', { cwd: ROOT })
  return r.code === 0 && r.out ? path.resolve(ROOT, r.out) : path.join(ROOT, '.git')
})()

// ── Branch ─────────────────────────────────────────────────────────────────
const branch = sh('git rev-parse --abbrev-ref HEAD').out
// origin/HEAD is the reliable answer; fall back to whichever of main/master exists.
let def = sh('git symbolic-ref --quiet --short refs/remotes/origin/HEAD').out.replace(/^origin\//, '')
if (!def) def = ['main', 'master'].find((b) => sh(`git rev-parse --verify --quiet refs/heads/${b}`).code === 0) || 'main'
// def is interpolated into shell commands below and originates from a remote ref, which the
// repository controls. Anything but a plain ref name is not worth running.
if (!/^[A-Za-z0-9._\/-]+$/.test(def) || def.includes('..')) def = 'main'

if (branch === 'HEAD') {
  warn('branch', 'detached HEAD', 'check out a feature branch before starting')
} else if (branch === def) {
  warn('branch', `on the default branch (${def})`,
    'create a feature branch — work committed here is hard to separate and most repos forbid it')
} else {
  const ahead = sh(`git rev-list --count ${def}..HEAD`).out || '0'
  ok('branch', `${branch}, ${ahead} commit(s) ahead of ${def}`)
}

// ── Working tree ───────────────────────────────────────────────────────────
const porcelain = sh('git status --porcelain').out
const dirty = porcelain ? porcelain.split('\n').filter(Boolean) : []
if (dirty.length) {
  // Not a fixed slice(3): sh() trims, so the leading space of a " M path" status is already gone on
  // the first line but present on the rest. Strip the status codes by shape instead.
  const sample = dirty.slice(0, 5).map((l) => l.replace(/^\s*[MADRCU?!]{1,2}\s+/, '')).join(', ')
  warn('working tree', `${dirty.length} uncommitted file(s): ${sample}${dirty.length > 5 ? ', …' : ''}`,
    'stash them, or expect this run\'s diff to be tangled with them at commit time')
} else {
  ok('working tree', 'clean')
}

// ── Divergence from the default branch ─────────────────────────────────────
// No fetch: this must stay fast and offline-safe. Stale refs are reported as stale rather than trusted.
const remoteDef = `origin/${def}`
if (sh(`git rev-parse --verify --quiet refs/remotes/${remoteDef}`).code === 0) {
  const behind = parseInt(sh(`git rev-list --count HEAD..${remoteDef}`).out || '0', 10)
  const fetchedAt = (() => {
    try { return fs.statSync(path.join(GIT_DIR, 'FETCH_HEAD')).mtime } catch { return null }
  })()
  const staleDays = fetchedAt ? Math.floor((Date.now() - fetchedAt.getTime()) / 86400000) : null
  const age = staleDays == null ? 'never fetched' : `last fetched ${staleDays}d ago`
  if (behind > 20) {
    warn('vs ' + remoteDef, `${behind} commit(s) behind (${age})`,
      'merge or rebase first — a plan written against a stale tree can conflict on landing')
  } else {
    ok('vs ' + remoteDef, `${behind} commit(s) behind (${age})`)
  }
}

// ── Project-specific checks ────────────────────────────────────────────────
const cfgPath = path.join(ROOT, '.masterdevs', 'preflight.json')
let cfg = null
if (fs.existsSync(cfgPath)) {
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) }
  catch (e) { warn('preflight config', `${cfgPath} is not valid JSON: ${e.message}`, 'fix or remove it') }
}
if (cfg && Array.isArray(cfg.checks)) {
  for (const c of cfg.checks) {
    if (!c || !c.run) continue
    const label = c.label || c.run
    const r = sh(c.run, { cwd: ROOT, timeout: 30000 })
    const passed = c.expect ? r.out.includes(String(c.expect)) : r.code === 0
    if (passed) ok(label, c.expect ? `matched "${c.expect}"` : 'ok')
    else warn(label, c.expect ? `expected "${c.expect}", got "${r.out.slice(0, 80) || `exit ${r.code}`}"`
      : `exit ${r.code}`, c.onFail || 'no remedy configured')
  }
} else if (!cfg) {
  ok('project checks', `none configured (add ${path.relative(ROOT, cfgPath)} to add some)`)
}

// ── Report ─────────────────────────────────────────────────────────────────
const warns = findings.filter((f) => f.level === 'warn')
if (asJson) {
  console.log(JSON.stringify({ root: ROOT, branch, defaultBranch: def, warnings: warns.length, findings }, null, 2))
  process.exit(0)
}
console.log('\nPreflight')
for (const f of findings) {
  console.log(`  ${f.level === 'ok' ? '✓' : '⚠'} ${f.label}: ${f.detail}`)
  if (f.action) console.log(`      → ${f.action}`)
}
console.log(warns.length
  ? `\n${warns.length} thing(s) worth settling before the run goes dark.\n`
  : '\nNothing blocking. Safe to hand off.\n')
