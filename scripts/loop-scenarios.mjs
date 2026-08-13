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
  verifyMethod: { approach: 'a', riskySteps: [] },
}
const PLAN = {
  summary: 's', lenses: ['correctness'],
  steps: [{ title: 't', intent: 'i', files: ['f.py'], guidance: ['g'], acceptance: ['a'] }],
}
const APPROVED = { refine: REFINE, plan: PLAN }

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
    name: 'first call WITH confirmed intent — scope arrives settled',
    args: { brief: 'b', playbookDir: '/pb', runDir: '/run',
      intent: { outcome: 'O', user: 'U', whyNow: 'W', success: 'S', constraint: 'C', outOfScope: 'NOPE' } },
    responder: (l) => (l === 'refine' ? REFINE : l === 'plan' ? PLAN : null),
    capturePrompt: 'refine',
    expect: ({ result, prompt }) => [
      [result.outcome === 'awaiting-plan-approval', `got ${result.outcome}`],
      [/Out of scope: NOPE/.test(prompt), 'the confirmed intent must reach Refine'],
      [/SETTLED/.test(prompt), 'Refine must be told not to reopen scope'],
      [/contradiction you find in the CODE/.test(prompt), 'blocking questions must be narrowed to code surprises'],
    ],
  },
  {
    name: 'first call WITHOUT intent — falls back to deriving requirements',
    args: { brief: 'b', playbookDir: '/pb', runDir: '/run' },
    responder: (l) => (l === 'refine' ? REFINE : l === 'plan' ? PLAN : null),
    capturePrompt: 'refine',
    expect: ({ result, prompt }) => [
      [result.outcome === 'awaiting-plan-approval', `got ${result.outcome}`],
      [/Resolve the brief into a clear, terse/.test(prompt), 'must still derive requirements when no interview ran'],
      [!/SETTLED/.test(prompt), 'must not claim settled scope that nobody confirmed'],
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
