export const meta = {
  name: 'masterdevs-feature-loop',
  description: 'One RPI-style loop in a single worktree: Refine the requirements, Plan the design (strongest model) then STOP for human approval, and on the second call Implement → Refactor → (Verify ∥ Review) → Iterate. The loop repeats ONLY while critical/high findings or a failed verification remain; medium/low findings are batched into a single closing Polish pass instead of buying another full round. Each phase runs in a fresh context seeded by the prior phase\'s terse artifact, so context stays small and cheap.',
  phases: [
    { title: 'Refine', detail: 'clarify requirements, research code/specs, define success criteria' },
    { title: 'Plan', detail: 'handoff-ready implementation plan (playbook patterns + lessons)' },
    { title: 'Implement', detail: 'build the plan step by step' },
    { title: 'Refactor', detail: 'catch refactor opportunities the implementation created' },
    { title: 'Verify', detail: 'exercise against success criteria (runs alongside Review)' },
    { title: 'Review', detail: 'one combined reviewer (+ your roster) over the new code only' },
    { title: 'Iterate', detail: 'loop again only for critical/high or a failed verify; batch the rest' },
    { title: 'Polish', detail: 'apply the batched medium/low revisions once, then re-check' },
  ],
}

// ── args (resolved by the feature skill) ──
// { brief, playbookDir, rosterPath, runDir }  — runDir: a scratch dir for human-readable artifacts.
// On the FIRST call the skill also passes:
//   intent: {outcome, user, whyNow, success, constraint, outOfScope} — confirmed with the user in the
//           skill's interview. Settled scope; Refine researches against it instead of re-deriving it.
// On the second call the skill also passes:
//   approved:      {refine, plan}   — the approved artifacts, already parsed (saves an agent spawn)
//   userReviewers: [{name, agentType, model}] — the user roster, already read (saves an agent spawn)
// All three fall back gracefully when absent, so the workflow still runs standalone.
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

// Confirmed intent from the skill's interview, rendered for the Refine prompt. Accepts the structured
// object or a pre-formatted restate string.
const intent = input.intent || null
const intentBlock = !intent ? '' : (typeof intent === 'string' ? intent : [
  ['Outcome', intent.outcome], ['User', intent.user], ['Why now', intent.whyNow],
  ['Success', intent.success], ['Constraint', intent.constraint], ['Out of scope', intent.outOfScope],
  ['Verify on', intent.verifyOn],
].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n'))

// Two rounds, not three. Measured across real runs: rounds 2 and 3 cost 50-67% of the budget while the
// findings list never shrank monotonically (one run's criticals doubled in round 2; another's round-3 pass
// broke a verification that had passed twice). Extra rounds churn rather than converge, so the loop now
// buys another round only for critical/high findings or a failed verify — nits go to the Polish pass.
const MAX_ITERATIONS = 2       // outer Implement→Refactor→(Verify ∥ Review)→Iterate loop
const MAX_VERIFY_FIX = 2       // inner Verify↔Implement loop
const MAX_PLAN_REVISIONS = 1   // Plan↔fact-check loop, before the human ever sees the plan
const BLOCKING = new Set(['critical', 'high'])
const reqPath = runDir ? `${runDir}/requirements.md` : null
const planFilePath = runDir ? `${runDir}/plan.md` : null

// Verification is the most expensive phase in the system — 22% of an average run's tokens, more than
// Implement — and its cost curve is flat: the fifth pass costs as much as the first, because every pass
// re-derives how to run this repo from scratch. Measured over 100 verify agents: 53 tool calls each at
// only 2.5K tokens per call, the most exploratory profile of any phase. The ones that spiral do ~2x
// that (p90 of 229 tool calls) and then hit a wall and get retried from zero — retried agents burned
// 8.7M tokens across all runs, 11% of everything, and 8 of them returned no result at all.
//
// So Verify writes down what it learns, in two places with different lifetimes:
const verifyLogPath = runDir ? `${runDir}/verify-log.md` : null
// ...and how to operate THIS REPO, which is stable across every future run. runDir is
// `<data>/runs/<repo-slug>/<run-id>/`, so its parent is the natural per-repo home. Cross-run learning
// in the same spirit as the Playbook: the second feature in a repo should not rediscover its test command.
const repoNotesPath = runDir ? `${runDir}/../verify-repo-notes.md` : null

// What Verify should already know before it touches anything, and what it owes the next pass.
// The first verification of a run pays the discovery cost; nothing after it should pay again.
const verifyMemory = !verifyLogPath ? `` :
  `\n**Read these before running anything** (either may be absent — then you are the one who creates it):\n` +
  `- ${repoNotesPath} — how to operate THIS REPO: the env setup, how to reach the app or database and how\n` +
  `  to authenticate (seeded test account or dev login), and the\n` +
  `  FASTEST correct way to run tests — the full suite (with its measured runtime), a scoped subset, one\n` +
  `  test — plus what makes runs slow here and when expensive setup (say, a fresh test database) is truly\n` +
  `  required versus reusable. Stable across features. TRUST IT; do not re-derive it.\n` +
  `- ${verifyLogPath} — this run's log: which criteria already passed, and how each was proven.\n\n` +
  `**Then update both**, before you return:\n` +
  `- If anything in the repo notes was wrong or missing, correct it — a stale note costs every future run.\n` +
  `  Keep it short and command-shaped. No feature specifics; they do not generalize.\n` +
  `  If you proved a faster correct invocation than the notes record (a parallel runner mode, reusing\n` +
  `  expensive setup instead of rebuilding it, a narrower scope that proves the same thing), record it WITH\n` +
  `  its measured runtime — the notes should always name the fastest invocation anyone has proven correct.\n` +
  `- Append this pass to the run log: per criterion, the verdict and the exact command that settled it.\n\n` +
  `**Do not go exploring.** If the notes tell you how to run something, run it. If they do not, work it out\n` +
  `ONCE, write it down, and move on. Verification that goes spelunking is the single most expensive failure\n` +
  `mode here: agents that do roughly twice the normal number of tool calls run out of room and get restarted\n` +
  `from nothing, which has cost more than any other single thing this loop does. If you genuinely cannot\n` +
  `establish how to exercise a criterion, mark it unproven with the reason and return — that is a useful\n` +
  `result. Burning the budget hunting for it is not.\n`

// The full test suite is the other place verification money goes — as wall clock, not tokens. Transcript
// analysis across three real runs: one suite run is minutes of pure wait in a real repo, it was being run
// dozens of times per round by every kind of agent, and suite runs plus the loops polling them were
// 70-90% of ALL tool-execution time — the single largest wall-clock cost in the system. Two rules fix
// that without naming any language or test runner:
//   1. Exactly ONE full-suite gate per round, owned by Verify. Mutating agents run scoped tests only.
//   2. A suite pass is a fact about a tree state. Fingerprint the tree when the suite goes green, and
//      never re-run the suite on a fingerprint that already passed.
// The fingerprint is exact and leaves the worktree and real index untouched: it stages the worktree
// (untracked files included, .gitignore respected) into a THROWAWAY index and hashes the resulting tree.
// (It does write throwaway objects into .git/objects — harmless, gc reclaims them.)
// (`mktemp -u` on purpose: git refuses a pre-created empty file as an index, so hand it a fresh name.
// stderr stays visible so a failure is diagnosable, and rm runs even when a step fails.)
const FINGERPRINT_CMD =
  `IDX="$(mktemp -u)"; GIT_INDEX_FILE="$IDX" git add -A >/dev/null && GIT_INDEX_FILE="$IDX" git write-tree; rm -f "$IDX"`

const SUITE_GATE_RULE =
  `\n\n**The full-suite gate.** The full test suite runs only in Verify, and never on a tree it has ` +
  `already passed on — every other agent runs scoped tests only. Before running it, compute the worktree ` +
  `fingerprint (leaves the worktree and real index untouched — it stages into a throwaway index):\n` +
  `  ${FINGERPRINT_CMD}\n` +
  (verifyLogPath
    ? `If the most recent \`suite-green:\` line in ${verifyLogPath} records this exact fingerprint, the ` +
      `suite already passed on this tree — carry it forward as passing instead of re-running it, and note ` +
      `that in the log. `
    : ``) +
  `When the suite passes, recompute the fingerprint — a suite that writes artifacts (coverage files, ` +
  `snapshots) changes the tree, and only the post-run hash is true afterwards` +
  (verifyLogPath
    ? `. Append \`suite-green: <post-run fingerprint> (<suite command>, <runtime>)\` to that log — noting ` +
      `when it differs from the pre-run hash — and `
    : `, and `) +
  `return it as \`suiteFingerprint\` (omit it when the suite did not pass or did not run).`

// A real run changed the user's password so it could log in and verify — locking the user out of their
// own app mid-test. "Risky/destructive" doesn't catch that: it's reversible and it serves the check.
const SHARED_STATE_RULE =
  `\n\nThe local app and database are the user's live workspace — they may be using them right now. ` +
  `Existing data, accounts, and credentials are read-only. Never change a password or take over an ` +
  `account to get access. Need state? Create new, clearly-labeled throwaway records and log them. ` +
  `Anything that would alter existing state goes in \`needsApprovalFor\`. ` +
  `If live verification needs a login you can't obtain via a seeded test account or self-service path, ` +
  `mark those criteria unproven with the blocking reason and return — never wait on the user, never ` +
  `borrow an existing account.`

// Appended to every agent that MUTATES the tree (implement, refactor, verify-fix, polish). Verify gets
// SUITE_GATE_RULE instead — the two rules are the same policy seen from either side of the gate.
const TEST_SCOPE_RULE =
  `\n\nTests: run ONLY tests scoped to what you touched — the tests for your changed code and any directly ` +
  `affected neighbors. Do NOT run the repository's full test suite, not even once "to be safe": a dedicated ` +
  `Verify agent owns it as the round's regression gate, and a full-suite run here is minutes ` +
  `of pure wait that buys nothing the gate won't.` +
  (repoNotesPath
    ? ` Before your first test run, read ${repoNotesPath} (may be absent) — it records this repo's fastest ` +
      `proven test invocations: scoped runs, one test, which expensive setup is reusable. If you prove a ` +
      `faster correct invocation than it records, update it with the measured runtime.`
    : ``)

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
      type: 'object', additionalProperties: false, required: ['approach', 'dataSource', 'riskySteps'],
      properties: {
        approach: { type: 'string' },                 // how Verify should exercise this feature live
        // WHERE the proof comes from. The most common way a finished run fails to prove anything is
        // that the check needed data this checkout does not have: "confirmed only against the local
        // database, which holds a single deal", "needs real customer deal data that does not exist
        // locally". Naming the source makes that gap visible at the approval gate instead of at the end.
        dataSource: { type: 'string' },
        riskySteps: { type: 'array', items: { type: 'string' } }, // destructive/irreversible — need approval
      },
    },
  },
}

