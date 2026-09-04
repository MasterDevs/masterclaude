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
const flag = (name) => {
  const at = argv.indexOf(name)
  return at === -1 ? null : argv[at + 1]
}

function git(...args) {
  return execFileSync('git', args, {
    cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

function repoContext() {
  const repoRoot = path.resolve(git('rev-parse', '--show-toplevel'))
  const gitCommonDir = path.resolve(repoRoot, git('rev-parse', '--git-common-dir'))
  const override = process.env.MASTERDEVS_DATA_DIR
  if (override && !path.isAbsolute(override)) throw new Error('MASTERDEVS_DATA_DIR must be an absolute path')
  const repositorySlug = path.basename(path.dirname(gitCommonDir))
  const worktreeSlug = path.basename(repoRoot)
  const commonKey = crypto.createHash('sha256').update(gitCommonDir).digest('hex').slice(0, 12)
  const worktreeKey = crypto.createHash('sha256').update(repoRoot).digest('hex').slice(0, 8)
  const runKey = `${worktreeSlug}-${commonKey}-${worktreeKey}`
  const dataDir = override || path.join(os.tmpdir(), 'masterdevs', `${repositorySlug}-${commonKey}`)
  return { repoRoot, gitCommonDir, dataDir, repositorySlug, worktreeSlug, runKey }
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

function bootstrapPlaybook(playbookDir) {
  if (!fs.existsSync(playbookDir)) {
    fs.mkdirSync(path.dirname(playbookDir), { recursive: true })
    fs.cpSync(SEEDS, playbookDir, { recursive: true })
    const version = fs.readFileSync(path.join(SEEDS, 'VERSION'), 'utf8').trim()
    fs.writeFileSync(path.join(playbookDir, 'SEED_VERSION'), `${version}\n`)
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

function listRuns(ctx) {
  const root = path.join(ctx.dataDir, 'runs', ctx.runKey)
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'run.json')))
    .map((entry) => readRun(path.join(root, entry.name)).state)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

function print(value, human) {
  if (wantsJson) console.log(JSON.stringify(value, null, 2))
  else console.log(human(value))
}

function init() {
  const ctx = repoContext()
  const playbookDir = path.join(ctx.dataDir, 'playbook')
  bootstrapPlaybook(playbookDir)
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
  const playbookDir = path.join(ctx.dataDir, 'playbook')
  bootstrapPlaybook(playbookDir)
  const value = {
    ...ctx,
    playbookDir,
    runsDir: path.join(ctx.dataDir, 'runs', ctx.runKey),
    repoVerifyNotesPath: path.join(ctx.dataDir, 'runs', ctx.runKey, 'verify-repo-notes.md'),
  }
  print(value, (item) => item.dataDir)
}

function record() {
  const runDir = flag('--run-dir')
  if (!runDir || !path.isAbsolute(runDir)) throw new Error('record requires an absolute --run-dir')
  const { statePath, state } = readRun(runDir)
  const now = new Date().toISOString()
  const phase = flag('--phase') || state.phase
  const status = flag('--status') || state.status
  const message = flag('--message') || ''
  state.phase = phase
  state.status = status
  state.message = message
  state.updatedAt = now
  state.events.push({ at: now, phase, status, message })
  atomicJson(statePath, state)
  print(state, (item) => `${item.status} · ${item.phase}${item.message ? ` · ${item.message}` : ''}`)
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
