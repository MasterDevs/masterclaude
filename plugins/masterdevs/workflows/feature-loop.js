export const meta = {
  name: 'masterdevs-feature-loop',
  description: 'One RPI-style loop in a single worktree: Refine the requirements, Plan the design (strongest model) then STOP for human approval, and on the second call Implement → Refactor → Verify against success criteria → Review the new code → Iterate, repeating Implement→Refactor→Verify→Review until the review has nothing worth acting on (or a cap). Each phase runs in a fresh context seeded by the prior phase\'s terse artifact, so context stays small and cheap.',
  phases: [
    { title: 'Refine', detail: 'clarify requirements, research code/specs, define success criteria' },
    { title: 'Plan', detail: 'handoff-ready implementation plan (playbook patterns + lessons)' },
    { title: 'Implement', detail: 'build the plan step by step' },
    { title: 'Refactor', detail: 'catch refactor opportunities the implementation created' },
    { title: 'Verify', detail: 'exercise against success criteria; re-implement until it passes' },
    { title: 'Review', detail: 'one combined reviewer (+ your roster) over the new code only' },
    { title: 'Iterate', detail: 'decide whether to loop again; record what was deferred' },
  ],
}

// ── args (resolved by the feature skill) ──
// { brief, playbookDir, rosterPath, runDir }  — runDir: a scratch dir for human-readable artifacts.
let input = args || {}
if (typeof input === 'string') {
  try { input = JSON.parse(input) } catch (e) {
    throw new Error('feature-loop: args arrived as a non-JSON string — pass it as an object: ' + e.message)
  }
}
const { brief, playbookDir, rosterPath, runDir } = input
if (!brief || !playbookDir) {
  throw new Error('feature-loop requires args.brief and args.playbookDir — got keys: [' + Object.keys(input).join(', ') + ']')
}

const MAX_ITERATIONS = 3       // outer Implement→Refactor→Verify→Review→Iterate loop
const MAX_VERIFY_FIX = 2       // inner Verify↔Implement loop
const BLOCKING = new Set(['critical', 'high'])
const reqPath = runDir ? `${runDir}/requirements.md` : null
const planFilePath = runDir ? `${runDir}/plan.md` : null

// ── Schemas ────────────────────────────────────────────────────────────────
const REFINE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['requirements', 'successCriteria', 'verifyMethod', 'openQuestions'],
  properties: {
    requirements: { type: 'string' },                 // terse, resolved statement of what to build
    openQuestions: { type: 'array', items: { type: 'string' } }, // blocking ambiguities/contradictions
    researchNotes: { type: 'string' },
    successCriteria: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['name', 'kind', 'check'],
      properties: {
        name: { type: 'string' },
        kind: { type: 'string', enum: ['happy', 'failure', 'edge'] },
        check: { type: 'string' },                    // how to prove it (test/endpoint/command)
      },
    } },
    verifyMethod: {
      type: 'object', additionalProperties: false, required: ['approach', 'riskySteps'],
      properties: {
        approach: { type: 'string' },                 // how Verify should exercise this feature live
        riskySteps: { type: 'array', items: { type: 'string' } }, // destructive/irreversible — need approval
      },
    },
  },
}

const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'steps', 'lenses'],
  properties: {
    summary: { type: 'string' },
    lenses: { type: 'array', items: { type: 'string' } },
    steps: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['title', 'intent', 'files', 'acceptance'],
      properties: {
        title: { type: 'string' }, intent: { type: 'string' },
        files: { type: 'array', items: { type: 'string' } },
        // Resolved, inlined design guidance so the engineer never loads the catalog.
        guidance: { type: 'array', items: { type: 'string' } },
        acceptance: { type: 'array', items: { type: 'string' } },
      },
    } },
  },
}

const IMPLEMENT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['status', 'changedFiles', 'notes'],
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    changedFiles: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

const REFACTOR_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['changedFiles', 'applied', 'notes'],
  properties: {
    changedFiles: { type: 'array', items: { type: 'string' } },
    applied: { type: 'array', items: { type: 'string' } },   // refactors performed
    notes: { type: 'string' },
  },
}