// Facts about the code that the plan rests on. A plan built on a false one sends an engineer down a
// dead end hours later with nobody watching — measured across real runs, the plan asserting something
// untrue about the code is one of the largest sources of mid-run surprise: it named three readers of a
// value where there were five, prescribed an attribute that exists only on IPv6 (crashing every IPv4
// call), claimed invariants "already exempt" something they didn't, and estimated four affected test
// files where there were roughly five hundred failing tests. Every one of those is settleable by a grep.
const CLAIMS = { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['claim', 'check', 'ifWrong'],
  properties: {
    claim: { type: 'string' },    // a falsifiable statement about the code as it exists TODAY
    check: { type: 'string' },    // the exact command or file+symbol read that settles it
    ifWrong: { type: 'string' },  // which step breaks, and how
  },
} }

const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'steps', 'lenses', 'claims'],
  properties: {
    summary: { type: 'string' },
    lenses: { type: 'array', items: { type: 'string' } },
    claims: CLAIMS,
    steps: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['title', 'intent', 'files', 'acceptance', 'reuse'],
      properties: {
        title: { type: 'string' }, intent: { type: 'string' },
        files: { type: 'array', items: { type: 'string' } },
        // Resolved, inlined design guidance so the engineer never loads the catalog.
        guidance: { type: 'array', items: { type: 'string' } },
        // What already exists that this step should extend or call instead of writing again — named
        // concretely (file + symbol), or an explicit "nothing fits, writing new because …". Required
        // so the question gets ASKED: the Architect is the only agent that reads the codebase with the
        // whole design in view, so a duplicate it fails to notice becomes one nobody notices.
        reuse: { type: 'array', items: { type: 'string' } },
        acceptance: { type: 'array', items: { type: 'string' } },
      },
    } },
  },
}

// Three quality goals, stated as checkable bars rather than aspirations. The agent definitions already
// carried the aspirational versions ("simplest correct solution", "names that need no explanation") and
// the review panel's design/modularity lens has returned ZERO findings across 38 blocking results — so
// exhortation demonstrably does not move this. What moves it is being made to answer a question.
const CRAFT_RULE =
  `Three things this codebase is judged on, in every step you write:\n` +
  `1. **Branching stays low.** A function whose behavior depends on many interacting conditions is the ` +
  `main thing that makes code unreadable later. Use early returns, lookup dispatch, or separate functions ` +
  `for distinct responsibilities when they make the flow clearer; keep explicit branches when easier to follow. If a unit needs more than ~10 decision ` +
  `points, that is the signal to split it — not a target to hit.\n` +
  `2. **Written for a cold reader.** Assume the next person has never seen this file and will not read ` +
  `the diff, the ticket, or this plan. Names communicate domain meaning and computational role. ` +
  `Distinguish identifiers, indexes, objects, collections, and accumulators where confusion is possible; ` +
  `name map contents and keys, and make ambiguous units and aggregation scope explicit. Use consistent ` +
  `repository terminology and only established abbreviations that are clear in context. Make business rules, ` +
  `missing-data policies, and assumptions visible through names and explicit steps; comments explain why ` +
  `a rule exists or an assumption is necessary. Do not force an entire rule into a name. Separate decisions, transformations, and ` +
  `data construction when combining them requires mental unpacking; use meaningful intermediate names. ` +
  `Keep arguments, returns, and initializers simple while preserving evaluation order and conditional execution. ` +
  `Extract a function only when it captures a coherent responsibility and clarifies the caller. ` +
  `Optimize for comprehension over fewer lines; do not mechanically split trivial expressions or scatter the flow.\n` +
  `3. **Reuse before writing, and leave the seam better.** Search for the existing helper, type, or ` +
  `near-twin before authoring a new one — near-duplicates are the dominant source of drift here, where ` +
  `one copy gets fixed and the other silently does not. When you find one, extend it or extract the ` +
  `shared core rather than adding a third copy; when you deliberately duplicate, say why in one line.`

const CLAIMS_RULE =
  `Every plan rests on facts about the code as it exists TODAY, and a plan built on a false one sends an ` +
  `engineer down a dead end hours later with nobody watching. List those facts in \`claims\`: every ` +
  `falsifiable statement your steps depend on — how many call sites read a value, that a symbol you name ` +
  `exists with the signature you use, that an existing invariant already permits what you prescribe, how ` +
  `far the change actually reaches. For each give the exact \`check\` that settles it (a grep AND the count ` +
  `you expect, a file and symbol to read) and \`ifWrong\` — which step breaks, and how.\n` +
  `These are checked against the real code before the human sees this plan, so a claim you are UNSURE of ` +
  `is better listed than omitted — listing it is how you find out. Do not list restatements of the ` +
  `requirements or of your own design intent; only statements about existing code that could turn out false.`

// Are the success criteria satisfiable AT ALL? Verification is the most expensive phase in the system
// — 22% of an average run's tokens, more than Implement — and it costs the same on the fifth pass as
// the first. Point it at an impossible target and that cost compounds: one real run spent ~1.2M tokens
// and five verification passes chasing a dollar figure that WAS the bug being fixed, so correct code
// could never produce it. The same run also carried two criteria that contradicted each other. Both are
// settleable in seconds, by reading, before anyone builds anything.
const CRITERIA_CHECK_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['issues'],
  properties: {
    issues: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['kind', 'criteria', 'problem', 'evidence', 'soWhat'],
      properties: {
        // contradiction      two criteria cannot both hold
        // unreachable-target a stated value correct code can never produce — classically the CURRENT
        //                    (buggy) output, pasted in as the goal
        // unverifiable       nothing here can settle it; a caveat, not a blocker
        kind: { type: 'string', enum: ['contradiction', 'unreachable-target', 'unverifiable'] },
        criteria: { type: 'array', items: { type: 'string' } },   // names of the criteria involved
        problem: { type: 'string' },
        evidence: { type: 'string' },
        soWhat: { type: 'string' },   // same contract as SO_WHAT, declared below this point
      },
    } },
  },
}
const CRITERIA_BLOCKING = new Set(['contradiction', 'unreachable-target'])

