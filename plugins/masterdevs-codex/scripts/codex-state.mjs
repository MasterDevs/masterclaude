#!/usr/bin/env node

// Provider-owned run state for the Codex adapter. Unlike the Claude status helper, this never reads
// host session internals; it records only state MasterDevs creates itself.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(SCRIPT_DIR, '..')
const SEEDS = path.join(PLUGIN_ROOT, 'playbook-seeds')
const argv = process.argv.slice(2)
const command = argv[0] || 'help'
const wantsJson = argv.includes('--json')
// Both windows are overridable so the scenario suite can exercise a stale lock without waiting a
// minute for it. Nothing in normal use sets them. A value that is not a positive number falls back
// rather than becoming NaN — NaN makes every deadline comparison false and the wait loop spin forever.
const MAX_LOCK_WINDOW_MS = 3600000
const duration = (value, fallback) => {
  const parsed = Number(value)
  // An upper bound as well as a lower one. The timeout is floored at twice the stale window, so an
  // absurd staleness value would push the give-up time past any reachable clock and restore exactly
  // the never-terminating wait the NaN check exists to prevent.
  return Number.isFinite(parsed) && parsed > 0 && parsed <= MAX_LOCK_WINDOW_MS ? parsed : fallback
}
const LOCK_STALE_MS = duration(process.env.MASTERDEVS_LOCK_STALE_MS, 15000)
// Held above LOCK_STALE_MS rather than merely documented as such. With a shorter timeout a waiter
// gives up before it is ever entitled to break the lock a killed process left behind, and the run can
// never record again — so an override that inverts the two is raised to a workable value.
const LOCK_TIMEOUT_MS = Math.max(
  duration(process.env.MASTERDEVS_LOCK_TIMEOUT_MS, 60000),
  LOCK_STALE_MS * 2,
)
const LOCK_POLL_MS = 25
// Returns null when the flag is absent, and the empty string when it is present with an empty value —
// so callers can tell "leave this alone" apart from "clear this". A value that looks like another flag
// is a missing value, not a value: `record --status --json` used to set the status to "--json".
const flag = (name) => {
  const inline = argv.find((token) => token.startsWith(`${name}=`))
  if (inline !== undefined) return inline.slice(name.length + 1)
  const at = argv.indexOf(name)
  if (at === -1) return null
  const value = argv[at + 1]
  if (value === undefined || /^--./.test(value)) {
    throw new Error(`${name} requires a value (write ${name}=<value> for one that starts with --)`)
  }
  return value
}

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

function repoContext() {
  let top
  try {
    top = git(process.cwd(), 'rev-parse', '--show-toplevel')
  } catch {
    throw new Error('not inside a git repository — run this from the repository you are working in')
  }
  const repoRoot = path.resolve(top)
  // `--git-common-dir` answers relative to the CURRENT directory, not the repo root, so asking from
  // the repo root is what makes the answer resolvable against it. Asking from a subdirectory returns
  // "../.git", and resolving that against the root lands on the PARENT of the repo — which silently
  // moved both the Playbook and the run key depending on where the user happened to be standing.
  const gitCommonDir = path.resolve(repoRoot, git(repoRoot, 'rev-parse', '--git-common-dir'))
  const override = process.env.MASTERDEVS_DATA_DIR
  if (override && !path.isAbsolute(override)) throw new Error('MASTERDEVS_DATA_DIR must be an absolute path')
  const repositorySlug = path.basename(path.dirname(gitCommonDir))
  const worktreeSlug = path.basename(repoRoot)
  const commonKey = crypto.createHash('sha256').update(gitCommonDir).digest('hex').slice(0, 12)
  const worktreeKey = crypto.createHash('sha256').update(repoRoot).digest('hex').slice(0, 8)
  const runKey = `${worktreeSlug}-${commonKey}-${worktreeKey}`
  const dataDir = override
    || path.join(os.tmpdir(), `masterdevs-${currentUid() ?? 'shared'}`, `${repositorySlug}-${commonKey}`)
  ensureStateDir(dataDir, { chosenByUs: !override })
  return { repoRoot, gitCommonDir, dataDir, repositorySlug, worktreeSlug, runKey }
}

function currentUid() {
  try { return os.userInfo().uid } catch { return null }
}

// The Playbook under this directory is read back to agents as instructions, so a directory someone
// else owns or can write to is not one to keep run state in.
//
// How hard to insist depends on who chose the path. Under the shared temp directory the path is ours
// and guessable, so it is held to 0700 and to this user. MASTERDEVS_DATA_DIR is the user's own
// decision — docs/CODEX.md recommends a durable directory they pick — so a loose mode is reported
// rather than silently changed, and a directory owned by someone else is theirs to explain, not ours
// to refuse. A bind-mounted volume owned by the host user, read by a root process, is ordinary.
function ensureStateDir(dir, { chosenByUs }) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (process.platform === 'win32') return dir
  const stat = fs.lstatSync(dir)
  if (stat.isSymbolicLink()) throw new Error(`${dir} is a symlink — refusing to keep run state there`)
  const uid = currentUid()
  const foreign = uid !== null && uid !== 0 && stat.uid !== uid
  const loose = Boolean(stat.mode & 0o077)
  if (chosenByUs) {
    if (foreign) throw new Error(`${dir} belongs to another user — refusing to keep run state there`)
    if (loose) fs.chmodSync(dir, 0o700)
    return dir
  }
  if (foreign || loose) {
    console.error(`codex-state: warning — ${dir} is reachable beyond its owner, and the Playbook`
      + ' kept there is read to agents as instructions')
  }
  return dir
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

