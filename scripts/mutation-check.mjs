#!/usr/bin/env node
// Do the scenario suites actually catch anything?
//
// Deliberately breaks a source file one way at a time and checks its suite goes red. A scenario suite
// can be green and worthless: an earlier version of this one passed 12/12 while missing the round cap —
// the single most important behavior it claimed to protect — because it asserted on a downstream
// symptom instead of the mechanism.
//
//   node scripts/mutation-check.mjs
//
// Every mutation must be caught. A MISSED result means the scenario covering it is testing the wrong
// thing. The source file is restored on the way out, including after a crash.
//
// Add a mutation here whenever you add a behavior worth protecting — it is the only check on whether
// the scenario you wrote alongside it does anything.

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOOP_SRC = path.join(ROOT, 'plugins/masterdevs/workflows/feature-loop.js')
const STATE_SRC = path.join(ROOT, 'plugins/masterdevs-codex/scripts/codex-state.mjs')

// [description, find, replace] — each reintroduces a bug this design exists to prevent.
const MUTATIONS = [
  ['round cap 2 -> 5 (re-introduce the churn)',
    'const MAX_ITERATIONS = 2', 'const MAX_ITERATIONS = 5'],
  ['merge mustFix and polish (nits buy rounds again)',
    'revisions = iter.mustFix || []', 'revisions = [...(iter.mustFix||[]), ...(iter.polish||[])]'],
  ['verify-fix cap 2 -> 6',
    'const MAX_VERIFY_FIX = 2', 'const MAX_VERIFY_FIX = 6'],
  ['stop obeying the conflict break',
    "if (conflicts.length) { log(`${conflicts.length} plan-conflict(s) — stopping for the user`); break }",
    "if (conflicts.length) { log('conflict') }"],
  ['let the Iterate agent prolong the loop',
    "if (iter.decision !== 'continue') break", 'if (false) break'],
  ['drop the no-work exit',
    'if (!revisions.length && !hasBlocking && verifyPassed) break', 'if (false) break'],
  ['make an escalation halt the run',
    "if (impl.status === 'blocked') {", "if (impl.status === 'blocked' || (impl.escalations||[]).length) {"],
  ['ship post-verify fixes unreviewed',
    'if (reviewStale && verifyPassed && !conflicts.length) {', 'if (false) {'],
  ['run the verify-fix INSIDE the parallel block (concurrency hazard)',
    'while (verify && !verify.passed && !(verify.impossible || []).length && vAttempt < MAX_VERIFY_FIX) {',
    'while (false && verify && !verify.passed && vAttempt < MAX_VERIFY_FIX) {'],
  ['always claim verify passed',
    'verifyPassed = !!(verify && verify.passed)', 'verifyPassed = true'],
  ['stop collecting punts/escalations',
    '  if (r.punted) punted.push(...r.punted)', '  if (false) punted.push(...r.punted)'],
  ['let an escalation alone fail the run (labels a clean run as needing you)',
    'outcome: (verifyPassed && unresolvedBlocking.length === 0 && conflicts.length === 0\n    && impossibleCriteria.length === 0)',
    'outcome: (verifyPassed && unresolvedBlocking.length === 0 && conflicts.length === 0\n    && impossibleCriteria.length === 0 && escalations.length === 0)'],
  ['stop letting a conflict fail the run',
    'outcome: (verifyPassed && unresolvedBlocking.length === 0 && conflicts.length === 0\n    && impossibleCriteria.length === 0)',
    'outcome: (verifyPassed && unresolvedBlocking.length === 0\n    && impossibleCriteria.length === 0)'],
  ['stop telling verify what it already learned (back to re-deriving every pass)',
    'const verifyMemory = !verifyLogPath ? `` :', 'const verifyMemory = true ? `` :'],
  ['let verify explore without bound (the retry cliff)',
    '`**Do not go exploring.** If the notes tell you how to run something, run it. If they do not, work it out\\n` +',
    '`Explore as much as you like.\\n` +'],
  ['re-verify inherits the full first-pass scope again',
    "`${attempt > 0 && fixed && fixed.length ? fixScope(fixed) : verifyScope} `", '`${verifyScope} `'],
  ['stop telling the re-verify which failures were just fixed',
    'verifyPrompt(vAttempt, justFixed)', 'verifyPrompt(vAttempt, [])'],
  // The craft standards moved into engineer.md, so the way to break them is to gut that file or to
  // stop routing the call through the engineer at all. Both must fail the suite.
  ['delete the craft standards from engineer.md (agent-file half of the contract)',
    "agentType: 'masterdevs:engineer', model: 'opus', schema: IMPLEMENT_SCHEMA,",
    "agentType: 'general-purpose', model: 'opus', schema: IMPLEMENT_SCHEMA,"],
  ['LOOSEN schema: reuse is no longer a required plan answer',
    "required: ['title', 'intent', 'files', 'acceptance', 'reuse'],",
    "required: ['title', 'intent', 'files', 'acceptance'],"],
  ["hide the plan's reuse targets from the engineer",
    "  `   reuse: ${(s.reuse || []).join(' | ') || '—'}\\n   acceptance:", '  `   acceptance:'],
  ['confine the refactor search to the feature again',
    '`**Hunt duplication across the WHOLE codebase, not just this feature.** A duplicate you only look ` +',
    '`**Hunt duplication inside the changed files.** A duplicate you only look ` +'],
  ['let the refactor edit anywhere it looked',
    '`**Read anywhere; edit narrowly.**\\n` +', '`Change whatever you find.\\n` +'],
  ['skip the success-criteria check entirely',
    "      { label: 'check-criteria', phase: 'Plan', schema: CRITERIA_CHECK_SCHEMA,",
    "      { label: 'check-criteria-DISABLED', phase: 'Plan', schema: CRITERIA_CHECK_SCHEMA,"],
  ['let contradictory criteria through to the build',
    'if (blockingCriteria.length) {', 'if (false) {'],
  ['treat an unverifiable criterion as a blocker too (halts every prod-data feature)',
    "const CRITERIA_BLOCKING = new Set(['contradiction', 'unreachable-target'])",
    "const CRITERIA_BLOCKING = new Set(['contradiction', 'unreachable-target', 'unverifiable'])"],
  ['send a fix agent at an unreachable target anyway',
    "while (verify && !verify.passed && !(verify.impossible || []).length && vAttempt < MAX_VERIFY_FIX) {",
    'while (verify && !verify.passed && vAttempt < MAX_VERIFY_FIX) {'],
  ['let an unreachable target buy another full round',
    'if (impossibleCriteria.length) break', 'if (false) break'],
  ['drop the impossible criteria before the user sees them',
    '  impossibleCriteria,         //', '  impossibleCriteria: [],     //'],
  ['LOOSEN schema: Verify can no longer distinguish unfixable from failing',
    "    impossible: { type: 'array', items: {\n      type: 'object', additionalProperties: false, required: ['criterion', 'why'],",
    "    impossible: { type: 'array', items: {\n      type: 'object', additionalProperties: false, required: [],"],
  ['skip the plan fact-check entirely',
    'while (plan.claims && plan.claims.length) {', 'while (false) {'],
  ['let a refuted claim through without revising the plan',
    'if (!refuted.length || planRevisions >= MAX_PLAN_REVISIONS) break', 'break'],
  ['plan revision cap 1 -> 5 (spin the phase the user is waiting in)',
    'const MAX_PLAN_REVISIONS = 1', 'const MAX_PLAN_REVISIONS = 5'],
  ['swallow the claim verdicts instead of showing them at the gate',
    '    claimChecks,\n', '    claimChecks: null,\n'],
  ['ignore the user-named verification data',
    'The user named it: "${intent.verifyOn}". Honor that.', 'Pick any data you like.'],
  ['LOOSEN schema: the plan no longer has to state its claims',
    "required: ['summary', 'steps', 'lenses', 'claims'],", "required: ['summary', 'steps', 'lenses'],"],
  ['LOOSEN schema: a claim needs no check to settle it',
    "required: ['claim', 'check', 'ifWrong'],", "required: ['claim'],"],
  ['LOOSEN schema: verification need not say what data proves it',
    "required: ['approach', 'dataSource', 'riskySteps'],", "required: ['approach', 'riskySteps'],"],
  ['ignore the confirmed intent in Refine',
    'const intent = input.intent || null', 'const intent = null'],
  ['drop the soWhat rule from the reviewer prompt',
    'SO_WHAT_RULE + readOnlyRule', 'readOnlyRule'],
  ['LOOSEN schema: soWhat no longer required on findings',
    "'summary', 'fix', 'soWhat'],", "'summary', 'fix'],"],
  ['LOOSEN schema: escalations lose soWhat',
    "required: ['issue', 'why', 'soWhat'],", "required: ['issue', 'why'],"],
]