const CLAIM_CHECK_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['results'],
  properties: {
    results: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['claim', 'verdict', 'evidence'],
      properties: {
        claim: { type: 'string' },
        // `unverifiable` is first-class on purpose: some claims genuinely cannot be settled from this
        // checkout, and "I am assuming this and could not confirm it here" is a far better thing for
        // the user to read BEFORE approving than a confident guess.
        verdict: { type: 'string', enum: ['verified', 'refuted', 'unverifiable'] },
        evidence: { type: 'string' },
      },
    } },
  },
}

// Two distinct channels for anything an agent notices that isn't its job:
//   escalations — the code surprised us; a human may need to decide. Surfaces at the end; with
//                 status="blocked" it stops the run outright.
//   punted      — small, out of scope, recorded and moved past. NEVER stops the run, never asks.
// Scope questions are NOT valid escalations: those were settled in the interview before the run went dark.
// The report the user reads is written from these fields, and they are the only place the code context
// exists. An agent that says "the sweep matches only the schema prefix of the cache key" has
// answered a question the user never asked. `soWhat` forces the translation here, where it can be done
// correctly — the report step downstream can only paraphrase what it is given.
const SO_WHAT = { type: 'string' }
const SO_WHAT_RULE =
  `\`soWhat\` is ONE sentence, in the vocabulary of the requirements, saying what this means for the ` +
  `people who use the feature and what happens if nobody acts. No file names, no function or symbol ` +
  `names, no identifiers — those belong in the other fields. Write it for someone who has not read the ` +
  `diff and does not intend to. If you cannot state a real consequence, that is a strong sign the item ` +
  `is not worth reporting at all.`

const ESCALATIONS = { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['issue', 'why', 'soWhat'],
  properties: { issue: { type: 'string' }, why: { type: 'string' }, soWhat: SO_WHAT },
} }
const PUNTED = { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['item', 'reason'],
  properties: { item: { type: 'string' }, reason: { type: 'string' } },
} }

const IMPLEMENT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['status', 'changedFiles', 'notes'],
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    changedFiles: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
    escalations: ESCALATIONS,
    punted: PUNTED,
  },
}

const REFACTOR_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['changedFiles', 'applied', 'notes'],
  properties: {
    changedFiles: { type: 'array', items: { type: 'string' } },
    applied: { type: 'array', items: { type: 'string' } },   // refactors performed
    notes: { type: 'string' },
    escalations: ESCALATIONS,
    punted: PUNTED,
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
    // Worktree fingerprint (tree hash) the full suite passed on — see SUITE_GATE_RULE. Lets any later
    // step (the final regression net, a pre-push check in the calling session) skip re-running the suite
    // when the tree hasn't changed since it went green. Absent when the suite didn't pass or didn't run.
    suiteFingerprint: { type: 'string' },
    // Criteria the CODE cannot satisfy — the target itself is wrong. Distinct from `failures`, which
    // are things an engineer can go fix. Sending a fix agent at one of these produces nothing but cost:
    // one real run spent three repair attempts and five verification passes on a dollar figure that was
    // the pre-fix bug. Reporting one here ends the fix loop immediately and routes it to the user.
    impossible: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['criterion', 'why'],
      properties: { criterion: { type: 'string' }, why: { type: 'string' } },
    } },
  },
}

const FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['findings'],
  properties: {
    findings: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['severity', 'lens', 'file', 'line', 'summary', 'fix', 'soWhat'],
      properties: {
        severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        lens: { type: 'string' },                     // security | performance | design | correctness | ...
        file: { type: 'string' }, line: { type: 'integer' },
        summary: { type: 'string' }, fix: { type: 'string' },
        soWhat: SO_WHAT,                              // plain-language consequence — see SO_WHAT_RULE
      },
    } },
  },
}

const ITERATE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['decision', 'mustFix', 'polish', 'conflicts', 'deferred'],
  properties: {
    decision: { type: 'string', enum: ['continue', 'stop'] },
    rationale: { type: 'string' },
    // Splitting these is what keeps the loop from churning: only mustFix can buy another full round.
    mustFix: { type: 'array', items: { type: 'string' } },         // from critical/high findings or verify failures
    polish: { type: 'array', items: { type: 'string' } },          // medium/low — batched for the closing Polish pass
    conflicts: { type: 'array', items: {                            // clash with requirements/plan → user decides
      type: 'object', additionalProperties: false, required: ['finding', 'conflictsWith'],
      properties: { finding: { type: 'string' }, conflictsWith: { type: 'string' } },
    } },
    deferred: { type: 'array', items: {                             // decided NOT to address (recorded)
      type: 'object', additionalProperties: false, required: ['finding', 'reason', 'soWhat'],
      properties: { finding: { type: 'string' }, reason: { type: 'string' }, soWhat: SO_WHAT },
    } },
  },
}

const playbookNote =
  `Playbook root: ${playbookDir}. Pattern catalogs: ${playbookDir}/patterns/<domain>/catalog.md (match "Reach for when", ` +
  `honor "Skip when"). Lessons: ${playbookDir}/lessons/<lens>.md. Stage new candidates ONLY to ` +
  `${playbookDir}/patterns/<domain>/candidates.md or ${playbookDir}/lessons/<lens>.candidates.md — never a promoted lane. ` +
  `Curated examples live in the gold lane. There are TWO lanes and the repo's wins on a clash: ` +
  `<repo>/.masterdevs/gold/ (the team's, committed alongside their code — it is NOT under the Playbook ` +
  `root, so check for it separately) and ${playbookDir}/gold/ (this machine's). In each lane that exists: ` +
  `read its INDEX.md, which groups every entry under a "## <domain>" heading (\`ls\` the lane if it has no ` +
  `index yet), then \`grep -il "<pattern or topic>" <lane>/*.md\` to search the entries themselves. Both are ` +
  `plain files, so read them with the two commands above — there is no gold-specific tool to look for. ` +
  `READ an entry file on demand and cite its id, and NEVER write, ` +
  `stage or reindex either lane — only /masterdevs:gold writes them.`

const merge = (a, b) => [...new Set([...(a || []), ...(b || [])])]

// ── When a model stops answering ────────────────────────────────────────────
// agent() returns null when its subagent dies on an API error the runtime's own retries could not get
// past — most often the account is out of usage credits for that model — or when the user skips it.
// The script cannot see which; the run log's "[label] failed: …" line names the cause. Before this, a
// null either threw ("Plan produced no steps") or read as an empty answer: a reviewer that never ran
// counted as a review that found nothing. Now every null is recorded in `agentFailures`, a run with any
// can never report `passed`, and an agent the loop cannot go on without stops it with a plain outcome.
const FALLBACK_MODEL = 'opus'
const agentFailures = []
const noAnswer = (label) => {
  agentFailures.push(label)
  log(`${label} got no answer from its model (often: out of usage credits) — see its log line for the cause`)
}
// Each Verify checks every criterion against the whole tree, so one that answers makes an earlier
// silent Verify moot. Reviews are not cleared this way: a later round reviews only its own revisions.
const verifyAnswered = () => {
  for (let i = agentFailures.length - 1; i >= 0; i--) if (/^verify:\d+\.\d+$/.test(agentFailures[i])) agentFailures.splice(i, 1)
}

// The Plan runs on the strongest model, which has its own usage limit. Losing the run to that limit
// wastes the Refine work already done, so a Plan that gets no answer is asked once more on the next
// strongest model. (After a user skip this asks again; skipping the retry too stops the run.)
async function withFallback(prompt, opts) {
  const out = await agent(prompt, opts)
  if (out || opts.model === FALLBACK_MODEL) { if (!out) noAnswer(opts.label); return out }
  noAnswer(opts.label)
  log(`retrying ${opts.label} once on ${FALLBACK_MODEL}`)
  const label = `${opts.label} (retry 1)`
  const retry = await agent(prompt, { ...opts, label, model: FALLBACK_MODEL })
  if (!retry) noAnswer(label)
  return retry
}

// The stop for an agent the loop cannot continue without. Finished agents are not lost: resuming the
// run (same script, same args) replays them from the journal and starts at the one that failed.
const stopNoAnswer = (label, extra = {}) => ({
  outcome: 'error',
  reason: 'no-answer',
  failedAgent: label,
  agentFailures,
  notes: `${label} got no answer from its model, so the run stopped there. The most common cause is running ` +
    `out of usage credits; the run log names the actual one. Once the model is available again (or with a ` +
    `different model), resume the run — finished agents are reused, not re-run.`,
  requirementsPath: reqPath,
  planPath: planFilePath,
  ...extra,
})

