#!/usr/bin/env node
// Control-flow regression test for the feature loop.
//
// Runs the real workflow script against a stubbed agent layer, so every branch is exercised in
// milliseconds for free — no models, no tokens, no repo. This catches the class of bug that is
// otherwise invisible until a two-hour run ends in the wrong state: a loop that won't terminate, an
// escalation that halts when it shouldn't, a result field that silently stops being populated.
//
//   node scripts/loop-scenarios.mjs          # run all, exit 1 on any failure
//   node scripts/loop-scenarios.mjs -v       # also print the agent sequence per scenario
//
// It does NOT test agent judgment (does the reviewer find real bugs, does the interview ask good
// questions). That needs real models — see evals/README.md.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(ROOT, 'plugins/masterdevs/workflows/feature-loop.js')
const VERBOSE = process.argv.includes('-v')

const src = fs.readFileSync(SCRIPT, 'utf8').replace('export const meta', 'const meta', 1)
const wf = new Function('args', 'agent', 'parallel', 'log', 'phase', 'budget',
  `return (async () => {\n${src}\n})()`)

// ── stub agent results ──────────────────────────────────────────────────────
const REFINE = {
  requirements: 'r', openQuestions: [],
  successCriteria: [{ name: 'c1', kind: 'happy', check: 'x' }],
  verifyMethod: { approach: 'a', dataSource: 'the seeded test fixture', riskySteps: [] },
}
const PLAN = {
  summary: 's', lenses: ['correctness'],
  claims: [{ claim: 'only two call sites read the stamp', check: 'grep -c stamp', ifWrong: 'step 2 misses one' }],
  steps: [{ title: 't', intent: 'i', files: ['f.py'], guidance: ['g'], acceptance: ['a'] }],
}
const APPROVED = { refine: REFINE, plan: PLAN }
const claimsOk = { results: [{ claim: 'only two call sites read the stamp', verdict: 'verified', evidence: '2 matches' }] }
const critOk = { issues: [] }
const critIssue = (kind) => ({ issues: [{ kind, criteria: ['c1', 'c13'], problem: 'p', evidence: 'e',
  soWhat: 'the run would spend hours proving correct code wrong' }] })
// Verify distinguishes "an engineer can fix this" from "the target itself is wrong".
const vimpossible = { passed: false, results: [], failures: [], needsApprovalFor: [],
  impossible: [{ criterion: 'c1', why: 'the stated total is the pre-fix value' }] }
const claimsBad = { results: [{ claim: 'only two call sites read the stamp', verdict: 'refuted', evidence: 'there are five' }] }

const impl = { status: 'done', changedFiles: ['f.py'], notes: 'n', punted: [{ item: 'smell', reason: 'out of scope' }] }
const refac = { changedFiles: ['f.py'], applied: [], notes: 'n', punted: [{ item: 'dead helper', reason: 'elsewhere' }] }
const vpass = { passed: true, results: [], failures: [], needsApprovalFor: [] }
const vfail = { passed: false, results: [], failures: ['boom'], needsApprovalFor: [] }
const find = (sev) => ({ findings: sev.map((s, i) => ({ severity: s, lens: 'correctness', file: 'f.py', line: i + 1, summary: s, fix: 'x', soWhat: 'users see a stale total until the next refresh' })) })
const iter = (o) => ({ decision: 'stop', mustFix: [], polish: [], conflicts: [], deferred: [], ...o })

const LOOP_ARGS = { brief: 'b', playbookDir: '/pb', runDir: '/run', startFrom: 'implement', approved: APPROVED, userReviewers: [] }