// The Codex run store keeps state a user can lose. Each of these was a real finding.
const STATE_MUTATIONS = [
  ['git-common-dir resolved from the current directory again (run identity moves with cwd)',
    "git(repoRoot, 'rev-parse', '--git-common-dir')", "git(process.cwd(), 'rev-parse', '--git-common-dir')"],
  ['record drops the lock (parallel phases overwrite each other)',
    "const updated = withLock(path.join(runDir, 'run.lock'), () => {", 'const updated = ((fn) => fn())(() => {'],
  ['a stale lock is never broken (a killed process wedges the run)',
    'if (Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS) {', 'if (false) {'],
  ['an omitted --message wipes the stored one',
    "const message = flag('--message') ?? state.message ?? ''", "const message = flag('--message') || ''"],
  ['flag() takes the next flag as a value',
    'if (value === undefined || /^--./.test(value)) {', 'if (value === undefined) {'],
  ['the --flag=value escape is removed',
    'const inline = argv.find((token) => token.startsWith(`${name}=`))',
    'const inline = undefined || argv.find((token) => false && token.startsWith(`${name}=`))'],
  ['--run-dir scoping removed (any run.json on disk can be rewritten)',
    'if (runDir !== runsRoot && !runDir.startsWith(runsRoot + path.sep)) {', 'if (false) {'],
  ['--run-dir compared without resolving symlinks',
    'runDir = fs.realpathSync(requested)', 'runDir = path.resolve(requested)'],
  ['one corrupt run.json breaks every listing',
    'try { runs.push(readRun(path.join(root, entry.name)).state) } catch { continue }',
    'runs.push(readRun(path.join(root, entry.name)).state)'],
  ['a seed overwrites a Playbook file the run has already edited',
    '} else if (!existing) {', '} else if (true) {'],
  ['seed upgrades gated on the directory existing (a new lane never arrives)',
    'if (installed !== seedVersion) {', 'if (!fs.existsSync(playbookDir)) {'],
  ['a Playbook path of the wrong kind fails without naming itself',
    'throw new Error(`${to} is a file where the Playbook needs a directory — move it aside`)', 'void 0'],
  ['a state directory we chose is left readable by everyone',
    'if (loose) fs.chmodSync(dir, 0o700)', 'if (false) fs.chmodSync(dir, 0o700)'],
  ['the user\'s own state directory is chmod-ed behind their back',
    'if (chosenByUs) {', 'if (true) {'],
  ['the timeout is no longer floored above the stale window (a killed holder strands the run)',
    'duration(process.env.MASTERDEVS_LOCK_TIMEOUT_MS, 60000),\n  LOCK_STALE_MS * 2,',
    'duration(process.env.MASTERDEVS_LOCK_TIMEOUT_MS, 60000),\n  0,'],
  ['an unbounded lock window is accepted again (the give-up time becomes unreachable)',
    'parsed > 0 && parsed <= MAX_LOCK_WINDOW_MS ? parsed : fallback', 'parsed > 0 ? parsed : fallback'],
  ['a nonsense lock window becomes NaN again (the wait loop spins forever)',
    'return Number.isFinite(parsed) && parsed > 0 && parsed <= MAX_LOCK_WINDOW_MS ? parsed : fallback',
    'return parsed'],
  ['the seed stamp goes back to a name both adapters write (our seeds never install)',
    "const stampPath = path.join(playbookDir, 'SEED_VERSION.codex')",
    "const stampPath = path.join(playbookDir, 'SEED_VERSION')"],
  ['running outside a repository loses the explanation',
    "throw new Error('not inside a git repository — run this from the repository you are working in')",
    "throw new Error('failed')"],
]

