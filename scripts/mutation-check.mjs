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
    'let vAttempt = 0\n  while (verify && !verify.passed && vAttempt < MAX_VERIFY_FIX) {',
    'let vAttempt = 0\n  while (false && verify && !verify.passed && vAttempt < MAX_VERIFY_FIX) {'],
  ['always claim verify passed',
    'verifyPassed = !!(verify && verify.passed)', 'verifyPassed = true'],
  ['stop collecting punts/escalations',
    '  if (r.punted) punted.push(...r.punted)', '  if (false) punted.push(...r.punted)'],
  ['let an escalation alone fail the run (labels a clean run as needing you)',
    'outcome: (verifyPassed && unresolvedBlocking.length === 0 && conflicts.length === 0)',
    'outcome: (verifyPassed && unresolvedBlocking.length === 0 && conflicts.length === 0 && escalations.length === 0)'],
  ['stop letting a conflict fail the run',
    'outcome: (verifyPassed && unresolvedBlocking.length === 0 && conflicts.length === 0)',
    'outcome: (verifyPassed && unresolvedBlocking.length === 0)'],
  ['ignore the confirmed intent in Refine',
    'const intent = input.intent || null', 'const intent = null'],
  ['drop the soWhat rule from the reviewer prompt',
    'SO_WHAT_RULE + readOnlyRule', 'readOnlyRule'],
  ['LOOSEN schema: soWhat no longer required on findings',
    "'summary', 'fix', 'soWhat'],", "'summary', 'fix'],"],
  ['LOOSEN schema: escalations lose soWhat',
    "required: ['issue', 'why', 'soWhat'],", "required: ['issue', 'why'],"],
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