// ── schema validation ───────────────────────────────────────────────────────
// Stubs are fiction, and fiction drifts. Every stub return is checked against the REAL schema the
// workflow declares for that agent call, so two different bugs surface: a stub that stops resembling
// what an agent returns, and a schema that gets broken in feature-loop.js. Without this, a required
// field can be deleted from the schema and every scenario still passes.
function validate(value, schema, p) {
  const errs = []
  const walk = (v, s, at) => {
    if (!s || typeof s !== 'object') return
    if (s.type === 'object') {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) return errs.push(`${at}: expected object`)
      for (const r of s.required || []) if (!(r in v)) errs.push(`${at}.${r}: missing required field`)
      if (s.additionalProperties === false) {
        for (const k of Object.keys(v)) if (!(s.properties || {})[k]) errs.push(`${at}.${k}: not allowed by schema`)
      }
      for (const [k, sub] of Object.entries(s.properties || {})) if (k in v) walk(v[k], sub, `${at}.${k}`)
    } else if (s.type === 'array') {
      if (!Array.isArray(v)) return errs.push(`${at}: expected array`)
      v.forEach((item, i) => walk(item, s.items, `${at}[${i}]`))
    } else if (s.type === 'string') {
      if (typeof v !== 'string') errs.push(`${at}: expected string`)
      else if (s.enum && !s.enum.includes(v)) errs.push(`${at}: "${v}" not one of ${s.enum.join('|')}`)
    } else if (s.type === 'integer') {
      if (!Number.isInteger(v)) errs.push(`${at}: expected integer`)
    } else if (s.type === 'boolean') {
      if (typeof v !== 'boolean') errs.push(`${at}: expected boolean`)
    }
  }
  walk(value, schema, p)
  return errs
}

async function drive(args, responder) {
  const calls = []
  const schemaErrors = []
  const schemas = {}
  const agent = async (prompt, opts) => {
    calls.push(opts.label)
    schemas[opts.label] = opts.schema
    const out = await responder(opts.label, prompt)
    // null is a legal agent result (the workflow handles it); anything else must match the contract.
    if (out != null && opts.schema) schemaErrors.push(...validate(out, opts.schema, opts.label))
    return out
  }
  const parallel = async (thunks) =>
    Promise.all(thunks.map(async (t) => { try { return await t() } catch { return null } }))
  const result = await wf(args, agent, parallel, () => {}, () => {}, undefined)
  return { calls, result, schemaErrors, schemas }
}

const rounds = (calls) => calls.filter((c) => /^implement:\d+$/.test(c)).length