const CODEX = path.join(ROOT, 'plugins/masterdevs-codex')
const REVIEWER_ROSTER = path.join(CODEX, 'playbook-seeds/rosters/reviewers.codex.defaults.json')
const ARCHITECT_ROSTER = path.join(CODEX, 'playbook-seeds/rosters/architects.codex.defaults.json')
const REVIEW_SKILL = path.join(CODEX, 'skills/masterdevs-review/SKILL.md')
const PLAN_SKILL = path.join(CODEX, 'skills/masterdevs-plan/SKILL.md')
const ROSTER_SKILL = path.join(CODEX, 'skills/masterdevs-roster/SKILL.md')
const LOOP_DOC = path.join(CODEX, 'skills/masterdevs-feature/references/feature-loop.md')
const SHARED_CATALOG = path.join(CODEX, 'playbook-seeds/patterns/core/catalog.md')
const REVIEWER_AGENT = path.join(CODEX, 'skills/masterdevs-reviewer/agents/openai.yaml')

// The shipped rosters are data, not code, and they are what actually went wrong: the Codex copies
// were byte-identical to Claude's, naming an `opus` model and a `masterdevs:` subagent that no
// OpenAI runtime has. Nothing crashed, so three review rounds read straight past it. These mutations
// exist because a data file can be as wrong as a function and is far easier to leave unguarded.
const REVIEWER_ROSTER_MUTATIONS = [
  ['a Claude model name creeps back into the reviewer roster',
    '"roleSkill": "masterdevs-reviewer"',
    '"roleSkill": "masterdevs-reviewer",\n    "model": "opus"'],
  ['a shipped default is gated behind a trigger match, so it may never run',
    '"lens": "all",', '"lens": "security",\n    "triggers": { "lenses": ["security"] },'],
  ['the reviewer roster names a Claude subagent instead of a Codex skill',
    '"roleSkill": "masterdevs-reviewer"', '"agentType": "masterdevs:reviewer"'],
  ['a Claude-named roster reappears inside the Codex plugin',
    { add: 'plugins/masterdevs-codex/playbook-seeds/rosters/reviewers.json', contents: '[]\n' }],
]