// Intra-agent context discipline: keeps a single agent lean so it stays in the model's effective zone and
// any runtime auto-compaction is lossless (durable state is already externalized). Appended to the phases
// most prone to context growth (broad research, multi-file implementation, command-heavy verification).
// Appended to every agent that writes code. The run is unattended by design: the user front-loaded the
// interview and the plan gate specifically so they could go do other work. Interrupting them is expensive
// and must be reserved for things that genuinely surprised us.
// Every call that appends this runs as `masterdevs:engineer`, whose definition already carries the full
// two-channel policy and the plain-language rule for writing them. Restating it here would be a second
// copy to keep in sync — and the two would drift, which is worse than either alone. Durable role
// standards live in the agent file; prompts carry the task.
// The user watches each agent's shell commands in a live status pane, through the `description` each
// call carries. Without one the pane can only guess from the command, so every agent is asked for it.
const DESCRIBE_SHELL =
  `\n\nGive every shell command a \`description\`: what it does, in plain words a non-engineer follows, ` +
  `10 words or fewer (e.g. "Find where the dialog is used", "Run the checkout tests"). No paths, flags or code.`

// Which step of how many the engineer is on, for the live status pane. The engineer builds every step
// in one pass, so only it knows; it says so by creating one small file as each step begins, and the
// pane reads that write as it happens. Without a runDir (a standalone run) there is nowhere to put it.
// A step's title is the plan's own. A fix's is not repeated: fixes are raw failure text (paths, commands,
// test names) the pane must never show, so the engineer names each one in plain words instead.
// A resumed run re-runs an agent under the same label, and the Write tool refuses to replace a file it
// has not read, so the rule says to read one that is already there.
const progressRule = (label, kind, titles) => {
  if (!runDir || !titles.length) return ''
  const file = `${runDir}/progress/${label.replace(/[^A-Za-z0-9]+/g, '-')}-<k>.txt`
  const isStep = kind === 'step'
  const title = isStep ? '<its title>' : '<what it fixes, in plain words, 8 words or fewer — no paths, commands, test names or code>'
  const order = isStep
    ? `The steps, in order:\n` + titles.map((t, i) => `${i + 1}. ${String(t).split('\n')[0].slice(0, 80)}`).join('\n')
    : `The fixes are the ${titles.length} listed above, in that order.`
  return `\n\nProgress: the user follows a live status pane. As you START each ${kind}, create the file ${file} ` +
    `with the Write tool (if it already exists from an earlier attempt, Read it first, then write it), containing ` +
    `exactly one line: "${isStep ? 'Step' : 'Fix'} <k> of ${titles.length}: ${title}". ${order}`
}

const CHANNELS =
  `\n\nUse the two channels from your instructions rather than stopping to ask: \`punted\` {item, reason} ` +
  `for anything small or out of scope, \`escalations\` {issue, why, soWhat} when the code contradicted the ` +
  `plan. Keep status="done" if you found a defensible way forward; "blocked" only for a genuine dead end.` +
  DESCRIBE_SHELL

const CONTEXT_DISCIPLINE =
  `\n\nContext discipline: work lean. Read targeted sections (grep, specific symbols) rather than whole large ` +
  `files; externalize durable findings to the artifact or code AS YOU GO instead of holding them in context; ` +
  `keep only what the current step needs. If your context grows large, summarize what you've established into ` +
  `the artifact and continue from that summary rather than re-reading everything.` + DESCRIBE_SHELL

// Two calls: the first runs Refine+Plan and STOPS for human plan approval; the second (startFrom:
// 'implement') loads the approved (possibly human-edited) artifacts and runs the Implement→Iterate loop.
const startFrom = input.startFrom || 'refine'
let refine, plan
let claimChecks = null      // per-claim verdicts, surfaced at the approval gate
let criteriaIssues = []     // success criteria that cannot be satisfied, or cannot be checked here

