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
    const rosters = `playbook-seeds${path.sep}rosters${path.sep}`
    const seedsOf = (plugin) => filesUnder(path.join(ROOT, 'plugins', plugin, 'playbook-seeds'))
      .map((file) => path.relative(path.join(ROOT, 'plugins', plugin), file))
    const claudeSeeds = seedsOf('masterdevs')
    const codexSeeds = seedsOf('masterdevs-codex')
    const sharedSeeds = (list) => list.filter((relative) => !relative.startsWith(rosters)).sort()

    // Only the rosters may diverge. They name the host's own agents, and asserting byte-identity
    // over them is what once locked Claude's `agentType` and `model` values into the Codex
    // distribution. Pinning the excluded set stops that exclusion from quietly widening and
    // leaving this scenario green while a catalog or lesson really drifted.
    assert.deepEqual(
      claudeSeeds.filter((relative) => relative.startsWith(rosters)).sort(),
      [path.join('playbook-seeds', 'rosters', 'architects.json'),
       path.join('playbook-seeds', 'rosters', 'reviewers.json')],
      'the excluded set changed — confirm it still belongs outside the byte-identity check')

    // Both directions: a seed added to one adapter and forgotten in the other is drift too, and
    // enumerating a single side reads straight past it.
    assert.deepEqual(sharedSeeds(codexSeeds), sharedSeeds(claudeSeeds),
      'a Playbook seed exists in one adapter and not the other')

    // Directories as well as files. filesUnder returns files only, so an empty seed directory is
    // invisible here — yet copyMissing recreates it in every Playbook and bootstrapPlaybook then
    // materializes it as a lane with its own candidates file. Empty means unnoticed, not harmless.
    const dirsOf = (plugin) => {
      const root = path.join(ROOT, 'plugins', plugin, 'playbook-seeds')
      const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) => [path.relative(root, path.join(dir, entry.name)),
          ...walk(path.join(dir, entry.name))])
      return walk(root)
        .filter((relative) => relative !== 'rosters' && !relative.startsWith(`rosters${path.sep}`))
        .sort()
    }
    assert.deepEqual(dirsOf('masterdevs-codex'), dirsOf('masterdevs'),
      'a Playbook seed directory exists in one adapter and not the other')

    const shared = [
      'scripts/playbook.mjs',
      'scripts/preflight.mjs',
      'references/interview.md',
      'references/reporting.md',
      ...sharedSeeds(claudeSeeds),
    ]
    assert.equal(shared.length, 17,
      'the shared list changed size — confirm the new file belongs in it, then update this count')
    for (const relative of shared) {
      const claude = fs.readFileSync(path.join(ROOT, 'plugins/masterdevs', relative))
      const codex = fs.readFileSync(path.join(ROOT, 'plugins/masterdevs-codex', relative))
      assert.deepEqual(codex, claude, `${relative} drifted between adapters`)
    }
  })

  scenario('adapter rosters never share a filename', () => {
    const namesIn = (plugin) =>
      fs.readdirSync(path.join(ROOT, 'plugins', plugin, 'playbook-seeds/rosters')).sort()
    const claude = namesIn('masterdevs')
    const codex = namesIn('masterdevs-codex')
    assert.ok(claude.length > 0 && codex.length > 0, 'an adapter ships no rosters at all')
    // One MASTERDEVS_DATA_DIR can be pointed at by both adapters, and seeds are copied in without
    // overwriting. Distinct filenames are what stop the first adapter to bootstrap from handing the
    // other its host-specific roster.
    const overlap = codex.filter((name) => claude.includes(name))
    assert.deepEqual(overlap, [], `${overlap.join(', ')} would collide in a shared Playbook directory`)
    // The one thing standing between a maintainer and re-shipping the defaults onto the path an
    // earlier build told users to write to. `.defaults` and `.user` say which half of the pair it is.
    for (const name of codex) {
      assert.match(name, /\.codex\.(defaults|user)\.json$/,
        `${name} does not say whether it is the shipped defaults or the user's own roster`)
    }
  })

  scenario('Codex rosters name installed skills and carry no Claude-only fields', () => {
    const rosterDir = path.join(ROOT, 'plugins/masterdevs-codex/playbook-seeds/rosters')
    const files = fs.readdirSync(rosterDir)
    assert.ok(files.length >= 2, 'expected a reviewer roster and an architect roster')
    for (const file of files) {
      const entries = JSON.parse(fs.readFileSync(path.join(rosterDir, file), 'utf8'))
      assert.ok(Array.isArray(entries) && entries.length > 0, `${file} holds no entries`)
      for (const entry of entries) {
        for (const field of ['model', 'agentType', 'reasoningEffort']) {
          assert.ok(!(field in entry), `${file} carries \`${field}\`, which Codex has no per-agent setting for`)
        }
        assert.equal(typeof entry.roleSkill, 'string', `${file} has an entry with no roleSkill`)
        // Naming *a* skill is not enough. masterdevs-engineer also ships an agent definition, so
        // without pinning the role a shipped roster could put a workspace-writing agent into the
        // read-only review panel — the panel runs concurrently with the verifier, which reads the
        // tree. Each roster serves one role, and the filename says which.
        const role = file.startsWith('reviewers.') ? 'masterdevs-reviewer' : 'masterdevs-architect'
        assert.equal(entry.roleSkill, role,
          `${file} names ${entry.roleSkill}; a ${role.replace('masterdevs-', '')} roster must name ${role}`)
        // The docs promise that an entry with no `triggers`, or `lens: "all"`, always runs. A
        // shipped default that asked for a trigger match could therefore never fire at all, and
        // the loop would report a clean review having run no reviewer.
        assert.ok(!('triggers' in entry) || entry.lens === 'all',
          `${file} gives ${entry.name ?? entry.lens} triggers, so a shipped default may never run`)
        const yaml = path.join(ROOT, 'plugins/masterdevs-codex/skills', entry.roleSkill, 'agents/openai.yaml')
        assert.ok(fs.existsSync(yaml),
          `${file} names roleSkill ${entry.roleSkill}, which this plugin does not ship as an invocable skill`)
        // The whole reason these rosters carry no model: the agent definition has nowhere to put one.
        assert.doesNotMatch(fs.readFileSync(yaml, 'utf8'), /^\s*model:/m,
          `${entry.roleSkill} declares a model — reassess whether the roster should carry one too`)
      }
    }
  })

  scenario('every catalog the Codex architect roster names ships as a seed', () => {
    const seeds = path.join(ROOT, 'plugins/masterdevs-codex/playbook-seeds')
    const entries = JSON.parse(fs.readFileSync(path.join(seeds, 'rosters/architects.codex.defaults.json'), 'utf8'))
    const named = new Set(entries.flatMap((entry) => entry.catalogs ?? []))
    assert.ok(named.size > 0, 'the architect roster routes no lens to a catalog')
    for (const catalog of named) {
      assert.ok(fs.existsSync(path.join(seeds, 'patterns', catalog, 'catalog.md')),
        `the architect roster names the ${catalog} catalog, which does not ship`)
    }
  })

  // Codex-only by design: the Claude adapter's roster contract is enforced by its own workflow, and
  // its shipped reviewers.json is reached through a workflow argument rather than a skill mention.
  scenario('Codex skills read exactly the roster files that ship', () => {
    const shipped = fs.readdirSync(path.join(ROOT, 'plugins/masterdevs-codex/playbook-seeds/rosters'))
    // Spelled out per skill. A total count is too slack to be worth anything: with a floor, deleting
    // the architect roster's only consumer — the very gap this adapter shipped with — costs nothing,
    // and so does dropping the user half of the reviewer panel.
    const expected = {
      'masterdevs-plan': ['architects.codex.defaults.json'],
      'masterdevs-review': ['reviewers.codex.defaults.json', 'reviewers.codex.user.json'],
      'masterdevs-roster': ['reviewers.codex.defaults.json', 'reviewers.codex.user.json'],
      'masterdevs-feature': ['reviewers.codex.defaults.json', 'reviewers.codex.user.json'],
    }
    const found = {}
    // Every markdown file, not just SKILL.md: the feature loop's reference doc is where the user
    // roster is actually consumed, and scanning only SKILL.md left that consumer unnamed.
    for (const file of filesUnder(path.join(ROOT, 'plugins/masterdevs-codex/skills'))) {
      if (!file.endsWith('.md')) continue
      // Deliberately not anchored on `playbook/`: the sibling Claude skills spell this
      // `$PLAYBOOK_DIR/rosters/...`, so a copy-paste from there must not slip past this check.
      const names = [...fs.readFileSync(file, 'utf8').matchAll(/rosters\/([\w.-]+\.json)/g)]
        .map(([, name]) => name)
      if (!names.length) continue
      const skill = path.relative(path.join(ROOT, 'plugins/masterdevs-codex/skills'), file)
        .split(path.sep)[0]
      found[skill] = [...new Set([...(found[skill] ?? []), ...names])].sort()
    }
    assert.deepEqual(found, expected,
      "a skill's set of named roster files changed — update `expected` if that was intended")

    // A `.user.json` belongs to the user and is absent until they add one, but its shipped
    // defaults must exist — that pairing is what makes the defaults load at all.
    const defaultsFor = (name) =>
      name.endsWith('.user.json') ? name.replace('.user.json', '.defaults.json') : name
    const named = new Set()
    for (const names of Object.values(found)) {
      for (const name of names) {
        const base = defaultsFor(name)
        assert.ok(shipped.includes(base), `${name} is named, but no seed ships ${base}`)
        named.add(base)
      }
    }
    // A `.user.json` path belongs to the user. Shipping one as a seed would pre-empt the file the
    // roster skill tells them to create, and copyMissing would then never let theirs land.
    for (const name of shipped) {
      assert.ok(!name.endsWith('.user.json'),
        `${name} ships as a seed, but that path belongs to the user's own roster`)
    }
    // And the reverse. A roster that ships with nothing reading it is this adapter's original
    // defect — the architect roster sat unused because only one direction was ever checked.
    for (const name of shipped) {
      assert.ok(named.has(name), `${name} ships but no skill names it`)
    }
  })

  scenario('the roster docs point writes and prohibitions at the right half of the pair', () => {
    const read = (skill, name = 'SKILL.md') =>
      fs.readFileSync(path.join(ROOT, 'plugins/masterdevs-codex/skills', skill, name), 'utf8')
    // Naming both files is not enough — which one a user writes to and which one they must leave
    // alone is the entire contract. Getting these backwards is how the shipped default came to be
    // the file users were told to edit, so that it never loaded.
    const roster = read('masterdevs-roster')
    const store = roster.match(/Store user reviewers in `playbook\/rosters\/([\w.-]+\.json)`/)
    const protect = roster.match(/never edit the shipped `playbook\/rosters\/([\w.-]+\.json)`/)
    assert.ok(store, 'the roster skill no longer says where to store user reviewers')
    assert.ok(protect, 'the roster skill no longer says which file must not be edited')
    assert.match(store[1], /\.user\.json$/, `user reviewers are sent to ${store[1]}`)
    assert.match(protect[1], /\.defaults\.json$/, `${protect[1]} is protected instead of the defaults`)

    const review = read('masterdevs-review')
    const defaults = review.match(/shipped defaults in `playbook\/rosters\/([\w.-]+\.json)`/)
    assert.ok(defaults, 'the review skill no longer says where the shipped defaults come from')
    assert.match(defaults[1], /\.defaults\.json$/, `the panel loads defaults from ${defaults[1]}`)
  })

  scenario('no Codex skill documents a roster field this runtime lacks', () => {
    for (const file of filesUnder(path.join(ROOT, 'plugins/masterdevs-codex/skills'))) {
      if (!file.endsWith('.md')) continue
      const text = fs.readFileSync(file, 'utf8')
      const where = path.relative(ROOT, file)
      // The shipped rosters are checked above, but this is where a user is *told* what to write.
      // Documenting a field the runtime has no setting for puts the bug back through their file.
      for (const field of ['model', 'agentType', 'reasoningEffort']) {
        // Quoted at all, or bare in a key position. No colon is required on the quoted form: the
        // sibling Claude skill documents these as "- `model` — `sonnet | opus | fable`", and that
        // bullet is the copy-paste source of the original defect. `model` is an ordinary English
        // word, so the bare form still needs a key position or "the mental model:" would trip it.
        assert.doesNotMatch(text, new RegExp(
          `['"\x60]${field}['"\x60]|^\\s*(?:[-*]\\s*)?${field}\\s*:`, 'm'),
          `${where} documents a roster \`${field}\` field, which Codex sets per session, not per agent`)
      }
    }
  })

  // Both adapters can be pointed at one Playbook, and the Claude adapter stamps a plain
  // SEED_VERSION taken from a VERSION file byte-identical to ours. A shared stamp therefore reads
  // as "already current" and skips the copy entirely, so the Codex rosters never arrive and the
  // review panel and lens routing silently fall back to bare defaults.
  scenario('a Playbook another adapter already stamped still receives the Codex seeds', () => {
    const shared = path.join(scratch, 'shared-state')
    const playbookDir = path.join(shared, 'playbook')
    fs.cpSync(path.join(ROOT, 'plugins/masterdevs/playbook-seeds'), playbookDir, { recursive: true })
    fs.writeFileSync(
      path.join(playbookDir, 'SEED_VERSION'),
      fs.readFileSync(path.join(playbookDir, 'VERSION'), 'utf8'),
    )

    const result = spawnSync(process.execPath, [SCRIPT, 'paths', '--json'],
      { cwd: repo, env: { ...process.env, MASTERDEVS_DATA_DIR: shared }, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)

    for (const roster of ['reviewers.codex.defaults.json', 'architects.codex.defaults.json']) {
      assert.ok(fs.existsSync(path.join(playbookDir, 'rosters', roster)),
        `${roster} never installed into a Playbook another adapter had already stamped`)
    }
    // The other adapter's own files are left exactly as they were.
    assert.ok(fs.existsSync(path.join(playbookDir, 'rosters', 'reviewers.json')),
      "the Claude adapter's roster was disturbed")
  })

  scenario('paths bootstrap a writable Playbook from shipped seeds', () => {
    const paths = invoke('paths', '--json')
    assert.equal(paths.repoRoot, fs.realpathSync(repo))
    assert.equal(paths.dataDir, dataDir)
    assert.equal(paths.playbookDir, path.join(dataDir, 'playbook'))
    assert.ok(fs.existsSync(path.join(paths.playbookDir, 'SEED_VERSION.codex')),
      'the seed release was not stamped under a name belonging to this adapter alone')
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
    fs.writeFileSync(path.join(playbookDir, 'SEED_VERSION.codex'), 'an-older-release\n')

    invoke('paths', '--json')

    assert.ok(fs.existsSync(dropped), 'a missing seed file was not restored')
    assert.equal(fs.readFileSync(edited, 'utf8'), learned, 'a promoted entry was overwritten by a seed')
    assert.equal(
      fs.readFileSync(path.join(playbookDir, 'SEED_VERSION.codex'), 'utf8').trim(),
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
      {
        cwd: repo,
        env: { ...env, MASTERDEVS_LOCK_STALE_MS: '500', MASTERDEVS_LOCK_TIMEOUT_MS: '2000' },
        encoding: 'utf8',
      },
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

  // The default path sits under a shared temp directory and is guessable, so it is ours to keep tight.
  scenario('a state directory we chose is kept private to its owner', () => {
    const bare = { ...process.env }
    delete bare.MASTERDEVS_DATA_DIR
    const result = spawnSync(process.execPath, [SCRIPT, 'paths', '--json'], { cwd: repo, env: bare, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const chosen = JSON.parse(result.stdout).dataDir
    assert.ok(chosen.startsWith(fs.realpathSync(os.tmpdir())) || chosen.startsWith(os.tmpdir()), chosen)
    assert.match(path.basename(path.dirname(chosen)), /^masterdevs-/)
    fs.chmodSync(chosen, 0o755)
    spawnSync(process.execPath, [SCRIPT, 'paths', '--json'], { cwd: repo, env: bare, encoding: 'utf8' })
    assert.equal(fs.statSync(chosen).mode & 0o777, 0o700, 'a directory we chose was left loose')
    fs.rmSync(chosen, { recursive: true, force: true })
  })

  // MASTERDEVS_DATA_DIR is the user's own decision — docs/CODEX.md tells them to pick one — so it is
  // reported, not quietly rewritten, and a directory another user owns is not refused outright.
  scenario('a state directory the user chose is reported, not rewritten', () => {
    fs.chmodSync(dataDir, 0o755)
    const result = spawnSync(process.execPath, [SCRIPT, 'paths', '--json'], { cwd: repo, env, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(fs.statSync(dataDir).mode & 0o777, 0o755, 'the user\'s own directory was chmod-ed')
    assert.match(result.stderr, /reachable beyond its owner/)
    fs.chmodSync(dataDir, 0o700)
  })

  scenario('a Playbook path of the wrong kind names itself', () => {
    const playbookDir = invoke('paths', '--json').playbookDir
    const lane = path.join(playbookDir, 'patterns', 'core')
    fs.rmSync(lane, { recursive: true, force: true })
    fs.writeFileSync(lane, 'a file where a directory belongs\n')
    fs.writeFileSync(path.join(playbookDir, 'SEED_VERSION.codex'), 'an-older-release\n')
    const result = spawnSync(process.execPath, [SCRIPT, 'paths'], { cwd: repo, env, encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /needs a directory/)
    assert.match(result.stderr, /patterns/)
    fs.rmSync(lane, { force: true })
    invoke('paths', '--json')
  })

  // A waiter that gives up before it may break a stale lock can never recover from a killed holder,
  // so the timeout is floored above the stale window rather than only documented as being above it.
  scenario('a timeout set below the stale window still recovers a lock', () => {
    const lockPath = path.join(initialized.runDir, 'run.lock')
    // Fresh on purpose: a dead holder whose lock has not yet aged into staleness is the only case
    // where the give-up time matters. Backdate it and the stale break fires before any deadline.
    fs.writeFileSync(lockPath, '999999\n')
    const result = spawnSync(
      process.execPath,
      [SCRIPT, 'record', '--run-dir', initialized.runDir, '--status', 'floored', '--json'],
      {
        cwd: repo,
        // Inverted on purpose: a 10ms give-up against a 2s staleness rule.
        env: { ...env, MASTERDEVS_LOCK_STALE_MS: '2000', MASTERDEVS_LOCK_TIMEOUT_MS: '10' },
        encoding: 'utf8',
        timeout: 20000,
      },
    )
    assert.equal(result.status, 0, result.stderr || 'record gave up before it could break the lock')
    assert.equal(JSON.parse(result.stdout).status, 'floored')
  })

  // The timeout is floored at twice the stale window, so an unbounded staleness value would push the
  // give-up time past any reachable clock — the same never-terminating wait, through another door.
  scenario('an unbounded stale window falls back instead of spinning', () => {
    const lockPath = path.join(initialized.runDir, 'run.lock')
    fs.writeFileSync(lockPath, '999999\n')
    const longAgo = new Date(Date.now() - 3600000)
    fs.utimesSync(lockPath, longAgo, longAgo)
    const result = spawnSync(
      process.execPath,
      [SCRIPT, 'record', '--run-dir', initialized.runDir, '--status', 'clamped', '--json'],
      {
        cwd: repo,
        env: { ...env, MASTERDEVS_LOCK_STALE_MS: '1e308' },
        encoding: 'utf8',
        timeout: 15000,
      },
    )
    assert.equal(result.status, 0, result.stderr || 'record never finished')
    assert.equal(JSON.parse(result.stdout).status, 'clamped')
  })

  // A non-numeric window used to become NaN, and every deadline comparison against NaN is false, so
  // the wait loop spun forever instead of timing out.
  scenario('a nonsense lock window falls back instead of spinning', () => {
    // Needs a lock to actually wait on: NaN makes the staleness test and every deadline comparison
    // false, so the loop neither breaks the lock nor ever gives up.
    const lockPath = path.join(initialized.runDir, 'run.lock')
    fs.writeFileSync(lockPath, '999999\n')
    const longAgo = new Date(Date.now() - 3600000)
    fs.utimesSync(lockPath, longAgo, longAgo)
    const result = spawnSync(
      process.execPath,
      [SCRIPT, 'record', '--run-dir', initialized.runDir, '--status', 'bounded', '--json'],
      {
        cwd: repo,
        env: { ...env, MASTERDEVS_LOCK_STALE_MS: 'abc', MASTERDEVS_LOCK_TIMEOUT_MS: 'nonsense' },
        encoding: 'utf8',
        timeout: 20000,
      },
    )
    assert.equal(result.status, 0, result.stderr || 'record did not finish')
    assert.equal(JSON.parse(result.stdout).status, 'bounded')
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