const ARCHITECT_ROSTER_MUTATIONS = [
  ['a Claude model name creeps back into the architect roster',
    '"catalogs": ["core", "frontend"] }', '"catalogs": ["core", "frontend"], "model": "opus" }'],
  ['the architect roster routes a lens to a catalog that does not ship',
    '"catalogs": ["core", "backend", "concurrency"]', '"catalogs": ["core", "backend", "persistence"]'],
]

// A skill that reads a roster nothing ships is the other half of the same bug: the review panel
// named a file that only ever existed as the user's, so the shipped default never loaded.
const REVIEW_SKILL_MUTATIONS = [
  ['the review panel reads a shipped roster no seed provides',
    'playbook/rosters/reviewers.codex.defaults.json', 'playbook/rosters/reviewers.json'],
  ['the user roster stops pairing with the defaults it extends',
    'playbook/rosters/reviewers.codex.user.json', 'playbook/rosters/panel.user.json'],
]

const PLAN_SKILL_MUTATIONS = [
  ['the plan skill routes lenses through a roster that does not ship',
    'playbook/rosters/architects.codex.defaults.json', 'playbook/rosters/architects.json'],
  ['the architect roster loses its only consumer again',
    'read `playbook/rosters/architects.codex.defaults.json` for the catalogs that lens names',
    'use your judgement about which catalogs that lens wants'],
  ['a roster path is written the Claude way, with a stale Claude filename',
    'playbook/rosters/architects.codex.defaults.json', '$PLAYBOOK_DIR/rosters/architects.json'],
]

// The roster skill is the one place a user is *told* what to write. Guarding only the shipped data
// leaves a door open: re-document a field the runtime lacks and the bug returns through the user's
// own file, which no shipped-data check ever looks at.
const ROSTER_SKILL_MUTATIONS = [
  ['the roster skill swaps which file is the shipped one and which is the user\'s',
    'Store user reviewers in `playbook/rosters/reviewers.codex.user.json`; never edit the shipped `playbook/rosters/reviewers.codex.defaults.json`.',
    'Store user reviewers in `playbook/rosters/reviewers.codex.defaults.json`; never edit the shipped `playbook/rosters/reviewers.codex.user.json`.'],
  ['the roster skill documents a per-agent model override again',
    '  "lessonsLane": "accessibility"', '  "model": "optional model override",\n  "lessonsLane": "accessibility"'],
]