if (startFrom === 'implement') {
  // ── Resume after plan approval: use the artifacts the skill already read, else load them ──
  phase('Plan')
  let loaded = (input.approved && input.approved.refine && input.approved.plan) ? input.approved : null
  if (loaded) {
    log('using approved artifacts passed in args')
  } else {
    loaded = await agent(
      `Read these two artifact files and return their trailing structured data. Parse the fenced \`\`\`json block ` +
      `at the end of each — it is authoritative and may have been human-edited since approval. Modify nothing.\n` +
      `1) Requirements: ${reqPath}\n2) Plan: ${planFilePath}\nReturn {refine, plan}.`,
      { label: 'load-approved', phase: 'Plan', agentType: 'general-purpose', model: 'sonnet',
        schema: { type: 'object', additionalProperties: false, required: ['refine', 'plan'],
          properties: { refine: REFINE_SCHEMA, plan: PLAN_SCHEMA } } }
    )
  }
  if (!loaded) { noAnswer('load-approved'); return stopNoAnswer('load-approved') }
  if (!loaded.refine || !loaded.plan) throw new Error(`Could not load approved artifacts from ${runDir}`)
  refine = loaded.refine
  plan = loaded.plan
} else {
  // ── Phase: Refine ──
  phase('Refine')
  refine = await agent(
    `You are refining requirements for a feature — objective research only, no implementation opinions yet.\n\n` +
    `Feature brief:\n${brief}\n\n` +
    (intentBlock
      ? `The user already confirmed this intent in an interview. It is SETTLED — restate it faithfully as your ` +
        `\`requirements\` (enrich with code specifics; never widen, narrow, or reopen scope). Honor "Out of scope" ` +
        `as a hard boundary.\n\nConfirmed intent:\n${intentBlock}\n\n`
      : ``) +
    `Read the relevant code, specs, product/UI notes, and existing behavior. ` +
    (intentBlock ? `` : `Resolve the brief into a clear, terse \`requirements\` statement. `) +
    (intentBlock
      ? `Surface \`openQuestions\` ONLY for a contradiction you find in the CODE that the interview could not have ` +
        `anticipated — not for scope or preference questions, which are already answered above. Leave empty if none.`
      : `Surface \`openQuestions\` ONLY for genuine blocking ambiguities or contradictions you cannot resolve from ` +
        `the code/specs (leave empty if none).`) +
    ` Define \`successCriteria\` — concrete happy / ` +
    `failure / edge behaviors with how to prove each — and a \`verifyMethod\`: how to exercise this feature live ` +
    `(app, endpoints, integration), listing any \`riskySteps\` that are destructive/irreversible and must not run ` +
    `without human approval.\n` +
    `\`verifyMethod.dataSource\` must name WHERE the proof comes from — the fixture, seeded database, named ` +
    `record, or service — and state plainly if this checkout cannot reach it. ` +
    (intent && intent.verifyOn
      ? `The user named it: "${intent.verifyOn}". Honor that. If it is not reachable from here, say so in ` +
        `\`dataSource\` rather than silently substituting something else.\n`
      : `Do not claim a check is possible locally without saying what it runs against.\n`) +
    (reqPath ? `Also write a concise human-readable version to ${reqPath}, ending with the EXACT structured result in a fenced \`\`\`json block (so a later call can reload it).\n` : ``) + CONTEXT_DISCIPLINE,
    { label: 'refine', phase: 'Refine', schema: REFINE_SCHEMA, agentType: 'general-purpose', model: 'sonnet' }
  )
  if (!refine) { noAnswer('refine'); return stopNoAnswer('refine') }
  if (refine.openQuestions && refine.openQuestions.length) {
    log(`Refine has ${refine.openQuestions.length} blocking question(s) — stopping for the user`)
    return { outcome: 'needs-clarification', openQuestions: refine.openQuestions, requirements: refine.requirements, requirementsPath: reqPath }
  }
  log(`requirements resolved; ${refine.successCriteria.length} success criteria`)

  // ── Phase: Plan (strongest model) ──
  // The criteria check rides alongside the Architect rather than gating it: both read only Refine's
  // output, so running them concurrently costs no wall clock in the common case where the criteria are
  // fine — and the user is waiting through this phase.
  phase('Plan')
  const planned = await parallel([
    () => withFallback(
    `You are the Architect. Produce a handoff-ready implementation plan for another engineer to execute.\n\n` +
    `Requirements:\n${refine.requirements}\n\n` +
    `Success criteria:\n${JSON.stringify(refine.successCriteria, null, 2)}\n\n` +
    `${playbookNote}\n\n` +
    `Prioritize, in order: correct design patterns, modularity, reusability, maintainability, readability. RESOLVE ` +
    `the design — for each step inline concrete \`guidance\` (the pattern/refactor and HOW to apply it here), so the ` +
    `engineer never loads the catalog. Reuse existing abstractions over inventing new ones. Be TERSE — a spec, not ` +
    `an essay; the plan is re-read each iteration. Order steps for a single engineer to build in one pass.\n\n` +
    CRAFT_RULE + `\n\n` +
    `You are the only agent that reads this codebase with the whole design in view, so **you** decide reuse: ` +
    `for every step, fill \`reuse\` with the existing helpers, types, or near-twins it should extend or call ` +
    `instead of writing again — named concretely, file and symbol. **Search the whole repository, not just ` +
    `the files this step touches**; the thing worth reusing is usually in a module the feature never opens, ` +
    `which is exactly why it gets written twice. Go look; do not answer from memory. If ` +
    `nothing fits, say so explicitly and why ("nothing existing handles X because …"). An empty answer is not ` +
    `an option: a duplicate you fail to notice here is one nobody notices, and it ships as a second copy that ` +
    `drifts from the first.\n\n` +
    CLAIMS_RULE + `\n` +
    (planFilePath ? `Also write a concise human-readable plan to ${planFilePath}, ending with the EXACT structured result in a fenced \`\`\`json block (so the approved plan can be reloaded, and a human can edit it before approving).\n` : ``),
    { label: 'plan', phase: 'Plan', schema: PLAN_SCHEMA, agentType: 'masterdevs:architect', model: 'fable' }
    ),
    () => agent(
      `You are checking whether a feature's success criteria can be satisfied AT ALL, before anyone ` +
      `builds against them. You are strictly READ-ONLY: read code, run read-only queries, change nothing.\n\n` +
      `Everything after this check runs unattended, and verification is the most expensive phase there ` +
      `is — pointed at an impossible target it will burn hours proving correct code wrong. Report only:\n\n` +
      `  contradiction       two or more criteria that cannot both hold. Say which, and why they are ` +
      `exclusive. Watch for one criterion requiring a value to CHANGE while another requires that same ` +
      `value to stay identical.\n` +
      `  unreachable-target  a stated value correct code can never produce. The classic case: the number ` +
      `is the CURRENT output — i.e. the bug being fixed, pasted in as the goal. So for every concrete ` +
      `numeric or string target, go compute what the code produces TODAY. If it already reproduces the ` +
      `target exactly, that is near-proof the criterion is asking to preserve the defect; say so.\n` +
      `  unverifiable        nothing available here can settle it (needs production data, a live ` +
      `service, credentials). Say what WOULD settle it.\n\n` +
      `Do NOT report criteria that are merely hard, vague, or that you would have worded differently — ` +
      `only ones that are impossible, self-contradictory, or uncheckable. Return an empty list if the ` +
      `criteria are sound; that is the expected outcome and there is no credit for finding something.\n\n` +
      `Requirements:\n${refine.requirements}\n\n` +
      `Success criteria:\n${JSON.stringify(refine.successCriteria, null, 2)}\n\n` +
      `Verify method:\n${JSON.stringify(refine.verifyMethod, null, 2)}\n\n` + SO_WHAT_RULE + CONTEXT_DISCIPLINE,
      { label: 'check-criteria', phase: 'Plan', schema: CRITERIA_CHECK_SCHEMA,
        agentType: 'general-purpose', model: 'sonnet' }
    ),
  ])
  plan = planned[0]
  if (!planned[1]) noAnswer('check-criteria')
  criteriaIssues = ((planned[1] && planned[1].issues) || [])
  if (!plan) return stopNoAnswer('plan', { requirements: refine.requirements })
  if (!plan.steps || plan.steps.length === 0) throw new Error('Plan produced no steps')

  // A contradictory or impossible criterion poisons everything downstream, and only the user can settle
  // it — so this stops here rather than surfacing as a caveat the user might approve past. This is the
  // exact failure that cost one real run 5.8M tokens across two full loops.
  const blockingCriteria = criteriaIssues.filter((i) => CRITERIA_BLOCKING.has(i.kind))
  if (blockingCriteria.length) {
    log(`${blockingCriteria.length} success criterion/criteria cannot be satisfied — stopping for the user`)
    return {
      outcome: 'needs-clarification',
      openQuestions: blockingCriteria.map((i) =>
        `${i.kind === 'contradiction' ? 'Contradictory criteria' : 'Impossible target'} ` +
        `(${(i.criteria || []).join(', ')}): ${i.problem} — ${i.evidence}`),
      criteriaIssues,
      requirements: refine.requirements,
      requirementsPath: reqPath,
      planPath: planFilePath,
      outputTokens: (typeof budget !== 'undefined' && budget) ? budget.spent() : undefined,
    }
  }

  // ── Fact-check the plan BEFORE the human sees it ──────────────────────────
  // This is the one place work is deliberately added to the window the user is waiting in. It buys
  // that back many times over: every claim settled here is a claim that would otherwise be discovered
  // false hours later, in the dark, by an agent that has to improvise around it alone.
  let planRevisions = 0
  while (plan.claims && plan.claims.length) {
    const checked = await agent(
      `You are fact-checking an implementation plan BEFORE a human approves it and agents build from it ` +
      `unattended. You are strictly READ-ONLY: run the checks, read the code, change nothing.\n\n` +
      `For each claim, run its \`check\` — or a better one, if the stated check is wrong — and return a verdict:\n` +
      `  verified     the claim holds. Quote the evidence (the count you got, the signature you read).\n` +
      `  refuted      the claim is false. Say what is actually true.\n` +
      `  unverifiable it cannot be settled from this checkout (needs production data, a running service,\n` +
      `               credentials). Say what WOULD settle it.\n\n` +
      `Be adversarial about counts and names: "three call sites" means exactly three — go count them. A ` +
      `symbol the plan names must exist, with that name and that signature. An invariant the plan says ` +
      `"already permits" something must be read, not assumed. Never mark a claim verified because it is ` +
      `plausible; plausible-but-false is exactly what this step exists to catch. Prefer \`unverifiable\` ` +
      `over a guess.\n\n` +
      `Claims:\n${JSON.stringify(plan.claims, null, 2)}\n` + CONTEXT_DISCIPLINE,
      { label: `verify-plan:${planRevisions + 1}`, phase: 'Plan', schema: CLAIM_CHECK_SCHEMA,
        agentType: 'general-purpose', model: 'sonnet' }
    )
    if (!checked) { noAnswer(`verify-plan:${planRevisions + 1}`); break }
    claimChecks = checked.results || []
    const refuted = claimChecks.filter((r) => r.verdict === 'refuted')
    const unverifiable = claimChecks.filter((r) => r.verdict === 'unverifiable')
    log(`plan claims: ${claimChecks.length - refuted.length - unverifiable.length} verified, ` +
      `${refuted.length} refuted, ${unverifiable.length} unverifiable`)
    if (!refuted.length || planRevisions >= MAX_PLAN_REVISIONS) break

    // A plan resting on a false premise is often wrong in its structure, not just in that one line —
    // so this goes back to the Architect rather than being patched in place.
    planRevisions++
    log(`${refuted.length} claim(s) refuted — revising the plan`)
    const revised = await withFallback(
      `Your plan rested on claims about the code that turned out to be FALSE. Revise it.\n\n` +
      `Refuted claims, with what is actually true:\n${JSON.stringify(refuted, null, 2)}\n\n` +
      `Previous plan:\n${JSON.stringify(plan, null, 2)}\n\n` +
      `Rework every step that depended on a refuted claim — the fix is often structural, not a one-line ` +
      `correction, so do not simply patch the wording. Leave steps that did not depend on them byte-identical. ` +
      `Return the COMPLETE revised plan.\n\n` + CLAIMS_RULE + `\n` +
      (planFilePath ? `Rewrite ${planFilePath} with the revised plan, same format as before.\n` : ``),
      { label: 'plan:revised', phase: 'Plan', schema: PLAN_SCHEMA, agentType: 'masterdevs:architect', model: 'fable' }
    )
    if (!revised || !revised.steps || !revised.steps.length) break
    plan = revised
  }

  // STOP for human plan approval — the Implement→Iterate loop runs on the next call (startFrom:'implement').
  log('Plan written — stopping for human approval')
  return {
    outcome: 'awaiting-plan-approval',
    summary: plan.summary,
    stepCount: plan.steps.length,
    // What the plan assumed, and which of it survived contact with the code. `unverifiable` entries are
    // the ones worth the user's eye: the plan is proceeding on an assumption nobody could confirm here.
    claimChecks,
    criteriaIssues,   // survivors are `unverifiable` only — blocking kinds returned above
    planRevised: planRevisions > 0,
    agentFailures,    // checks that got no answer: their silence is not a pass
    dataSource: (refine.verifyMethod && refine.verifyMethod.dataSource) || null,
    requirementsPath: reqPath,
    planPath: planFilePath,
    outputTokens: (typeof budget !== 'undefined' && budget) ? budget.spent() : undefined,
  }
}