// A rename keeps a reader from seeing half a file; it does not keep two writers from overwriting each
// other. The loop runs Verify and Review at the same time and both record, so a read-modify-write of
// run.json needs a real mutex or one phase's event disappears.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function withLock(lockPath, fn) {
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  let handle = null
  let held = null
  for (;;) {
    try {
      fs.mkdirSync(path.dirname(lockPath), { recursive: true })
      handle = fs.openSync(lockPath, 'wx', 0o600)
      fs.writeSync(handle, `${process.pid}\n`)
      held = fs.fstatSync(handle).ino
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      // A process killed mid-write leaves its lock behind; break one that is clearly abandoned.
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath)
          continue
        }
      } catch { continue }
      if (Date.now() >= deadline) throw new Error(`timed out waiting for the lock at ${lockPath}`)
      sleepSync(LOCK_POLL_MS)
    }
  }
  try {
    return fn()
  } finally {
    fs.closeSync(handle)
    // Only remove the file we actually created — see `held` above.
    try { if (fs.statSync(lockPath).ino === held) fs.unlinkSync(lockPath) } catch { /* already gone */ }
  }
}

// Adds seed files the Playbook does not have yet and never touches one it does. That repairs a copy
// interrupted half-way AND delivers files added in a later seed release, without overwriting the
// promoted entries a user has spent runs accumulating.
function copyMissing(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true })
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const from = path.join(sourceDir, entry.name)
    const to = path.join(targetDir, entry.name)
    const existing = (() => {
      try { return fs.statSync(to) } catch { return null }
    })()
    if (entry.isDirectory()) {
      if (existing && !existing.isDirectory()) {
        throw new Error(`${to} is a file where the Playbook needs a directory — move it aside`)
      }
      copyMissing(from, to)
    } else if (existing && existing.isDirectory()) {
      throw new Error(`${to} is a directory where the Playbook needs a file — move it aside`)
    } else if (!existing) {
      fs.copyFileSync(from, to)
    }
  }
}