// "Exclude rosters from byte-identity" is a change to a *check*, so the thing worth proving is that
// the check still bites everywhere else.
// The feature loop is the main product path, and its only mention of user reviewers named no file
// at all — so a reviewer someone registered would simply never fire, with nothing to show why.
const LOOP_DOC_MUTATIONS = [
  ['the feature loop stops naming the rosters its review panel comes from',
    'Build it from `playbook/rosters/reviewers.codex.defaults.json` — `$masterdevs-reviewer` alone by default — plus any entries in `playbook/rosters/reviewers.codex.user.json`, where a user entry replaces a shipped default of the same `name`.',
    'Any registered Codex reviewers whose triggers match run alongside it.'],
]

// The shipped defaults deliberately carry no `triggers`, so a consumer doc that says an entry
// without triggers is skipped empties the panel — and the loop then reports a clean review with no
// reviewer having run.
const REVIEW_TRIGGER_MUTATIONS = [
  ['the review skill says an untriggered entry is skipped, emptying the panel',
    'An entry with no `triggers`, or with `lens: "all"`, always runs;',
    'An entry without matching `triggers` is skipped;'],
]

const REVIEW_FALLBACK_MUTATIONS = [
  ['the review skill drops the unreadable-roster fallback',
    ' An entry with no `triggers`, or with `lens: "all"`, always runs; if the user file is absent, empty, or unreadable, run the shipped defaults alone.',
    ' An entry with no `triggers`, or with `lens: "all"`, always runs.'],
]

const LOOP_TRIGGER_MUTATIONS = [
  ['the feature loop says an untriggered entry is skipped, emptying the panel',
    'an entry with no `triggers`, or with `lens: "all"`, always runs',
    'entries without matching `triggers` are skipped'],
  ['the feature loop drops the unreadable-roster fallback',
    ' If the user file is absent, empty, or unreadable, run the shipped defaults alone.', ''],
]

const SHARED_CATALOG_MUTATIONS = [
  ['a shared catalog drifts between adapters',
    '# Core Pattern Catalog', '# Core Pattern Catalog (codex)'],
]

// Seed drift that is not a change to any existing file: a new seed on one side only, an orphan
// roster nothing reads, or an empty directory that ships as a phantom lane.
// The rosters carry no model because the agent definition has nowhere to put one. If that ever
// stops being true, the roster decision deserves revisiting rather than silently standing.
const REVIEWER_AGENT_MUTATIONS = [
  ['the reviewer agent gains a model, so the roster decision needs rethinking',
    'policy:', 'model: gpt-5\npolicy:'],
]

const SEED_PARITY_MUTATIONS = [
  ['a seed lands in one adapter and is forgotten in the other',
    { add: 'plugins/masterdevs-codex/playbook-seeds/lessons/codex-only.md', contents: '# codex only\n' }],
  ['a roster ships with nothing reading it',
    { add: 'plugins/masterdevs-codex/playbook-seeds/rosters/architects.spare.codex.defaults.json',
      contents: '[{ "lens": "all", "roleSkill": "masterdevs-architect", "catalogs": ["core"] }]\n' }],
  ['an empty seed directory ships as a phantom Playbook lane',
    { addDir: 'plugins/masterdevs-codex/playbook-seeds/patterns/phantom' }],
  ['the defaults ship again under the path an earlier build gave the user',
    { add: 'plugins/masterdevs-codex/playbook-seeds/rosters/reviewers.codex.json',
      contents: '[]\n' }],
  ["a seed occupies the path reserved for the user's own roster",
    { add: 'plugins/masterdevs-codex/playbook-seeds/rosters/reviewers.codex.user.json',
      contents: '[{ "name": "reviewer", "lens": "all", "roleSkill": "masterdevs-reviewer" }]\n' }],
  ['the roster exclusion widens far enough to swallow a real seed',
    { add: 'plugins/masterdevs/playbook-seeds/rosters/extra.json', contents: '[]\n' }],
  ['a seed lands under the Claude adapter and not this one',
    { add: 'plugins/masterdevs/playbook-seeds/lessons/claude-only.md', contents: '# claude only\n' }],
  ['an empty directory under rosters/ ships unnoticed',
    { addDir: 'plugins/masterdevs-codex/playbook-seeds/rosters/sub' }],
  ['a roster of an unrecognized kind inherits a role pin by default',
    { add: 'plugins/masterdevs-codex/playbook-seeds/rosters/panel.codex.defaults.json',
      contents: '[{ "name": "panel", "lens": "all", "roleSkill": "masterdevs-reviewer" }]\n' }],
]

