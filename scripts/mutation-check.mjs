#!/usr/bin/env node
// Does loop-scenarios.mjs actually catch anything?
//
// Deliberately breaks feature-loop.js one way at a time and checks the suite goes red. A scenario suite
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
const SRC = path.join(ROOT, 'plugins/masterdevs/workflows/feature-loop.js')
const orig = fs.readFileSync(SRC, 'utf8')

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
  // Gold is human-write-only. If the prompt stops saying so, an agent staging an entry would bypass
  // the only gate that lane has.
  ['stop telling agents the gold lane is read-only',
    '`stage or reindex either lane — only /masterdevs:gold writes them.`',
    '``'],
  // Two lanes in unrelated places, and only one of them is under the Playbook root. Drop the repo one
  // and a team's committed examples become invisible to every agent, silently.
  ['hide the team\'s repo lane from the agents',
    '`<repo>/.masterdevs/gold/ (the team\'s, committed alongside their code — it is NOT under the Playbook ` +',
    '`` +'],
]

process.on('exit', () => fs.writeFileSync(SRC, orig))   // restore even if this crashes

let caught = 0
let stale = 0
for (const [name, from, to] of MUTATIONS) {
  if (!orig.includes(from)) {
    console.log(`  STALE   ${name}  — mutation site no longer exists in the source`)
    stale++
    continue
  }
  fs.writeFileSync(SRC, orig.replace(from, to))
  let suitePassed
  try { execSync('node scripts/loop-scenarios.mjs', { cwd: ROOT, stdio: 'pipe' }); suitePassed = true }
  catch { suitePassed = false }
  console.log(suitePassed ? `  MISSED  ${name}` : `  caught  ${name}`)
  if (!suitePassed) caught++
}
fs.writeFileSync(SRC, orig)

console.log(`\n${caught}/${MUTATIONS.length} mutations caught`)
if (stale) console.log(`${stale} mutation(s) STALE — the code moved; update the find/replace pair`)
if (caught !== MUTATIONS.length || stale) {
  console.log('\nA MISSED mutation means the scenario covering it asserts a side effect, not the mechanism.')
  process.exitCode = 1
}