// ── scenarios ───────────────────────────────────────────────────────────────
// Each asserts on the OUTCOME and the AGENT SEQUENCE — the two things a control-flow bug corrupts.
const scenarios = [
  {
    name: 'nits only — must not buy a second round',
    args: LOOP_ARGS,
    responder: (l) =>
      l.startsWith('implement') || l === 'polish' ? impl :
      l.startsWith('refactor') ? refac :
      l.startsWith('verify') ? vpass :
      l.startsWith('review') ? find(['medium', 'low', 'low']) :
      iter({ polish: ['p1', 'p2'] }),
    expect: ({ result, calls }) => [
      [result.iterations === 1, `iterations should be 1, got ${result.iterations}`],
      [result.outcome === 'passed', `outcome should be passed, got ${result.outcome}`],
      [result.polishApplied.length === 2, 'both nits should reach the Polish pass'],
      [calls.filter((c) => c.startsWith('review')).length === 1, 'nits must not trigger a second review'],
    ],
  },
  {
    name: 'one high finding — buys exactly one more round',
    args: LOOP_ARGS,
    responder: (() => {
      let round = 0
      return (l) => {
        if (l.startsWith('implement') || l === 'polish') return impl
        if (l.startsWith('refactor')) return refac
        if (l.startsWith('verify')) return vpass
        if (l.startsWith('review')) return (++round === 1) ? find(['high', 'low']) : find(['low'])
        return round === 1 ? iter({ decision: 'continue', mustFix: ['fix it'] }) : iter({})
      }
    })(),
    expect: ({ result }) => [
      [result.iterations === 2, `iterations should be 2, got ${result.iterations}`],
      [result.outcome === 'passed', `outcome should be passed, got ${result.outcome}`],
    ],
  },
  {
    name: 'agent votes continue on nits — script must overrule it',
    args: LOOP_ARGS,
    responder: (l) =>
      l.startsWith('implement') || l === 'polish' ? impl :
      l.startsWith('refactor') ? refac :
      l.startsWith('verify') ? vpass :
      l.startsWith('review') ? find(['medium', 'low']) :
      iter({ decision: 'continue', mustFix: [], polish: ['p'] }),
    expect: ({ result }) => [
      [result.iterations === 1, `the agent may vote to stop, never to prolong; got ${result.iterations} rounds`],
    ],
  },
  {
    // The cap is the whole point of the churn fix. Every other signal here screams "keep going" —
    // high findings, non-empty mustFix, an Iterate agent voting continue every round — so the ONLY
    // thing that can stop this loop is MAX_ITERATIONS. 2 is the design contract, deliberately written
    // as a literal: if someone changes the constant, this must fail and make them think about it.
    name: 'loop is capped even when every signal says continue',
    args: LOOP_ARGS,
    responder: (l) =>
      l.startsWith('implement') || l === 'polish' ? impl :
      l.startsWith('refactor') ? refac :
      l.startsWith('verify') ? vpass :
      l.startsWith('review') ? find(['high', 'high']) :
      iter({ decision: 'continue', mustFix: ['still broken'], polish: [] }),
    expect: ({ result, calls }) => [
      [result.iterations === 2, `the loop must cap at 2 rounds, ran ${result.iterations}`],
      [rounds(calls) === 2, `expected 2 implement rounds, got ${rounds(calls)}`],
    ],
  },
  {
    // Previously this only asserted Polish was skipped — which is separately guarded by
    // `!conflicts.length`, so deleting the conflict break changed nothing observable. Now there is
    // blocking work outstanding too, so the ONLY reason to stop after round 1 is the conflict itself.
    name: 'plan conflict — stops the loop dead, even with work outstanding',
    args: LOOP_ARGS,
    responder: (l) =>
      l.startsWith('implement') ? impl :
      l.startsWith('refactor') ? refac :
      l.startsWith('verify') ? vpass :
      l.startsWith('review') ? find(['high']) :
      iter({ decision: 'continue', mustFix: ['would otherwise continue'],
             conflicts: [{ finding: 'f', conflictsWith: 'req' }], polish: ['p'] }),
    expect: ({ result, calls }) => [
      [result.conflicts.length === 1, 'the conflict must come back'],
      [result.iterations === 1, `must stop at round 1 on a conflict, ran ${result.iterations}`],
      [rounds(calls) === 1, `must not start another round, got ${rounds(calls)} implement rounds`],
      [result.outcome === 'needs-attention', `outcome should be needs-attention, got ${result.outcome}`],
      [!calls.includes('polish'), 'Polish must not run while a conflict is unresolved'],
    ],
  },
  {
    // Companion to the scenario above, and to 'escalate-and-continue'. Together the three pin the
    // verdict rule: an escalation is report content, a conflict is a stop. Here the conflict must be
    // the ONLY thing wrong — verify green, nothing blocking outstanding — or `unresolvedBlocking`
    // would fail the run on its own and deleting the conflict check would change nothing observable.
    name: 'a conflict alone fails the run, with every other signal green',
    args: LOOP_ARGS,
    responder: (l) =>
      l.startsWith('implement') ? impl :
      l.startsWith('refactor') ? refac :
      l.startsWith('verify') ? vpass :
      l.startsWith('review') ? find(['low']) :
      iter({ conflicts: [{ finding: 'f', conflictsWith: 'req' }] }),
    expect: ({ result }) => [
      [result.verifyPassed === true, 'verify must be green, or it would fail the run by itself'],
      [result.unresolvedBlocking.length === 0, 'nothing blocking may be outstanding, for the same reason'],
      [result.conflicts.length === 1, 'the conflict must come back'],
      [result.outcome === 'needs-attention',
        `a scope clash is yours to decide — got ${result.outcome}`],
    ],
  },
  {
    // The agent may vote to stop, and that vote is binding even when there is blocking work left —
    // it has context the script doesn't. Without blocking work present, the no-work exit would stop
    // the loop anyway and this would prove nothing.
    name: "agent's stop vote is honored even with blocking work outstanding",
    args: LOOP_ARGS,
    responder: (l) =>
      l.startsWith('implement') || l === 'polish' ? impl :
      l.startsWith('refactor') ? refac :
      l.startsWith('verify') ? vpass :
      l.startsWith('review') ? find(['high']) :
      iter({ decision: 'stop', mustFix: ['deliberately left'], polish: [] }),
    expect: ({ result, calls }) => [
      [result.iterations === 1, `a stop vote must end the loop, ran ${result.iterations}`],
      [rounds(calls) === 1, `must not start another round, got ${rounds(calls)} implement rounds`],
      [result.unresolvedBlocking.length === 1, 'the unaddressed high finding must be reported, not hidden'],
    ],
  },
  {
    // Verification is 22% of an average run and its cost curve was FLAT — every pass re-derived how to
    // operate the repo. Two things fix that, and both are prompt contracts, so this asserts on prompts.
    name: 'verify is told what it already knows, and told not to go exploring',
    args: LOOP_ARGS,
    responder: (l) =>
      l.startsWith('implement') || l === 'polish' ? impl :
      l.startsWith('refactor') ? refac :
      l.startsWith('verify') ? vpass :
      l.startsWith('review') ? find(['low']) : iter({}),
    capturePrompt: 'verify:1.0',
    expect: ({ prompt }) => [
      [/verify-repo-notes\.md/.test(prompt), 'verify must be pointed at the durable per-repo notes'],
      [/verify-log\.md/.test(prompt), "verify must be pointed at this run's log"],
      [/TRUST IT; do not re-derive it/.test(prompt), 'reading the notes is pointless if it re-derives anyway'],
      [/Do not go exploring/.test(prompt), 'unbounded exploration is what makes verify blow up and retry'],
      [/mark it unproven with the reason and return/.test(prompt),
        'verify needs a cheap way out, or it hunts until it dies'],
    ],
  },
  {
    // Re-verifies measured MORE expensive than first passes (143K vs 114K) because they inherited the
    // first-pass scope and redid the whole job. The fix agent addressed named failures; only those need
    // live re-proving.
    name: 're-verify after a fix is scoped to what the fix touched',
    args: LOOP_ARGS,
    responder: (() => {
      let v = 0
      return (l) => {
        if (l.startsWith('implement') || l === 'polish') return impl
        if (l.startsWith('refactor')) return refac
        if (l.startsWith('verify')) return (++v === 1)
          ? { passed: false, results: [], failures: ['the total is off by one'], needsApprovalFor: [] }
          : vpass
        if (l === 'review:post-fix') return find([])
        if (l.startsWith('review')) return find(['low'])
        return iter({})
      }
    })(),
    capturePrompt: 'verify:1.1',
    expect: ({ prompt }) => [
      [/the total is off by one/.test(prompt), 'the re-verify must be told which failures were just fixed'],
      [/re-exercise LIVE ONLY the criteria above/.test(prompt),
        'a re-verify that redoes the full first pass is why this phase cost more on retry, not less'],
      [/regression net/.test(prompt), 'the suite still runs once, as the net'],
      [!/boot the app, hit endpoints/.test(prompt),
        'the first-pass scope must NOT leak into a re-verify — that was the actual bug'],
    ],
  },
  {
    name: 'verify fails then fixed — fixes get re-verified AND re-reviewed',
    args: LOOP_ARGS,
    responder: (() => {
      let v = 0
      return (l) => {
        if (l.startsWith('implement') || l === 'polish') return impl
        if (l.startsWith('refactor')) return refac
        if (l.startsWith('verify')) return (++v === 1) ? vfail : vpass
        if (l === 'review:post-fix') return find([])
        if (l.startsWith('review')) return find(['low'])
        return iter({ polish: ['p'] })
      }
    })(),
    expect: ({ result, calls }) => [
      [result.verifyPassed === true, 'verify should pass after the fix'],
      [calls.includes('review:post-fix'), 'fixes applied after review must not ship unreviewed'],
      [calls.indexOf('implement:1.fix1') > calls.indexOf('review:reviewer:1'),
        'the mutating fix must run AFTER the reviewer finished reading'],
    ],
  },
  {
    name: 'verify never passes — bounded, and reported honestly',
    args: LOOP_ARGS,
    responder: (l) =>
      l.startsWith('implement') || l === 'polish' ? impl :
      l.startsWith('refactor') ? refac :
      l.startsWith('verify') ? vfail :
      l.startsWith('review') ? find(['low']) : iter({}),
    expect: ({ result, calls }) => [
      [result.verifyPassed === false, 'must not claim success'],
      [result.outcome === 'needs-attention', `outcome should be needs-attention, got ${result.outcome}`],
      [calls.filter((c) => c.startsWith('implement:1.fix')).length === 2, 'fix attempts must be capped at MAX_VERIFY_FIX'],
      [!calls.includes('verify:final'), 'no point regression-checking an already-red tree'],
    ],
  },
  {
    name: 'escalate-and-continue — a surprise must not halt the run',
    args: LOOP_ARGS,
    responder: (l) =>
      l.startsWith('implement') || l === 'polish'
        ? { ...impl, escalations: [{ issue: 'file not as planned', why: 'took adjacent seam', soWhat: 'no user-visible change; the seam moved one layer out' }] } :
      l.startsWith('refactor') ? refac :
      l.startsWith('verify') ? vpass :
      l.startsWith('review') ? find(['low']) : iter({ polish: ['p'] }),
    expect: ({ result }) => [
      [result.escalations.length >= 1, 'the escalation must surface'],
      [result.verifyPassed === true, 'the run should have finished its work'],
      [result.outcome === 'passed',
        `an escalation is reported, not a verdict — the run finished clean, got ${result.outcome}`],
    ],
  },
  {
    name: 'hard block — still returns what it collected',
    args: LOOP_ARGS,
    responder: (l) =>
      l.startsWith('implement')
        ? { status: 'blocked', changedFiles: [], notes: 'dead end',
            escalations: [{ issue: 'dependency absent', why: 'no path', soWhat: 'the feature cannot ship until this is decided' }], punted: [{ item: 'x', reason: 'y' }] }
        : null,
    expect: ({ result }) => [
      [result.outcome === 'blocked', `outcome should be blocked, got ${result.outcome}`],
      [result.escalations.length === 1, 'the escalation explaining the block must come back'],
      [result.punted.length === 1, 'punts collected before the block must not be lost'],
    ],
  },
  {
    name: 'first call WITH confirmed intent — scope and verification arrive settled',
    args: { brief: 'b', playbookDir: '/pb', runDir: '/run',
      intent: { outcome: 'O', user: 'U', whyNow: 'W', success: 'S', constraint: 'C', outOfScope: 'NOPE',
        verifyOn: 'deal 867 in the dev database' } },
    responder: (l) => (l === 'refine' ? REFINE : l === 'plan' ? PLAN : l.startsWith('verify-plan') ? claimsOk : null),
    capturePrompt: 'refine',
    expect: ({ result, prompt, schemas }) => [
      [result.outcome === 'awaiting-plan-approval', `got ${result.outcome}`],
      [/Out of scope: NOPE/.test(prompt), 'the confirmed intent must reach Refine'],
      [/SETTLED/.test(prompt), 'Refine must be told not to reopen scope'],
      [/contradiction you find in the CODE/.test(prompt), 'blocking questions must be narrowed to code surprises'],
      [/deal 867 in the dev database/.test(prompt),
        "the user's answer to 'verify on what data' must reach Refine, or it cannot honor it"],
      // Arriving is not enough — it rides along in the intent block regardless. Refine has to be told
      // it is binding, or it will quietly verify against whatever is convenient and report success.
      [/Honor that/.test(prompt) && /silently substituting/.test(prompt),
        'Refine must be told the named data source is binding, not a suggestion'],
      [result.dataSource === 'the seeded test fixture', 'the gate must show what verification runs against'],
      // The claims contract, asserted here because this is where the plan schema is actually declared.
      [(schemas['plan']?.required || []).includes('claims'), 'the plan must be required to state its claims'],
      [['claim', 'check', 'ifWrong'].every((k) =>
        (schemas['plan']?.properties?.claims?.items?.required || []).includes(k)),
        'a claim needs the statement, the check that settles it, and what breaks if it is false'],
      [(schemas['refine']?.properties?.verifyMethod?.required || []).includes('dataSource'),
        'verifyMethod must name where the proof comes from'],
    ],
  },
  {
    name: 'first call WITHOUT intent — falls back to deriving requirements',
    args: { brief: 'b', playbookDir: '/pb', runDir: '/run' },
    responder: (l) => (l === 'refine' ? REFINE : l === 'plan' ? PLAN : l.startsWith('verify-plan') ? claimsOk : null),
    capturePrompt: 'refine',
    expect: ({ result, prompt }) => [
      [result.outcome === 'awaiting-plan-approval', `got ${result.outcome}`],
      [/Resolve the brief into a clear, terse/.test(prompt), 'must still derive requirements when no interview ran'],
      [!/SETTLED/.test(prompt), 'must not claim settled scope that nobody confirmed'],
    ],
  },
  {
    // The roll-up-weight failure, in miniature. One real run carried an acceptance target that WAS the
    // bug being fixed, so correct code could never produce it; verification ran five times and three
    // fix agents chased it, ~1.2M tokens, before ending red. Both kinds must stop at the gate — where
    // the user is standing and the fix is a sentence.
    name: 'contradictory criteria — stops before anyone builds',
    args: { brief: 'b', playbookDir: '/pb', runDir: '/run' },
    responder: (l) => (l === 'refine' ? REFINE : l === 'plan' ? PLAN
      : l === 'check-criteria' ? critIssue('contradiction') : l.startsWith('verify-plan') ? claimsOk : null),
    expect: ({ result, calls }) => [
      [result.outcome === 'needs-clarification',
        `impossible criteria are the user's to settle — got ${result.outcome}`],
      [(result.openQuestions || []).length === 1, 'the contradiction must reach the user as a question'],
      [!calls.some((c) => c.startsWith('implement')), 'nothing may be built against criteria that cannot hold'],
      [calls.includes('check-criteria'), 'the criteria must be checked at all'],
    ],
  },
  {
    name: 'unreachable numeric target — same stop, different kind',
    args: { brief: 'b', playbookDir: '/pb', runDir: '/run' },
    responder: (l) => (l === 'refine' ? REFINE : l === 'plan' ? PLAN
      : l === 'check-criteria' ? critIssue('unreachable-target') : l.startsWith('verify-plan') ? claimsOk : null),
    expect: ({ result }) => [
      [result.outcome === 'needs-clarification', `got ${result.outcome}`],
      [/Impossible target/.test((result.openQuestions || [])[0] || ''), 'the question must name what is wrong'],
    ],
  },
  {
    // The counterweight: `unverifiable` must NOT stop the run, or every feature touching production
    // data would halt at the gate. It is a caveat the user reads before approving.
    name: 'unverifiable criterion — a caveat at the gate, not a stop',
    args: { brief: 'b', playbookDir: '/pb', runDir: '/run' },
    responder: (l) => (l === 'refine' ? REFINE : l === 'plan' ? PLAN
      : l === 'check-criteria' ? critIssue('unverifiable') : l.startsWith('verify-plan') ? claimsOk : null),
    expect: ({ result }) => [
      [result.outcome === 'awaiting-plan-approval',
        `an unprovable criterion is a caveat, not a blocker — got ${result.outcome}`],
      [(result.criteriaIssues || []).length === 1, 'it must still reach the user at the gate'],
    ],
  },
  {
    // Every other signal says "keep fixing": verify is red and there are attempts left on the clock.
    // The ONLY thing that can stop the fix loop here is the impossible flag.
    name: 'verify reports an impossible target — no fix agent is sent at it',
    args: LOOP_ARGS,
    // Iterate votes CONTINUE with outstanding must-fix work, and verify is red — so every ordinary
    // signal says "run another round". Only the impossible flag can stop this.
    responder: (l) =>
      l.startsWith('implement') || l === 'polish' ? impl :
      l.startsWith('refactor') ? refac :
      l.startsWith('verify') ? vimpossible :
      l.startsWith('review') ? find(['high']) :
      iter({ decision: 'continue', mustFix: ['would otherwise continue'], polish: ['p'] }),
    expect: ({ result, calls }) => [
      [!calls.some((c) => /^implement:\d+\.fix/.test(c)),
        'no engineer may be sent to fix a criterion whose target is wrong'],
      [calls.filter((c) => /^verify:/.test(c)).length === 1,
        `verification must run once, not chase it — ran ${calls.filter((c) => /^verify:/.test(c)).length}`],
      [rounds(calls) === 1, `a wrong target cannot be fixed by another round, ran ${rounds(calls)}`],
      [result.impossibleCriteria.length === 1, 'the impossible criterion must come back to the user'],
      [result.outcome === 'needs-attention', `got ${result.outcome}`],
      [!calls.includes('polish'), 'no polish on code that is about to be reworked'],
    ],
  },
  {
    name: 'plan claims all check out — no revision, verdicts reach the gate',
    args: { brief: 'b', playbookDir: '/pb', runDir: '/run' },
    responder: (l) => (l === 'refine' ? REFINE : l === 'plan' ? PLAN : l.startsWith('verify-plan') ? claimsOk : null),
    expect: ({ result, calls }) => [
      [calls.includes('verify-plan:1'), 'the plan must be fact-checked before the human sees it'],
      [!calls.includes('plan:revised'), 'nothing was refuted — the plan must not be rewritten'],
      [calls.filter((c) => c.startsWith('verify-plan')).length === 1, 'one check is enough when it comes back clean'],
      [result.planRevised === false, 'the gate must say the plan is the first draft'],
      [(result.claimChecks || []).length === 1, 'the verdicts must reach the user, not be swallowed'],
    ],
  },
  {
    // The whole point: a false claim is caught HERE, in the window the user is waiting in, rather than
    // by an engineer four hours later with nobody to ask. The revision is capped so a stubbornly
    // refuted claim cannot spin the plan phase — it goes to the user as a caveat instead.
    name: 'plan claim refuted — revised once, then capped even if still refuted',
    args: { brief: 'b', playbookDir: '/pb', runDir: '/run' },
    responder: (l) => (l === 'refine' ? REFINE : l === 'plan' || l === 'plan:revised' ? PLAN
      : l.startsWith('verify-plan') ? claimsBad : null),
    expect: ({ result, calls }) => [
      [calls.filter((c) => c === 'plan:revised').length === 1,
        `a refuted claim must send the plan back exactly once, got ${calls.filter((c) => c === 'plan:revised').length}`],
      [calls.filter((c) => c.startsWith('verify-plan')).length === 2,
        'the revised plan must itself be re-checked'],
      [result.planRevised === true, 'the gate must say the plan was corrected'],
      [result.outcome === 'awaiting-plan-approval',
        `a refuted claim is fixed and reported, never a dead end — got ${result.outcome}`],
    ],
  },
  {
    name: 'reviewer is told to write for a human who will not read the diff',
    args: LOOP_ARGS,
    responder: (l) =>
      l.startsWith('implement') || l === 'polish' ? impl :
      l.startsWith('refactor') ? refac :
      l.startsWith('verify') ? vpass :
      l.startsWith('review') ? find(['low']) : iter({}),
    capturePrompt: 'review:reviewer:1',
    expect: ({ prompt }) => [
      [/soWhat/.test(prompt), 'the reviewer must be asked for a plain-language consequence'],
      [/No file names, no function or symbol names/.test(prompt),
        'the rule banning identifiers from soWhat must reach the reviewer'],
      [/vocabulary to write/.test(prompt),
        'the reviewer must be pointed at the requirements as the vocabulary to use'],
    ],
  },
  {
    // Validation above proves stubs MATCH the schemas — it cannot notice a schema being loosened,
    // because the stub would still supply the dropped field. These assert the contract itself, so
    // deleting a required field from feature-loop.js fails here instead of silently degrading every
    // future report back into code-speak.
    name: 'schema contract — the plain-language fields stay required',
    args: LOOP_ARGS,
    responder: (l) =>
      l.startsWith('implement') || l === 'polish' ? impl :
      l.startsWith('refactor') ? refac :
      l.startsWith('verify') ? vpass :
      l.startsWith('review') ? find(['low']) : iter({}),
    expect: ({ schemas }) => {
      const findings = schemas['review:reviewer:1']?.properties?.findings?.items?.required || []
      const impl1 = schemas['implement:1']?.properties || {}
      const esc = impl1.escalations?.items?.required || []
      const punt = impl1.punted?.items?.required || []
      const it = schemas['iterate:1']?.properties || {}
      return [
        [findings.includes('soWhat'), 'findings must require soWhat — it is what the human reads'],
        [findings.includes('severity'), 'findings must require severity — the loop routes on it'],
        [esc.includes('soWhat'), 'escalations must require soWhat'],
        [punt.includes('item') && punt.includes('reason'), 'punted items must require item and reason'],
        [(it.deferred?.items?.required || []).includes('soWhat'), 'deferred items must require soWhat'],
        [!!it.mustFix && !!it.polish, 'Iterate must keep mustFix and polish separate — merging them restores the churn'],
        // Verify has to be able to say "the target is wrong" distinctly from "this is failing", or an
        // unreachable criterion reads as ordinary breakage and gets fix agents thrown at it.
        [['criterion', 'why'].every((k) =>
          (schemas['verify:1.0']?.properties?.impossible?.items?.required || []).includes(k)),
          'an impossible criterion must name itself and say why it cannot be met'],
      ]
    },
  },
  {
    name: 'standalone — no inlined args, falls back to loader agents',
    args: { brief: 'b', playbookDir: '/pb', runDir: '/run', startFrom: 'implement' },
    responder: (l) =>
      l === 'load-approved' ? APPROVED :
      l === 'roster' ? { reviewers: [] } :
      l.startsWith('implement') || l === 'polish' ? impl :
      l.startsWith('refactor') ? refac :
      l.startsWith('verify') ? vpass :
      l.startsWith('review') ? find(['low']) : iter({}),
    expect: ({ calls }) => [
      [calls.includes('load-approved'), 'must load the approved artifacts when not handed them'],
      [calls.includes('roster'), 'must read the roster when not handed it'],
    ],
  },
]