// Each target pairs a source file with the suite that is supposed to defend it.
const TARGETS = [
  { name: 'feature-loop', src: LOOP_SRC, suite: 'scripts/loop-scenarios.mjs', mutations: MUTATIONS },
  { name: 'codex-state', src: STATE_SRC, suite: 'scripts/codex-state-scenarios.mjs', mutations: STATE_MUTATIONS },
  { name: 'codex-reviewer-roster', src: REVIEWER_ROSTER, suite: 'scripts/codex-state-scenarios.mjs', mutations: REVIEWER_ROSTER_MUTATIONS },
  { name: 'codex-architect-roster', src: ARCHITECT_ROSTER, suite: 'scripts/codex-state-scenarios.mjs', mutations: ARCHITECT_ROSTER_MUTATIONS },
  { name: 'codex-review-skill', src: REVIEW_SKILL, suite: 'scripts/codex-state-scenarios.mjs', mutations: REVIEW_SKILL_MUTATIONS },
  { name: 'codex-review-triggers', src: REVIEW_SKILL, suite: 'scripts/codex-state-scenarios.mjs', mutations: REVIEW_TRIGGER_MUTATIONS },
  { name: 'codex-review-fallback', src: REVIEW_SKILL, suite: 'scripts/codex-state-scenarios.mjs', mutations: REVIEW_FALLBACK_MUTATIONS },
  { name: 'codex-loop-triggers', src: LOOP_DOC, suite: 'scripts/codex-state-scenarios.mjs', mutations: LOOP_TRIGGER_MUTATIONS },
  { name: 'codex-plan-skill', src: PLAN_SKILL, suite: 'scripts/codex-state-scenarios.mjs', mutations: PLAN_SKILL_MUTATIONS },
  { name: 'codex-roster-skill', src: ROSTER_SKILL, suite: 'scripts/codex-state-scenarios.mjs', mutations: ROSTER_SKILL_MUTATIONS },
  { name: 'codex-loop-doc', src: LOOP_DOC, suite: 'scripts/codex-state-scenarios.mjs', mutations: LOOP_DOC_MUTATIONS },
  { name: 'codex-shared-catalog', src: SHARED_CATALOG, suite: 'scripts/codex-state-scenarios.mjs', mutations: SHARED_CATALOG_MUTATIONS },
  { name: 'codex-reviewer-agent', src: REVIEWER_AGENT, suite: 'scripts/codex-state-scenarios.mjs', mutations: REVIEWER_AGENT_MUTATIONS },
  { name: 'codex-seed-parity', src: null, suite: 'scripts/codex-state-scenarios.mjs', mutations: SEED_PARITY_MUTATIONS },
]
// A target with no src only creates and removes files; it never edits one.
for (const target of TARGETS) {
  if (target.src) continue
  for (const [name, from] of target.mutations) {
    if (!from || typeof from !== 'object') {
      throw new Error(`target "${target.name}" has no src, so mutation "${name}" must add a file or directory`)
    }
  }
}
const originals = new Map(TARGETS.filter((t) => t.src).map((t) => [t.src, fs.readFileSync(t.src, 'utf8')]))
// Files a mutation created. Some invariants are about a file that must NOT exist, which find/replace
// inside one file cannot express.
const added = new Set()
// Directories created to hold them. An empty directory left in playbook-seeds is invisible to git
// and to the parity walk, but copyMissing still ships it to every user as a phantom lane — so the
// harness has to put these back too, deepest first.
const addedDirs = new Set()
const restoreAll = () => {
  for (const [file, text] of originals) fs.writeFileSync(file, text)
  for (const file of added) {
    try { fs.unlinkSync(file) }
    catch (error) {
      if (error.code === 'ENOENT') continue
      console.error(`could not remove ${file}: ${error.message} — remove it before running again`)
      process.exitCode = 1
    }
  }
  for (const dir of [...addedDirs].sort((a, b) => b.length - a.length)) {
    // Never silently: a directory left under playbook-seeds is invisible to git and poisons the
    // next run's parity check, which is what made a red suite score 100% in the first place.
    try { fs.rmdirSync(dir); addedDirs.delete(dir) }
    catch (error) {
      console.error(`could not remove ${dir}: ${error.message} — remove it before running again`)
      process.exitCode = 1
    }
  }
  added.clear()
}

