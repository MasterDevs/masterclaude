#!/usr/bin/env node

// Fast, model-free regression checks for the state MasterDevs owns in the Codex adapter.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
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

  scenario('relative data overrides fail closed', () => {
    const result = spawnSync(process.execPath, [SCRIPT, 'paths'], {
      cwd: repo,
      env: { ...process.env, MASTERDEVS_DATA_DIR: 'relative-state' },
      encoding: 'utf8',
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /must be an absolute path/)
  })

  console.log(`\n${scenarios.length}/${scenarios.length} Codex state scenarios passed`)
} finally {
  fs.rmSync(scratch, { recursive: true, force: true })
}