const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['passed', 'results', 'failures'],
  properties: {
    passed: { type: 'boolean' },
    ranLive: { type: 'boolean' },
    results: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['name', 'passed'],
      properties: { name: { type: 'string' }, passed: { type: 'boolean' }, detail: { type: 'string' } },
    } },
    failures: { type: 'array', items: { type: 'string' } },           // concrete failing behaviors to fix
    needsApprovalFor: { type: 'array', items: { type: 'string' } },   // risky steps it declined to run
  },
}

const FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['findings'],
  properties: {
    findings: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['severity', 'lens', 'file', 'line', 'summary', 'fix'],
      properties: {
        severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        lens: { type: 'string' },                     // security | performance | design | correctness | ...
        file: { type: 'string' }, line: { type: 'integer' },
        summary: { type: 'string' }, fix: { type: 'string' },
      },
    } },
  },
}

const ITERATE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['decision', 'straightforward', 'conflicts', 'deferred'],
  properties: {
    decision: { type: 'string', enum: ['continue', 'stop'] },
    rationale: { type: 'string' },
    straightforward: { type: 'array', items: { type: 'string' } }, // revisions safe to just implement
    conflicts: { type: 'array', items: {                            // clash with requirements/plan → user decides
      type: 'object', additionalProperties: false, required: ['finding', 'conflictsWith'],
      properties: { finding: { type: 'string' }, conflictsWith: { type: 'string' } },
    } },
    deferred: { type: 'array', items: {                             // decided NOT to address (recorded)
      type: 'object', additionalProperties: false, required: ['finding', 'reason'],
      properties: { finding: { type: 'string' }, reason: { type: 'string' } },
    } },
  },
}

const playbookNote =
  `Playbook root: ${playbookDir}. Pattern catalogs: ${playbookDir}/patterns/<domain>/catalog.md (match "Reach for when", ` +
  `honor "Skip when"). Lessons: ${playbookDir}/lessons/<lens>.md. Stage new candidates ONLY to ` +
  `${playbookDir}/patterns/<domain>/candidates.md or ${playbookDir}/lessons/<lens>.candidates.md — never a promoted lane.`

const merge = (a, b) => [...new Set([...(a || []), ...(b || [])])]

// Intra-agent context discipline: keeps a single agent lean so it stays in the model's effective zone and
// any runtime auto-compaction is lossless (durable state is already externalized). Appended to the phases
// most prone to context growth (broad research, multi-file implementation, command-heavy verification).
const CONTEXT_DISCIPLINE =
  `\n\nContext discipline: work lean. Read targeted sections (grep, specific symbols) rather than whole large ` +
  `files; externalize durable findings to the artifact or code AS YOU GO instead of holding them in context; ` +
  `keep only what the current step needs. If your context grows large, summarize what you've established into ` +
  `the artifact and continue from that summary rather than re-reading everything.`

// Two calls: the first runs Refine+Plan and STOPS for human plan approval; the second (startFrom:
// 'implement') loads the approved (possibly human-edited) artifacts and runs the Implement→Iterate loop.
const startFrom = input.startFrom || 'refine'
let refine, plan