process.on('exit', restoreAll)   // restore even if this crashes
// 'exit' does not fire on a signal, and these mutations edit files that ship to users. Note that
// the loop below is fully synchronous — execSync blocks the event loop — so these handlers only run
// once it finishes. Ctrl-C therefore looks ignored for the length of a full run; it is not, and the
// tree is restored either way, but a kill -9 in the middle does leave a mutated file behind.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { restoreAll(); process.exit(1) })
}

// Every mutation is judged by "the suite went red", so a suite that is ALREADY red scores a perfect
// report for entirely the wrong reason. That is not hypothetical: an untracked empty directory under
// playbook-seeds fails the parity check, and git shows untracked directories as neither a change nor
// something `git clean -f` removes — so the tree can look clean and score 76/76 while proving nothing.
// This harness exists because a green suite can be worthless; the same has to hold for its own score.
const requireGreen = (when) => {
  for (const suite of new Set(TARGETS.map((target) => target.suite))) {
    try { execSync(`node "${suite}"`, { cwd: ROOT, stdio: 'pipe' }) }
    catch (error) {
      console.error(`\n${suite} fails on an unmutated tree ${when}, so every mutation against it`)
      console.error('would report `caught` for the wrong reason. Either the code has a real regression')
      console.error('— its output is below — or the tree holds a stray untracked directory, which git')
      console.error('reports as neither a change nor something `git clean -f` removes.\n')
      process.stderr.write(error.stdout?.toString() ?? '')
      process.stderr.write(error.stderr?.toString() ?? '')
      process.exit(1)
    }
  }
}
requireGreen('before any mutation')

let caught = 0
let stale = 0
let staleAdds = 0
let total = 0
for (const target of TARGETS) {
  const orig = originals.get(target.src)
  console.log(`\n${target.name} — ${target.mutations.length} mutation(s) against ${target.suite}`)
  for (const [name, from, to] of target.mutations) {
    total++
    if (from && typeof from === 'object' && typeof from.addDir === 'string') {
      const dir = path.join(ROOT, from.addDir)
      if (fs.existsSync(dir)) {
        console.log(`  STALE   ${name}  — ${from.addDir} already exists, so adding it proves nothing`)
        staleAdds++
        stale++
        continue
      }
      for (let at = dir; !fs.existsSync(at); at = path.dirname(at)) addedDirs.add(at)
      fs.mkdirSync(dir, { recursive: true })
    } else if (from && typeof from === 'object') {
      if (typeof from.add !== 'string' || typeof from.contents !== 'string') {
        throw new Error(`mutation "${name}" must give an add path with a contents string, or an addDir`)
      }
      const file = path.join(ROOT, from.add)
      if (fs.existsSync(file)) {
        console.log(`  STALE   ${name}  — ${from.add} already exists, so adding it proves nothing`)
        staleAdds++
        stale++
        continue
      }
      for (let dir = path.dirname(file); !fs.existsSync(dir); dir = path.dirname(dir)) addedDirs.add(dir)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, from.contents)
      added.add(file)
    } else if (!orig.includes(from)) {
      console.log(`  STALE   ${name}  — mutation site no longer exists in the source`)
      stale++
      continue
    } else {
      fs.writeFileSync(target.src, orig.replace(from, to))
    }
    let suitePassed
    try { execSync(`node "${target.suite}"`, { cwd: ROOT, stdio: 'pipe' }); suitePassed = true }
    catch { suitePassed = false }
    console.log(suitePassed ? `  MISSED  ${name}` : `  caught  ${name}`)
    if (!suitePassed) caught++
    restoreAll()
    // A failed restore poisons every later mutation, so stop rather than print more verdicts.
    if (process.exitCode) {
      console.error('stopping: the tree could not be restored, so no further result would mean anything')
      process.exit(1)
    }
  }
}

restoreAll()
requireGreen('after the run restored it')

console.log(`\n${caught}/${total} mutations caught`)
if (staleAdds) {
  console.log(`${staleAdds} mutation(s) STALE — a file that must not exist is already there; remove it`)
}
if (stale > staleAdds) {
  console.log(`${stale - staleAdds} mutation(s) STALE — the code moved; update the find/replace pair`)
}
if (caught !== total || stale) {
  console.log('\nA MISSED mutation means the scenario covering it asserts a side effect, not the mechanism.')
  process.exitCode = 1
}
