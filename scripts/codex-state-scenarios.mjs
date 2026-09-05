#!/usr/bin/env node

// Fast, model-free regression checks for the state MasterDevs owns in the Codex adapter.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(ROOT, 'plugins/masterdevs-codex/scripts/codex-state.mjs')
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'masterdevs-codex-state-'))
const repo = path.join(scratch, 'example-repo')
const dataDir = path.join(scratch, 'state')
const env = { ...process.env, MASTERDEVS_DATA_DIR: dataDir }

function git(...args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim()
}

function invokeAt(cwd, ...args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    env,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return args.includes('--json') ? JSON.parse(result.stdout) : result.stdout.trim()
}

function invoke(...args) {
  return invokeAt(repo, ...args)
}

const scenarios = []
function scenario(name, check) {
  check()
  scenarios.push(name)
  console.log(`✓ ${name}`)
}

async function scenarioAsync(name, check) {
  await check()
  scenarios.push(name)
  console.log(`✓ ${name}`)
}

function recordInBackground(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: repo, env, stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exited ${code}`))))
  })
}

function filesUnder(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(root, entry.name)
    return entry.isDirectory() ? filesUnder(child) : [child]
  })
}

try {
  fs.mkdirSync(repo, { recursive: true })
  git('init', '--quiet')

  scenario('shared protocols and Playbook assets stay byte-identical', () => {
    const shared = [
      'scripts/playbook.mjs',
      'scripts/preflight.mjs',
      'references/interview.md',
      'references/reporting.md',
      ...filesUnder(path.join(ROOT, 'plugins/masterdevs/playbook-seeds'))
        .map((file) => path.relative(path.join(ROOT, 'plugins/masterdevs'), file)),
    ]
    for (const relative of shared) {
      const claude = fs.readFileSync(path.join(ROOT, 'plugins/masterdevs', relative))
      const codex = fs.readFileSync(path.join(ROOT, 'plugins/masterdevs-codex', relative))
      assert.deepEqual(codex, claude, `${relative} drifted between adapters`)
    }
  })

  scenario('paths bootstrap a writable Playbook from shipped seeds', () => {
    const paths = invoke('paths', '--json')
    assert.equal(paths.repoRoot, fs.realpathSync(repo))
    assert.equal(paths.dataDir, dataDir)
    assert.equal(paths.playbookDir, path.join(dataDir, 'playbook'))
    assert.ok(fs.existsSync(path.join(paths.playbookDir, 'SEED_VERSION')))
    assert.ok(fs.existsSync(path.join(paths.playbookDir, 'patterns/core/candidates.md')))
    assert.ok(fs.existsSync(path.join(paths.playbookDir, 'lessons/security.candidates.md')))
  })

  scenario('linked worktrees share a Playbook but isolate resumable runs', () => {
    git('config', 'user.email', 'state-test@example.invalid')
    git('config', 'user.name', 'State Test')
    git('config', 'commit.gpgsign', 'false')
    fs.writeFileSync(path.join(repo, 'README.md'), '# fixture\n')
    git('add', 'README.md')
    git('commit', '--quiet', '-m', 'fixture')
    const sibling = path.join(scratch, 'sibling-worktree')
    git('worktree', 'add', '--quiet', '-b', 'sibling-test', sibling)
    const primaryPaths = invoke('paths', '--json')
    const siblingPaths = invokeAt(sibling, 'paths', '--json')
    assert.equal(siblingPaths.dataDir, primaryPaths.dataDir)
    assert.equal(siblingPaths.playbookDir, primaryPaths.playbookDir)
    assert.notEqual(siblingPaths.runsDir, primaryPaths.runsDir)
  })

  const initialized = invoke('init', '--json')

  scenario('init creates provider-owned run state with portable artifact paths', () => {
    assert.equal(initialized.adapter, 'codex-native')
    assert.equal(initialized.status, 'planning')
    assert.equal(initialized.phase, 'Interview')
    assert.ok(path.isAbsolute(initialized.runDir))
    assert.equal(initialized.requirementsPath, path.join(initialized.runDir, 'requirements.md'))
    assert.ok(fs.existsSync(path.join(initialized.runDir, 'run.json')))
    assert.equal(initialized.events.length, 1)
  })

  scenario('record atomically advances a run and appends an event', () => {
    const updated = invoke(
      'record', '--run-dir', initialized.runDir,
      '--phase', 'Verify', '--status', 'running', '--message', 'Running scoped checks', '--json',
    )
    assert.equal(updated.phase, 'Verify')
    assert.equal(updated.status, 'running')
    assert.equal(updated.message, 'Running scoped checks')
    assert.equal(updated.events.length, 2)
    const stored = JSON.parse(fs.readFileSync(path.join(initialized.runDir, 'run.json'), 'utf8'))
    assert.deepEqual(stored, updated)
  })

  scenario('latest filters runs by status', () => {
    const latest = invoke('latest', '--status', 'running', '--json')
    assert.equal(latest.runId, initialized.runId)
    const absent = invoke('latest', '--status', 'completed', '--json')
    assert.equal(absent, null)
  })

  scenario('status resolves a specific run without host-session internals', () => {
    const status = invoke('status', '--run-id', initialized.runId, '--json')
    assert.equal(status.runId, initialized.runId)
    assert.equal(status.phase, 'Verify')
    assert.equal(status.events.length, 2)
  })

  // `git rev-parse --git-common-dir` answers relative to the current directory, so a subdirectory used
  // to resolve to the PARENT of the repository — moving the Playbook and orphaning a resumable run.
  scenario('run identity does not move with the working directory', () => {
    const nested = path.join(repo, 'nested', 'deeper')
    fs.mkdirSync(nested, { recursive: true })
    const fromRoot = invoke('paths', '--json')
    const fromNested = invokeAt(nested, 'paths', '--json')
    assert.equal(fromNested.repositorySlug, path.basename(repo))
    assert.equal(fromNested.gitCommonDir, fromRoot.gitCommonDir)
    assert.equal(fromNested.runsDir, fromRoot.runsDir)
    assert.equal(fromNested.playbookDir, fromRoot.playbookDir)
  })

  scenario('an omitted --message keeps the stored one, and an empty one clears it', () => {
    const kept = invoke('record', '--run-dir', initialized.runDir, '--status', 'reviewing', '--json')
    assert.equal(kept.status, 'reviewing')
    assert.equal(kept.message, 'Running scoped checks')
    const cleared = invoke('record', '--run-dir', initialized.runDir, '--message', '', '--json')
    assert.equal(cleared.message, '')
    assert.equal(cleared.status, 'reviewing')
  })

  scenario('a flag value that is really another flag is rejected', () => {
    const result = spawnSync(
      process.execPath,
      [SCRIPT, 'record', '--run-dir', initialized.runDir, '--status', '--json'],
      { cwd: repo, env, encoding: 'utf8' },
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /--status requires a value/)
  })

  scenario('record refuses a run directory outside this repository', () => {
    const foreign = path.join(scratch, 'foreign-run')
    fs.mkdirSync(foreign, { recursive: true })
    const before = { phase: 'Plan', status: 'untouched', message: 'not ours', events: [] }
    fs.writeFileSync(path.join(foreign, 'run.json'), JSON.stringify(before))
    const result = spawnSync(
      process.execPath,
      [SCRIPT, 'record', '--run-dir', foreign, '--status', 'hijacked'],
      { cwd: repo, env, encoding: 'utf8' },
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /must be inside/)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(foreign, 'run.json'), 'utf8')), before)
  })

  scenario('one unreadable run does not hide the others', () => {
    const broken = path.join(invoke('paths', '--json').runsDir, '20200101T000000Z-dead')
    fs.mkdirSync(broken, { recursive: true })
    fs.writeFileSync(path.join(broken, 'run.json'), '{ not json at all')
    const found = invoke('status', '--run-id', initialized.runId, '--json')
    assert.equal(found.runId, initialized.runId)
    assert.equal(invoke('latest', '--json').runId, initialized.runId)
    fs.rmSync(broken, { recursive: true, force: true })
  })

  scenario('a newer seed release fills gaps without overwriting what a run has learned', () => {
    const playbookDir = invoke('paths', '--json').playbookDir
    const edited = path.join(playbookDir, 'patterns/core/catalog.md')
    const learned = '# a run promoted this\n'
    fs.writeFileSync(edited, learned)
    const dropped = path.join(playbookDir, 'lessons/security.md')
    fs.rmSync(dropped)
    fs.writeFileSync(path.join(playbookDir, 'SEED_VERSION'), 'an-older-release\n')

    invoke('paths', '--json')

    assert.ok(fs.existsSync(dropped), 'a missing seed file was not restored')
    assert.equal(fs.readFileSync(edited, 'utf8'), learned, 'a promoted entry was overwritten by a seed')
    assert.equal(
      fs.readFileSync(path.join(playbookDir, 'SEED_VERSION'), 'utf8').trim(),
      fs.readFileSync(path.join(ROOT, 'plugins/masterdevs-codex/playbook-seeds/VERSION'), 'utf8').trim(),
    )
  })

  // path.resolve normalizes "..", it does not follow a symlink, so a prefix check on unresolved paths
  // let a link planted inside the runs directory point anywhere on the filesystem.
  scenario('record refuses a symlink pointing out of the runs directory', () => {
    const runsDir = invoke('paths', '--json').runsDir
    const outside = path.join(scratch, 'outside-run')
    fs.mkdirSync(outside, { recursive: true })
    const before = { phase: 'Plan', status: 'untouched', message: 'not ours', events: [] }
    fs.writeFileSync(path.join(outside, 'run.json'), JSON.stringify(before))
    const link = path.join(runsDir, 'escape')
    fs.symlinkSync(outside, link)
    const result = spawnSync(
      process.execPath,
      [SCRIPT, 'record', '--run-dir', link, '--status', 'hijacked'],
      { cwd: repo, env, encoding: 'utf8' },
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /must be inside/)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outside, 'run.json'), 'utf8')), before)
    fs.unlinkSync(link)
  })

  scenario('a lock left behind by a killed process is broken, not waited on', () => {
    const lockPath = path.join(initialized.runDir, 'run.lock')
    fs.writeFileSync(lockPath, '999999\n')
    const longAgo = new Date(Date.now() - 3600000)
    fs.utimesSync(lockPath, longAgo, longAgo)
    // A short timeout so a regression fails in seconds rather than sitting out the full minute.
    const result = spawnSync(
      process.execPath,
      [SCRIPT, 'record', '--run-dir', initialized.runDir, '--status', 'resumed', '--json'],
      { cwd: repo, env: { ...env, MASTERDEVS_LOCK_TIMEOUT_MS: '2000' }, encoding: 'utf8' },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).status, 'resumed')
    assert.ok(!fs.existsSync(lockPath), 'the lock outlived the command that took it')
  })

  scenario('a value that starts with -- can still be passed as --flag=value', () => {
    const updated = invoke('record', '--run-dir', initialized.runDir, '--message=--fast path taken', '--json')
    assert.equal(updated.message, '--fast path taken')
  })

  scenario('running outside a git repository says so', () => {
    const result = spawnSync(process.execPath, [SCRIPT, 'paths'], { cwd: scratch, env, encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /not inside a git repository/)
  })

  scenario('the state directory is kept private to its owner', () => {
    fs.chmodSync(dataDir, 0o777)
    invoke('paths', '--json')
    assert.equal(fs.statSync(dataDir).mode & 0o777, 0o700)
  })

  scenario('a Playbook path of the wrong kind names itself', () => {
    const playbookDir = invoke('paths', '--json').playbookDir
    const lane = path.join(playbookDir, 'patterns', 'core')
    fs.rmSync(lane, { recursive: true, force: true })
    fs.writeFileSync(lane, 'a file where a directory belongs\n')
    fs.writeFileSync(path.join(playbookDir, 'SEED_VERSION'), 'an-older-release\n')
    const result = spawnSync(process.execPath, [SCRIPT, 'paths'], { cwd: repo, env, encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /needs a directory/)
    assert.match(result.stderr, /patterns/)
    fs.rmSync(lane, { force: true })
    invoke('paths', '--json')
  })

  scenario('relative data overrides fail closed', () => {
    const result = spawnSync(process.execPath, [SCRIPT, 'paths'], {
      cwd: repo,
      env: { ...process.env, MASTERDEVS_DATA_DIR: 'relative-state' },
      encoding: 'utf8',
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /must be an absolute path/)
  })

  // Verify and Review run at the same time and both record. A rename keeps run.json from being torn
  // in half; it does not keep the second writer from overwriting the first one's event.
  await scenarioAsync('phases recording in parallel do not lose each other\'s events', async () => {
    const statePath = path.join(initialized.runDir, 'run.json')
    const before = JSON.parse(fs.readFileSync(statePath, 'utf8')).events.length
    const phases = ['Verify', 'Review', 'Implement', 'Refactor', 'Iterate', 'Polish']
    await Promise.all(phases.map((phase) => recordInBackground(
      'record', '--run-dir', initialized.runDir, '--phase', phase, '--message', `${phase} recorded`,
    )))
    const after = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    assert.equal(after.events.length, before + phases.length, 'a concurrent record was lost')
    const recorded = new Set(after.events.map((event) => event.phase))
    for (const phase of phases) assert.ok(recorded.has(phase), `${phase} never reached run.json`)
  })

  console.log(`\n${scenarios.length}/${scenarios.length} Codex state scenarios passed`)
} finally {
  fs.rmSync(scratch, { recursive: true, force: true })
}