// ── runner ──────────────────────────────────────────────────────────────────
let failed = 0
for (const s of scenarios) {
  let prompt = ''
  const responder = (label, p) => {
    if (s.capturePrompt && label === s.capturePrompt) prompt = p
    return s.responder(label, p)
  }
  let out
  try {
    out = await drive(s.args, responder)
  } catch (e) {
    console.log(`✗ ${s.name}\n    threw: ${e.message}`)
    failed++
    continue
  }
  // Schema conformance is asserted for every scenario, not opt-in per scenario.
  const checks = [
    [out.schemaErrors.length === 0, `stub/schema mismatch:\n      ${out.schemaErrors.join('\n      ')}`],
    ...s.expect({ ...out, prompt }),
  ]
  const bad = checks.filter(([ok]) => !ok)
  if (bad.length) {
    failed++
    console.log(`✗ ${s.name}`)
    for (const [, msg] of bad) console.log(`    ${msg}`)
    console.log(`    agents: ${out.calls.join(' | ')}`)
  } else {
    console.log(`✓ ${s.name}${VERBOSE ? `\n    ${out.calls.join(' | ')}` : ''}`)
  }
}

console.log(`\n${scenarios.length - failed}/${scenarios.length} scenarios passed`)
process.exit(failed ? 1 : 0)