if (startFrom === 'implement') {
  // ── Resume after plan approval: load the (possibly human-edited) artifacts ──
  phase('Plan')
  const loaded = await agent(
    `Read these two artifact files and return their trailing structured data. Parse the fenced \`\`\`json block ` +
    `at the end of each — it is authoritative and may have been human-edited since approval. Modify nothing.\n` +
    `1) Requirements: ${reqPath}\n2) Plan: ${planFilePath}\nReturn {refine, plan}.`,
    { label: 'load-approved', phase: 'Plan', agentType: 'general-purpose', model: 'sonnet',
      schema: { type: 'object', additionalProperties: false, required: ['refine', 'plan'],
        properties: { refine: REFINE_SCHEMA, plan: PLAN_SCHEMA } } }
  )
  if (!loaded || !loaded.refine || !loaded.plan) throw new Error(`Could not load approved artifacts from ${runDir}`)
  refine = loaded.refine
  plan = loaded.plan
} else {
  // ── Phase: Refine ──
  phase('Refine')
  refine = await agent(
    `You are refining requirements for a feature — objective research only, no implementation opinions yet.\n\n` +
    `Feature brief:\n${brief}\n\n` +
    `Read the relevant code, specs, product/UI notes, and existing behavior. Resolve the brief into a clear, terse ` +
    `\`requirements\` statement. Surface \`openQuestions\` ONLY for genuine blocking ambiguities or contradictions ` +
    `you cannot resolve from the code/specs (leave empty if none). Define \`successCriteria\` — concrete happy / ` +
    `failure / edge behaviors with how to prove each — and a \`verifyMethod\`: how to exercise this feature live ` +
    `(app, endpoints, integration), listing any \`riskySteps\` that are destructive/irreversible and must not run ` +
    `without human approval.\n` +
    (reqPath ? `Also write a concise human-readable version to ${reqPath}, ending with the EXACT structured result in a fenced \`\`\`json block (so a later call can reload it).\n` : ``) + CONTEXT_DISCIPLINE,
    { label: 'refine', phase: 'Refine', schema: REFINE_SCHEMA, agentType: 'general-purpose', model: 'sonnet' }
  )
  if (!refine) throw new Error('Refine produced no output')
  if (refine.openQuestions && refine.openQuestions.length) {
    log(`Refine has ${refine.openQuestions.length} blocking question(s) — stopping for the user`)
    return { outcome: 'needs-clarification', openQuestions: refine.openQuestions, requirements: refine.requirements, requirementsPath: reqPath }
  }
  log(`requirements resolved; ${refine.successCriteria.length} success criteria`)

  // ── Phase: Plan (strongest model) ──
  phase('Plan')
  plan = await agent(
    `You are the Architect. Produce a handoff-ready implementation plan for another engineer to execute.\n\n` +
    `Requirements:\n${refine.requirements}\n\n` +
    `Success criteria:\n${JSON.stringify(refine.successCriteria, null, 2)}\n\n` +
    `${playbookNote}\n\n` +
    `Prioritize, in order: correct design patterns, modularity, reusability, maintainability, readability. RESOLVE ` +
    `the design — for each step inline concrete \`guidance\` (the pattern/refactor and HOW to apply it here), so the ` +
    `engineer never loads the catalog. Reuse existing abstractions over inventing new ones. Be TERSE — a spec, not ` +
    `an essay; the plan is re-read each iteration. Order steps for a single engineer to build in one pass.\n` +
    (planFilePath ? `Also write a concise human-readable plan to ${planFilePath}, ending with the EXACT structured result in a fenced \`\`\`json block (so the approved plan can be reloaded, and a human can edit it before approving).\n` : ``),
    { label: 'plan', phase: 'Plan', schema: PLAN_SCHEMA, agentType: 'masterdevs:architect', model: 'opus' }
  )
  if (!plan || !plan.steps || plan.steps.length === 0) throw new Error('Plan produced no steps')

  // STOP for human plan approval — the Implement→Iterate loop runs on the next call (startFrom:'implement').
  log('Plan written — stopping for human approval')
  return {
    outcome: 'awaiting-plan-approval',
    summary: plan.summary,
    stepCount: plan.steps.length,
    requirementsPath: reqPath,
    planPath: planFilePath,
    outputTokens: (typeof budget !== 'undefined' && budget) ? budget.spent() : undefined,
  }
}

const planBlock = `Plan summary: ${plan.summary}\n\nSteps:\n` + plan.steps.map((s, i) =>
  `${i + 1}. ${s.title}\n   intent: ${s.intent}\n   files: ${(s.files || []).join(', ')}\n   guidance: ${(s.guidance || []).join(' | ') || '—'}\n   acceptance: ${(s.acceptance || []).join('; ')}`
).join('\n')

// ── Setup: user-added reviewers (default is the one combined reviewer) ──────
const userReviewers = (await agent(
  `Read ${playbookDir}/rosters/reviewers.user.json if it exists and return its array as {reviewers:[...]} ` +
  `(each {name, agentType, model}); if absent or empty return {reviewers:[]}. Read only — modify nothing.`,
  { label: 'roster', phase: 'Plan', agentType: 'general-purpose', model: 'sonnet', schema: {
    type: 'object', additionalProperties: false, required: ['reviewers'],
    properties: { reviewers: { type: 'array', items: { type: 'object', additionalProperties: true,
      required: ['name', 'agentType', 'model'],
      properties: { name: { type: 'string' }, agentType: { type: 'string' }, model: { type: 'string' } } } } },
  } }
)) || { reviewers: [] }
const reviewPanel = [
  { name: 'reviewer', agentType: 'masterdevs:reviewer', model: 'opus' },
  ...(userReviewers.reviewers || []),
]