const planBlock = `Plan summary: ${plan.summary}\n\nSteps:\n` + plan.steps.map((s, i) =>
  `${i + 1}. ${s.title}\n   intent: ${s.intent}\n   files: ${(s.files || []).join(', ')}\n   guidance: ${(s.guidance || []).join(' | ') || '—'}\n` +
  `   reuse: ${(s.reuse || []).join(' | ') || '—'}\n   acceptance: ${(s.acceptance || []).join('; ')}`
).join('\n')

// ── Setup: user-added reviewers (default is the one combined reviewer) ──────
// The skill normally passes this in args; only spawn an agent to read one small JSON file if it didn't.
let extraReviewers = Array.isArray(input.userReviewers) ? input.userReviewers : null
if (!extraReviewers) {
  const loadedRoster = (await agent(
    `Read ${playbookDir}/rosters/reviewers.user.json if it exists and return its array as {reviewers:[...]} ` +
    `(each {name, agentType, model}); if absent or empty return {reviewers:[]}. Read only — modify nothing.`,
    { label: 'roster', phase: 'Plan', agentType: 'general-purpose', model: 'sonnet', schema: {
      type: 'object', additionalProperties: false, required: ['reviewers'],
      properties: { reviewers: { type: 'array', items: { type: 'object', additionalProperties: true,
        required: ['name', 'agentType', 'model'],
        properties: { name: { type: 'string' }, agentType: { type: 'string' }, model: { type: 'string' } } } } },
    } }
  )) || (noAnswer('roster'), { reviewers: [] })
  extraReviewers = loadedRoster.reviewers || []
}
const reviewPanel = [
  { name: 'reviewer', agentType: 'masterdevs:reviewer', model: 'opus' },
  ...extraReviewers,
]

// ── The loop: Implement → Refactor → (Verify ∥ Review) → Iterate ────────────
let changedFiles = []
let revisions = []                 // critical/high fixes fed back into Implement
const polish = []                  // medium/low revisions, batched for one closing pass
const deferred = []                // recorded, not addressed
const conflicts = []               // clash with requirements/plan → user decides
const punted = []                  // small things agents noticed and moved past — never interrupts
const escalations = []             // the code surprised us — surfaced at the end, or stops the run