function bootstrapPlaybook(playbookDir) {
  const seedVersion = fs.readFileSync(path.join(SEEDS, 'VERSION'), 'utf8').trim()
  const stampPath = path.join(playbookDir, 'SEED_VERSION')
  const installed = (() => {
    try { return fs.readFileSync(stampPath, 'utf8').trim() } catch { return null }
  })()
  if (installed !== seedVersion) {
    fs.mkdirSync(playbookDir, { recursive: true })
    copyMissing(SEEDS, playbookDir)
    fs.writeFileSync(stampPath, `${seedVersion}\n`)
  }

  const patternRoot = path.join(playbookDir, 'patterns')
  for (const entry of fs.readdirSync(patternRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const candidate = path.join(patternRoot, entry.name, 'candidates.md')
    if (!fs.existsSync(candidate)) fs.writeFileSync(candidate, `# ${entry.name} pattern candidates\n\n`)
  }
  const lessonsRoot = path.join(playbookDir, 'lessons')
  for (const entry of fs.readdirSync(lessonsRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.endsWith('.candidates.md')) continue
    const lane = entry.name.slice(0, -3)
    const candidate = path.join(lessonsRoot, `${lane}.candidates.md`)
    if (!fs.existsSync(candidate)) fs.writeFileSync(candidate, `# ${lane} lesson candidates\n\n`)
  }
}

function readRun(runDir) {
  const statePath = path.join(runDir, 'run.json')
  return { statePath, state: JSON.parse(fs.readFileSync(statePath, 'utf8')) }
}

// One unreadable run.json must not hide every other run. A run interrupted mid-write, or a directory a
// user edited by hand, is skipped rather than allowed to break `latest` and `status` outright.
function listRuns(ctx) {
  const root = path.join(ctx.dataDir, 'runs', ctx.runKey)
  if (!fs.existsSync(root)) return []
  const runs = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try { runs.push(readRun(path.join(root, entry.name)).state) } catch { continue }
  }
  return runs.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

function print(value, human) {
  if (wantsJson) console.log(JSON.stringify(value, null, 2))
  else console.log(human(value))
}

// Two phases starting at once must not both be half-way through copying the seeds when the other
// starts reading them.
function ensurePlaybook(ctx) {
  const playbookDir = path.join(ctx.dataDir, 'playbook')
  withLock(path.join(ctx.dataDir, 'playbook.lock'), () => bootstrapPlaybook(playbookDir))
  return playbookDir
}

function init() {
  const ctx = repoContext()
  const playbookDir = ensurePlaybook(ctx)
  const now = new Date()
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const runId = `${stamp}-${crypto.randomBytes(2).toString('hex')}`
  const runDir = path.join(ctx.dataDir, 'runs', ctx.runKey, runId)
  fs.mkdirSync(runDir, { recursive: true })
  const state = {
    schemaVersion: 1,
    runId,
    adapter: 'codex-native',
    repoRoot: ctx.repoRoot,
    dataDir: ctx.dataDir,
    playbookDir,
    runDir,
    requirementsPath: path.join(runDir, 'requirements.md'),
    planPath: path.join(runDir, 'plan.md'),
    verifyLogPath: path.join(runDir, 'verify-log.md'),
    repoVerifyNotesPath: path.join(ctx.dataDir, 'runs', ctx.runKey, 'verify-repo-notes.md'),
    status: 'planning',
    phase: 'Interview',
    message: 'Run initialized',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    events: [{ at: now.toISOString(), phase: 'Interview', status: 'planning', message: 'Run initialized' }],
  }
  atomicJson(path.join(runDir, 'run.json'), state)
  print(state, (item) => item.runDir)
}

function paths() {
  const ctx = repoContext()
  const playbookDir = ensurePlaybook(ctx)
  const value = {
    ...ctx,
    playbookDir,
    runsDir: path.join(ctx.dataDir, 'runs', ctx.runKey),
    repoVerifyNotesPath: path.join(ctx.dataDir, 'runs', ctx.runKey, 'verify-repo-notes.md'),
  }
  print(value, (item) => item.dataDir)
}

function record() {
  const requested = flag('--run-dir')
  if (!requested || !path.isAbsolute(requested)) throw new Error('record requires an absolute --run-dir')
  // Absolute is not the same as ours. Without this, any run.json anywhere on the filesystem could be
  // rewritten by passing its path.
  const ctx = repoContext()
  const declaredRoot = path.join(ctx.dataDir, 'runs', ctx.runKey)
  fs.mkdirSync(declaredRoot, { recursive: true })
  const runsRoot = fs.realpathSync(declaredRoot)
  let runDir
  try {
    runDir = fs.realpathSync(requested)
  } catch {
    throw new Error(`no run directory at ${requested}`)
  }
  if (runDir !== runsRoot && !runDir.startsWith(runsRoot + path.sep)) {
    throw new Error(`--run-dir must be inside ${declaredRoot}`)
  }

  // Read, modify and write under one lock, so a phase recording in parallel cannot overwrite the
  // event this call is appending.
  const updated = withLock(path.join(runDir, 'run.lock'), () => {
    const { statePath, state } = readRun(runDir)
    const now = new Date().toISOString()
    const phase = flag('--phase') ?? state.phase
    const status = flag('--status') ?? state.status
    // An omitted --message keeps the stored one, the same as --phase and --status. Pass an empty
    // --message to clear it; omitting it used to wipe it.
    const message = flag('--message') ?? state.message ?? ''
    state.phase = phase
    state.status = status
    state.message = message
    state.updatedAt = now
    state.events.push({ at: now, phase, status, message })
    atomicJson(statePath, state)
    return state
  })
  print(updated, (item) => `${item.status} · ${item.phase}${item.message ? ` · ${item.message}` : ''}`)
}

function latest() {
  const ctx = repoContext()
  const statuses = (flag('--status') || '').split(',').filter(Boolean)
  const found = listRuns(ctx).find((run) => !statuses.length || statuses.includes(run.status))
  if (!found) return print(null, () => 'No MasterDevs Codex run found.')
  print(found, (item) => item.runDir)
}

function status() {
  const ctx = repoContext()
  const wanted = flag('--run-id')
  const found = listRuns(ctx).find((run) => !wanted || run.runId === wanted)
  if (!found) return print(null, () => wanted
    ? `No MasterDevs Codex run found with id ${wanted}.`
    : 'No MasterDevs Codex run found.')
  print(found, (item) => {
    const updated = new Date(item.updatedAt).toLocaleString()
    return `${item.status === 'completed' ? '✓' : '⏳'} ${item.runId} · ${item.phase} · ${item.status} · ${updated}` +
      `${item.message ? `\n  ${item.message}` : ''}`
  })
}

function help() {
  console.log(`Usage:
  node codex-state.mjs paths [--json]
  node codex-state.mjs init [--json]
  node codex-state.mjs record --run-dir <absolute> [--phase <name>] [--status <status>] [--message <text>] [--json]
  node codex-state.mjs latest [--status <comma-separated>] [--json]
  node codex-state.mjs status [--run-id <id>] [--json]

record leaves --phase, --status and --message unchanged when the flag is omitted; pass an empty
--message to clear it. --run-dir must sit inside this repository's own runs directory.

Set MASTERDEVS_DATA_DIR to an absolute writable directory to override the stable system-temp default.`)
}

try {
  if (command === 'paths') paths()
  else if (command === 'init') init()
  else if (command === 'record') record()
  else if (command === 'latest') latest()
  else if (command === 'status') status()
  else help()
} catch (error) {
  console.error(`codex-state: ${error.message}`)
  process.exitCode = 1
}