// ── The loop: Implement → Refactor → Verify → Review → Iterate ──────────────
let changedFiles = []
let revisions = []                 // straightforward fixes fed back into Implement
const deferred = []                // recorded, not addressed
const conflicts = []               // clash with requirements/plan → user decides
let iteration = 0
let lastFindings = []
let verifyPassed = false
let verifyNeedsApproval = []
// Rationale breadcrumb threaded forward so each fresh agent inherits the prior agent's key decisions
// (its intent) WITHOUT inheriting its whole context — continuity of intent, not of tokens.
let carryNotes = ''
const notesBlock = () => carryNotes ? `\n\nPrior agent's notes/rationale (why earlier choices were made — respect them):\n${carryNotes}` : ''

while (iteration < MAX_ITERATIONS) {
  iteration++

  // ── Implement ──
  phase('Implement')
  const implPrompt = iteration === 1
    ? `Implement this plan in the CURRENT worktree, step by step, in one pass. Follow the plan's guidance exactly; ` +
      `reuse existing abstractions; write tests alongside the code. If a step's plan is wrong (file not shaped as ` +
      `described, pattern doesn't fit), set status="blocked" and explain — do NOT silently redesign.\n\n` +
      `Requirements:\n${refine.requirements}\n\n${planBlock}`
    : `Apply ONLY these approved revisions to the existing implementation in the current worktree, then report ` +
      `changed files. Keep tests green. Stay in scope.\n\nRevisions:\n${revisions.map((r) => `- ${r}`).join('\n')}\n\n` +
      `(Plan context)\n${planBlock}` + notesBlock()
  const implFull = implPrompt + CONTEXT_DISCIPLINE
  const impl = await agent(implFull, {
    label: `implement:${iteration}`, phase: 'Implement',
    agentType: 'masterdevs:engineer', model: 'opus', schema: IMPLEMENT_SCHEMA,
  })
  if (!impl) return { outcome: 'error', iteration, notes: 'implement returned no result' }
  if (impl.status === 'blocked') return { outcome: 'blocked', iteration, notes: impl.notes }
  changedFiles = merge(changedFiles, impl.changedFiles)
  if (impl.notes) carryNotes = impl.notes

  // ── Refactor ──
  phase('Refactor')
  const refactor = await agent(
    `Review the plan and the current implementation for refactoring opportunities the implementation may have ` +
    `introduced — duplication, a helper that wants extracting, a seam in the wrong place, dead code. Apply only ` +
    `SAFE, behavior-preserving refactors in scope; keep tests green. Stage any recurring pattern as a candidate ` +
    `(never a promoted lane).\n\nChanged files: ${changedFiles.join(', ')}\n${playbookNote}`,
    { label: `refactor:${iteration}`, phase: 'Refactor', agentType: 'masterdevs:engineer', model: 'sonnet', schema: REFACTOR_SCHEMA }
  )
  if (refactor) { changedFiles = merge(changedFiles, refactor.changedFiles); if (refactor.notes) carryNotes = refactor.notes }

  // ── Verify (inner Verify↔Implement loop) ──
  phase('Verify')
  let verify = null
  let vAttempt = 0
  while (true) {
    verify = await agent(
      `Exercise the implementation against the success criteria and report pass/fail per criterion. Run the test ` +
      `suite, then exercise it LIVE per the verify method (boot the app, hit endpoints, run integration) — but do ` +
      `NOT run any risky/destructive step; list those under needsApprovalFor instead.\n\n` +
      `Success criteria:\n${JSON.stringify(refine.successCriteria, null, 2)}\n\n` +
      `Verify method:\n${JSON.stringify(refine.verifyMethod, null, 2)}\n\n` +
      `Changed files: ${changedFiles.join(', ')}\n` +
      `Return concrete \`failures\` (the exact failing behaviors) so they can be fixed.` + CONTEXT_DISCIPLINE,
      { label: `verify:${iteration}.${vAttempt}`, phase: 'Verify', agentType: 'general-purpose', model: 'sonnet', schema: VERIFY_SCHEMA }
    )
    verifyNeedsApproval = (verify && verify.needsApprovalFor) || []
    if (!verify || verify.passed || vAttempt >= MAX_VERIFY_FIX) break
    vAttempt++
    log(`verify fix ${vAttempt}/${MAX_VERIFY_FIX} (${verify.failures.length} failing)`)
    const fix = await agent(
      `Verification failed. Fix ONLY these failing behaviors in the current worktree, then report changed files. ` +
      `Keep the rest of the tests green.\n\nFailures:\n${verify.failures.map((f) => `- ${f}`).join('\n')}\n\n${planBlock}` + notesBlock(),
      { label: `implement:${iteration}.fix${vAttempt}`, phase: 'Verify', agentType: 'masterdevs:engineer', model: 'opus', schema: IMPLEMENT_SCHEMA }
    )
    if (!fix || fix.status === 'blocked') break
    changedFiles = merge(changedFiles, fix.changedFiles)
    if (fix.notes) carryNotes = fix.notes
  }
  verifyPassed = !!(verify && verify.passed)

  // ── Review (one combined reviewer + user roster; new code only) ──
  phase('Review')
  const reviewResults = await parallel(reviewPanel.map((r) => async () => {
    const out = await agent(
      `Review ONLY the new/changed code for this feature — security, performance, design/modularity, and ` +
      `correctness. Changed files: ${changedFiles.join(', ')}.\n` +
      `Requirements (context):\n${refine.requirements}\n` +
      `Adversarial stance: report only defects that survive scrutiny. Stage any recurring-miss lesson to ` +
      `${playbookDir}/lessons/<lens>.candidates.md (never a promoted lane). Return findings.`,
      { label: `review:${r.name}:${iteration}`, phase: 'Review', agentType: r.agentType, model: r.model, schema: FINDINGS_SCHEMA }
    )
    return (out && out.findings) ? out.findings : []
  }))
  lastFindings = reviewResults.flat()

  // ── Iterate (decide; partition findings) ──
  phase('Iterate')
  const iter = await agent(
    `Decide whether to run the loop again. You are given this round's review findings plus verify status.\n\n` +
    `Findings:\n${JSON.stringify(lastFindings, null, 2)}\n\n` +
    `Verify passed: ${verifyPassed}. Iteration ${iteration}/${MAX_ITERATIONS}.\n` +
    `Requirements + plan (to judge conflicts):\n${refine.requirements}\n${plan.summary}\n\n` +
    `Partition the findings: \`straightforward\` = revisions safe to just implement (in-scope, no requirement/plan ` +
    `change); \`conflicts\` = anything that clashes with the requirements or plan (the USER must decide these — do ` +
    `not action them); \`deferred\` = low-value / not worth addressing, with a reason. decision="continue" only if ` +
    `there are blocking (high/critical) findings OR worthwhile straightforward revisions AND iterations remain; ` +
    `otherwise "stop".`,
    { label: `iterate:${iteration}`, phase: 'Iterate', agentType: 'general-purpose', model: 'sonnet', schema: ITERATE_SCHEMA }
  )
  if (!iter) break
  deferred.push(...(iter.deferred || []))
  conflicts.push(...(iter.conflicts || []))
  revisions = iter.straightforward || []
  const hasBlocking = lastFindings.some((f) => BLOCKING.has(f.severity))
  if (iter.decision === 'stop' || (!revisions.length && !hasBlocking)) break
}

const unresolvedBlocking = lastFindings.filter((f) => BLOCKING.has(f.severity))
return {
  outcome: (verifyPassed && unresolvedBlocking.length === 0 && conflicts.length === 0) ? 'passed' : 'needs-attention',
  iterations: iteration,
  changedFiles,
  verifyPassed,
  verifyNeedsApproval,        // risky steps Verify declined to run — need human
  conflicts,                  // clash with requirements/plan — user decides
  deferred,                   // recorded, intentionally not addressed
  unresolvedBlocking,         // high/critical findings still open after the cap
  requirementsPath: reqPath,
  planPath: planFilePath,
  outputTokens: (typeof budget !== 'undefined' && budget) ? budget.spent() : undefined,
}