// Drain both channels off any agent result. Deliberately NOT fed to the reviewers: telling a reviewer
// "the engineer already knows about X" biases it away from reporting X. If a reviewer independently
// flags something that was punted, that's free signal the punt was wrong.
const collect = (r) => {
  if (!r) return r
  if (r.punted) punted.push(...r.punted)
  if (r.escalations) escalations.push(...r.escalations)
  return r
}
let iteration = 0
let lastFindings = []
let verifyPassed = false
let verifyNeedsApproval = []
let suiteGreen = null              // worktree fingerprint the full suite last passed on (see SUITE_GATE_RULE)
let impossibleCriteria = []   // criteria correct code can never satisfy — the target itself is wrong
let reviewStale = false            // Verify applied fixes after Review read the tree
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
      `write tests alongside the code. If a step's plan is wrong (file not shaped as ` +
      `described, pattern doesn't fit), set status="blocked" and explain — do NOT silently redesign.\n\n` +
      `Each step carries a \`reuse\` line naming what already exists for this job. Honor it: extend or call ` +
      `those rather than writing a second copy. If one turns out not to fit, say so in \`notes\` — that is a ` +
      `real finding about the plan, not a licence to duplicate quietly.\n\n` +
      // CRAFT_RULE is deliberately NOT repeated here: this call runs as `masterdevs:engineer`, whose
      // definition states the same three standards in more depth. It stays in the Plan prompt because
      // the Architect has no equivalent section.
      `Requirements:\n${refine.requirements}\n\n${planBlock}`
    : `Apply ONLY these approved revisions to the existing implementation in the current worktree, then report ` +
      `changed files. Keep tests green. Stay in scope.\n\nRevisions:\n${revisions.map((r) => `- ${r}`).join('\n')}\n\n` +
      `(Plan context)\n${planBlock}` + notesBlock()
  // No CONTEXT_DISCIPLINE here — engineer.md opens with the same rule. It stays on the general-purpose
  // calls (Refine, Verify, the checks), which have no agent definition to carry it.
  const implFull = implPrompt + TEST_SCOPE_RULE + CHANNELS + (iteration === 1
    ? progressRule(`implement:${iteration}`, 'step', plan.steps.map((st) => st.title))
    : progressRule(`implement:${iteration}`, 'fix', revisions))
  const impl = collect(await agent(implFull, {
    label: `implement:${iteration}`, phase: 'Implement',
    agentType: 'masterdevs:engineer', model: 'opus', schema: IMPLEMENT_SCHEMA,
  }))
  if (!impl) {
    noAnswer(`implement:${iteration}`)
    return stopNoAnswer(`implement:${iteration}`, { iteration, changedFiles, escalations, punted })
  }
  if (impl.status === 'blocked') {
    return { outcome: 'blocked', iteration, notes: impl.notes, escalations, punted, changedFiles,
      requirementsPath: reqPath, planPath: planFilePath }
  }
  changedFiles = merge(changedFiles, impl.changedFiles)
  if (impl.notes) carryNotes = impl.notes

  // ── Refactor ──
  phase('Refactor')
  const refactor = collect(await agent(
    // Your instructions already define the three standards (branching, cold readability, reuse). What
    // this prompt adds is what is specific to a refactor pass over a diff that was just written.
    `Improve what the implementation just landed, against the three standards in your instructions — ` +
    `branching, cold readability, and reuse. Apply only SAFE, behavior-preserving refactors; keep tests ` +
    `green. Stage any recurring pattern as a candidate (never a promoted lane).\n\n` +
    `Two things are specific to this pass:\n\n` +
    `**Hunt duplication across the WHOLE codebase, not just this feature.** A duplicate you only look ` +
    `for inside the changed files is one you will never find; the copy that matters is almost always in ` +
    `a module this feature never touched. For each non-trivial helper, type, or block just introduced, ` +
    `grep the repository for the same shape — by distinctive identifier, by the constant it turns on, ` +
    `by the signature. Keep it targeted: a handful of greps, not a tour of the repository.\n\n` +
    `**Read anywhere; edit narrowly.**\n` +
    `  - Existing thing is reusable as-is → call it, delete the new copy.\n` +
    `  - Needs a small behavior-preserving widening and is test-covered → do it, and run its tests too.\n` +
    `  - Needs real surgery in a module this feature does not own → do NOT start. Record it in ` +
    `\`punted\` and add a line to ${playbookDir}/refactor-backlog.md naming both sites, so the Architect ` +
    `pulls it in on a future run that already touches that file.\n\n` +
    `Report what you changed in \`applied\`, one line each, naming the standard it served. Finding ` +
    `nothing worth doing is a valid answer — say so rather than inventing churn.\n\n` +
    `The plan below is your EDITING scope — it is not a limit on where you may look. Do NOT go looking ` +
    `for a plan file on disk; ` +
    `there isn't one.\n\n${planBlock}\n\nChanged files: ${changedFiles.join(', ')}\n${playbookNote}` + TEST_SCOPE_RULE + CHANNELS,
    { label: `refactor:${iteration}`, phase: 'Refactor', agentType: 'masterdevs:engineer', model: 'sonnet', schema: REFACTOR_SCHEMA }
  ))
  if (!refactor) noAnswer(`refactor:${iteration}`)
  if (refactor) { changedFiles = merge(changedFiles, refactor.changedFiles); if (refactor.notes) carryNotes = refactor.notes }

  // ── Verify ∥ Review ────────────────────────────────────────────────────
  // Both only READ the tree, so they overlap (~12 min/iteration saved). This is only safe because both are
  // told, and their agent definitions enforce, that they must not edit files or run git stash/checkout/reset.
  // Verify's FIXES are hoisted out below and run serially, after Review has finished reading.
  phase('Verify')
  const readOnlyRule =
    `\n\nSTRICT read-only: a reviewer is reading this same worktree concurrently. Do NOT edit, create, or delete ` +
    `any file, and do NOT run \`git stash\`/\`checkout\`/\`reset\`/\`clean\` or anything else that mutates the tree. ` +
    `You need no baseline comparison — judge the code as it stands. Report problems; someone else fixes them. ` +
    `One exception: the run log and repo notes named above live OUTSIDE the worktree — updating them is required.`
  const verifyScope = iteration === 1
    ? `Run the test suite, then exercise it LIVE per the verify method (boot the app, hit endpoints, run integration).`
    : `This code verified clean in an earlier round; only these revisions have landed since:\n` +
      `${revisions.map((r) => `- ${r}`).join('\n')}\n` +
      `So: run the full test suite ONCE as your regression net (do not re-run it repeatedly), and re-exercise LIVE ` +
      `ONLY the success criteria whose behavior those revisions could have changed. Mark the rest as previously ` +
      `passing rather than re-proving them.`

  // A re-verify after a fix is NOT a fresh verification, and saying so is worth real money: measured
  // across runs, re-verifies cost MORE than first passes (143K vs 114K) because they inherited the
  // first-pass scope and redid the whole job. The fix agent touched a named set of failures; only those
  // need live re-proving, plus one suite run as the regression net.
  const fixScope = (fixed) =>
    `A fix agent has just addressed these specific failures:\n${fixed.map((f) => `- ${f}`).join('\n')}\n` +
    `Everything else in this feature verified in the pass immediately before that fix — the log records how. ` +
    `So: run the test suite ONCE as your regression net, and re-exercise LIVE ONLY the criteria above. ` +
    `Carry the rest forward from the log as already-passing rather than re-proving them; re-proving a ` +
    `criterion nothing has touched is the most common way this phase wastes its budget.`

  const verifyPrompt = (attempt, fixed) =>
    `Exercise the implementation against the success criteria and report pass/fail per criterion. ` +
    `${attempt > 0 && fixed && fixed.length ? fixScope(fixed) : verifyScope} ` +
    `Do NOT run any risky/destructive step; list those under needsApprovalFor instead.` +
    SHARED_STATE_RULE + `\n` + verifyMemory + SUITE_GATE_RULE + `\n` +
    `Success criteria:\n${JSON.stringify(refine.successCriteria, null, 2)}\n\n` +
    `Verify method:\n${JSON.stringify(refine.verifyMethod, null, 2)}\n\n` +
    `Changed files: ${changedFiles.join(', ')}\n` +
    `Return concrete \`failures\` (the exact failing behaviors) so they can be fixed.\n` +
    `Separate out any criterion the code CANNOT satisfy into \`impossible\` — where the target itself is ` +
    `wrong, not the code: a stated number that is the pre-fix value, or a criterion that contradicts ` +
    `another. Judge that by what the criterion asks for, NOT by how many attempts have failed. Putting ` +
    `one in \`failures\` sends an engineer to chase it; putting it in \`impossible\` ends the round and ` +
    `asks the user, which is the only thing that can resolve a wrong target.` +
    (attempt === 0 ? readOnlyRule : ``) + CONTEXT_DISCIPLINE

  const reviewScope = iteration === 1
    ? `Changed files: ${changedFiles.join(', ')}.`
    : `An earlier round already reviewed this feature. Review ONLY what changed since then — these revisions:\n` +
      `${revisions.map((r) => `- ${r}`).join('\n')}\n` +
      `Use \`git diff\` to find them. Do not re-review code you are not shown to have changed.`
  const reviewTask = (r) => async () => {
    const out = await agent(
      `Review ONLY the new/changed code for this feature — security, performance, design/modularity, and ` +
      `correctness. ${reviewScope}\n` +
      `Requirements (context — and the vocabulary to write \`soWhat\` in):\n${refine.requirements}\n` +
      `Adversarial stance: report only defects that survive scrutiny. Stage any recurring-miss lesson to ` +
      `${playbookDir}/lessons/<lens>.candidates.md (never a promoted lane). Return findings.\n\n` +
      SO_WHAT_RULE + readOnlyRule + DESCRIBE_SHELL,
      { label: `review:${r.name}:${iteration}`, phase: 'Review', agentType: r.agentType, model: r.model, schema: FINDINGS_SCHEMA }
    )
    if (!out) { noAnswer(`review:${r.name}:${iteration}`); return [] }
    return out.findings || []
  }

  const concurrent = await parallel([
    () => agent(verifyPrompt(0), {
      label: `verify:${iteration}.0`, phase: 'Verify', agentType: 'general-purpose', model: 'sonnet', schema: VERIFY_SCHEMA }),
    ...reviewPanel.map(reviewTask),
  ])
  let verify = concurrent[0]
  if (verify) verifyAnswered()
  else noAnswer(`verify:${iteration}.0`)
  lastFindings = concurrent.slice(1).flatMap((f) => f || [])
  verifyNeedsApproval = (verify && verify.needsApprovalFor) || []

  // ── Verify's fix loop (serial — this one mutates, so it waits for Review) ──
  let vAttempt = 0
  // An impossible criterion is not fixable by definition, so no fix agent runs against one. This guard
  // is what turns "five verification passes and three repair attempts against an unreachable number"
  // into one pass and a question.
  while (verify && !verify.passed && !(verify.impossible || []).length && vAttempt < MAX_VERIFY_FIX) {
    vAttempt++
    reviewStale = true
    const justFixed = verify.failures || []
    log(`verify fix ${vAttempt}/${MAX_VERIFY_FIX} (${justFixed.length} failing)`)
    const fix = collect(await agent(
      `Verification failed. Fix ONLY these failing behaviors in the current worktree, then report changed files. ` +
      `A fresh verification (which owns the full-suite gate) runs right after you return.\n\n` +
      `Failures:\n${verify.failures.map((f) => `- ${f}`).join('\n')}\n\n${planBlock}` + notesBlock() + TEST_SCOPE_RULE + CHANNELS +
      progressRule(`implement:${iteration}.fix${vAttempt}`, 'fix', verify.failures || []),
      { label: `implement:${iteration}.fix${vAttempt}`, phase: 'Verify', agentType: 'masterdevs:engineer', model: 'opus', schema: IMPLEMENT_SCHEMA }
    ))
    if (!fix) { noAnswer(`implement:${iteration}.fix${vAttempt}`); break }
    if (fix.status === 'blocked') break
    changedFiles = merge(changedFiles, fix.changedFiles)
    if (fix.notes) carryNotes = fix.notes
    verify = await agent(verifyPrompt(vAttempt, justFixed), {
      label: `verify:${iteration}.${vAttempt}`, phase: 'Verify', agentType: 'general-purpose', model: 'sonnet', schema: VERIFY_SCHEMA })
    if (verify) verifyAnswered()
    else noAnswer(`verify:${iteration}.${vAttempt}`)
    verifyNeedsApproval = (verify && verify.needsApprovalFor) || []
  }
  verifyPassed = !!(verify && verify.passed)
  // suiteFingerprint is only returned when the SUITE passed — a fact about the tree that stands even
  // when a live criterion failed. Staleness is harmless: consumers compare it to the current tree.
  if (verify && verify.suiteFingerprint) suiteGreen = verify.suiteFingerprint
  if (verify && (verify.impossible || []).length) {
    impossibleCriteria = merge(impossibleCriteria, verify.impossible.map((i) => `${i.criterion}: ${i.why}`))
    log(`${verify.impossible.length} criterion/criteria cannot be satisfied as written — stopping for the user`)
  }

  // ── Iterate (decide; partition findings) ──
  phase('Iterate')
  const iter = await agent(
    `Decide whether to run the loop again. You are given this round's review findings plus verify status.\n\n` +
    `Findings:\n${JSON.stringify(lastFindings, null, 2)}\n\n` +
    `Verify passed: ${verify ? verifyPassed : 'unknown — verification got no answer, which is not a failure'}. ` +
    `Iteration ${iteration}/${MAX_ITERATIONS}.\n` +
    `Requirements + plan (to judge conflicts):\n${refine.requirements}\n${plan.summary}\n\n` +
    `Partition the findings into FOUR buckets:\n` +
    `- \`mustFix\` — revisions that come from a critical/high finding or a verify failure. ONLY these justify ` +
    `another full round; be strict, and leave this empty if nothing rises to that bar.\n` +
    `- \`polish\` — in-scope medium/low revisions worth making but NOT worth another review round. They are ` +
    `batched and applied once at the end without re-review, so each must be safe to apply unsupervised. ` +
    `Write each one so it reads as a fix to the FEATURE, not to a line of code — the user sees these.\n` +
    `- \`conflicts\` — anything that clashes with the requirements or plan. The USER decides these; do not action ` +
    `them. Surfacing one stops the loop, so only put a genuine requirement/plan clash here.\n` +
    `- \`deferred\` — not worth addressing at all, with a reason.\n` +
    `decision="continue" only if \`mustFix\` is non-empty or verify failed, AND iterations remain; else "stop".\n\n` +
    `The findings you are given were written by a reviewer reading code; the user reading your output was ` +
    `not. Carry each finding's \`soWhat\` forward rather than its \`summary\`, and phrase every item in the ` +
    `requirements' vocabulary.\n${SO_WHAT_RULE}`,
    { label: `iterate:${iteration}`, phase: 'Iterate', agentType: 'general-purpose', model: 'sonnet', schema: ITERATE_SCHEMA }
  )
  if (!iter) { noAnswer(`iterate:${iteration}`); break }
  deferred.push(...(iter.deferred || []))
  conflicts.push(...(iter.conflicts || []))
  polish.push(...(iter.polish || []))
  revisions = iter.mustFix || []
  const hasBlocking = lastFindings.some((f) => BLOCKING.has(f.severity))

  // A plan-conflict is the user's call — stop rather than spend another round around an open question.
  if (conflicts.length) { log(`${conflicts.length} plan-conflict(s) — stopping for the user`); break }
  // So is an unreachable target. Another round cannot make correct code produce a wrong number.
  if (impossibleCriteria.length) break
  // The script, not the agent, decides what earns another round: the agent can vote to stop, never to prolong.
  if (iter.decision !== 'continue') break
  if (!revisions.length && !hasBlocking && verifyPassed) break
  // A Verify that got no answer is not a failure to fix: with nothing else to fix, another round would
  // only re-run every agent to ask the same question of a model that is not answering.
  if (!verify && !revisions.length && !hasBlocking) break
}

// ── Polish: the batched medium/low revisions, applied once ──────────────────
// This replaces the extra full round those nits used to buy. They are applied by one cheap engineer and
// covered by a regression check — but deliberately NOT re-reviewed, because re-reviewing nit fixes is what
// produced a fresh crop of findings every round instead of a converging one.
// Skipped on an unreachable target for the same reason as a conflict: the requirements are going back to
// the user, so this code is likely to move again. Polish costs a real agent (~150-250K tokens observed).
let polishApplied = []
let polishTouchedTree = false      // a polish agent that edited and THEN blocked still dirties the tree
if (polish.length && !conflicts.length && !impossibleCriteria.length) {
  phase('Polish')
  const pol = collect(await agent(
    `Apply ONLY these low-risk revisions to the existing implementation in the current worktree, then report ` +
    `changed files. They are advisory (medium/low severity) cleanups, already judged safe to apply unsupervised. ` +
    `Keep the tests you touch green, stay strictly in scope, and skip any revision that turns out to need a design ` +
    `change — list those in \`notes\` instead of forcing them. A regression net (which owns the full-suite gate) ` +
    `runs right after you return.\n\n` +
    `Revisions:\n${polish.map((r) => `- ${r}`).join('\n')}\n\n(Plan context)\n${planBlock}` + notesBlock() + TEST_SCOPE_RULE + CHANNELS,
    { label: 'polish', phase: 'Polish', agentType: 'masterdevs:engineer', model: 'sonnet', schema: IMPLEMENT_SCHEMA }
  ))
  if (!pol) noAnswer('polish')
  if (pol) {
    polishTouchedTree = (pol.changedFiles || []).length > 0
    changedFiles = merge(changedFiles, pol.changedFiles)
    if (pol.status !== 'blocked') {
      polishApplied = polish
      if (pol.notes) carryNotes = pol.notes
    }
  }
}

// Final regression net over anything that landed after the last suite gate. Only polish edits can land
// there: the verify fix loop always ENDS with a fresh verify — its own suite run — after the last fix,
// so `reviewStale` alone means the tree is unchanged since a green gate, and re-running the suite on an
// unchanged tree was pure waste (this pass measured 19 minutes on average). Skipped when verification is
// already red — there's nothing to protect, and the user is getting it back anyway.
if (verifyPassed && (polishApplied.length || polishTouchedTree)) {
  phase('Polish')
  const finalVerify = await agent(
    `Confirm nothing regressed. Run the test suite ONCE and re-check only the success criteria that the changes ` +
    `below could plausibly affect — do not re-prove the rest, and do not run risky/destructive steps.` +
    SHARED_STATE_RULE + `\n` + verifyMemory + SUITE_GATE_RULE + `\n` +
    `This is a regression net, not a fresh verification: it has run at 19 minutes on average, longer than the ` +
    `first full pass it is supposed to be a cheap follow-up to. If the changes below are low-risk cleanups, the ` +
    `suite alone is the answer.\n\n` +
    `Changes since the last full verification:\n` +
    `${(polishApplied.length ? polishApplied : ['partial polish edits — the polish agent blocked midway']).map((r) => `- ${r}`).join('\n')}\n\n` +
    `Success criteria:\n${JSON.stringify(refine.successCriteria, null, 2)}\n\n` +
    `Changed files: ${changedFiles.join(', ')}` + CONTEXT_DISCIPLINE,
    { label: 'verify:final', phase: 'Polish', agentType: 'general-purpose', model: 'sonnet', schema: VERIFY_SCHEMA }
  )
  if (!finalVerify) noAnswer('verify:final')
  if (finalVerify) {
    verifyPassed = !!finalVerify.passed
    verifyNeedsApproval = finalVerify.needsApprovalFor || verifyNeedsApproval
    if (finalVerify.suiteFingerprint) suiteGreen = finalVerify.suiteFingerprint
  }
}

// Verify's fix agents edit real failing behavior, so those edits must not ship unreviewed. Scoped to that
// diff only — a rare path, and far cheaper than the full extra round it replaces. (Polish edits are NOT
// worth an opus review on their own; they only get covered here because this pass is already running.)
if (reviewStale && verifyPassed && !conflicts.length) {
  phase('Polish')
  const staleReview = await agent(
    `A reviewer already reviewed this feature, then more changes landed: fixes for failing verifications` +
    `${polishApplied.length ? `, plus a batch of low-risk polish edits` : ``}. Review ONLY what changed after ` +
    `that review — use \`git diff\` to isolate it — across security, performance, design, and correctness. Do ` +
    `not re-review the rest of the feature. Return findings.\n\n` +
    `Requirements (context):\n${refine.requirements}` + DESCRIBE_SHELL,
    { label: 'review:post-fix', phase: 'Polish', agentType: 'masterdevs:reviewer', model: 'opus', schema: FINDINGS_SCHEMA }
  )
  if (!staleReview) noAnswer('review:post-fix')
  if (staleReview && staleReview.findings) lastFindings = [...lastFindings, ...staleReview.findings]
}

const unresolvedBlocking = lastFindings.filter((f) => BLOCKING.has(f.severity))
// An escalation is something an agent hit, resolved defensibly, and kept going past — it is report
// content, not a verdict. Counting it here made `passed` nearly unreachable: across 22 real runs only
// 2 landed clean, and 10 of the 15 `needs-attention` results had no conflict and no failure behind
// them, just escalations. That mislabels a successful run as one needing you, which is the exact cost
// this design exists to avoid. A genuine dead end returns `blocked` long before reaching this line.
return {
  outcome: (verifyPassed && unresolvedBlocking.length === 0 && conflicts.length === 0
    && impossibleCriteria.length === 0 && agentFailures.length === 0)
    ? 'passed' : 'needs-attention',
  iterations: iteration,
  changedFiles,
  verifyPassed,
  suiteGreen,                 // worktree fingerprint the full suite last PASSED on (says nothing about the
                              // live criteria — that's verifyPassed). A later step that wants a suite run
                              // (pre-push checks) recomputes the fingerprint and skips if it matches.
  verifyNeedsApproval,        // risky steps Verify declined to run — need human
  conflicts,                  // clash with requirements/plan — user decides
  impossibleCriteria,         // the target itself is wrong — only the user can fix the criterion
  escalations,                // the code surprised us mid-run — a human should look
  punted,                     // small things noticed and moved past — recorded, no action taken
  polishApplied,              // medium/low revisions batched and applied once, without re-review
  deferred,                   // recorded, intentionally not addressed
  unresolvedBlocking,         // high/critical findings still open after the cap
  agentFailures,              // agents that got no answer from their model — their checks did not happen
  requirementsPath: reqPath,
  planPath: planFilePath,
  outputTokens: (typeof budget !== 'undefined' && budget) ? budget.spent() : undefined,
}
