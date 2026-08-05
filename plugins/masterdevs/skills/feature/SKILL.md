---
name: feature
description: "Run the masterdevs feature loop on a brief: bootstrap the Playbook, then one RPI-style loop in a single worktree — Refine → Plan (stop for your approval) → Implement → Refactor → Verify → Review → Iterate — pausing only for blocking questions or plan-conflicts. Invoke as /masterdevs:feature <brief>."
---

# /masterdevs:feature — orchestrated feature development

You are running the masterdevs feature loop. The user's brief follows the command. Work through these steps in order. Report **outcome first** (per the user's communication rules), demoting mechanism to supporting detail.

The engine is a single RPI-style loop in one worktree — **Refine → Plan → Implement → Refactor → (Verify ∥ Review) → Iterate**, closing with a **Polish** pass — where each phase runs in a fresh context seeded by the prior phase's terse artifact, so context stays small and cheap. Verify and Review run concurrently (both are read-only). The loop buys another round **only** for critical/high findings or a failed verification; medium/low findings are batched into the single closing Polish pass instead. It runs **autonomously**: it stops only when Refine has a blocking question, when Iterate surfaces a plan-conflict, or when it finishes.

## Step 0 — Resolve paths (do this first)

- `PLUGIN_ROOT` = `${CLAUDE_PLUGIN_ROOT}` (this plugin's cache dir — read-only seeds; wiped on update).
- `DATA_DIR` = `${CLAUDE_PLUGIN_DATA}` if it resolves to a real absolute path; **otherwise fall back** to `~/.claude/plugins/data/masterdevs-masterclaude/` (the `<plugin>-<marketplace>` id; create it). All mutable state lives here — never write learned data under `PLUGIN_ROOT`.
- `PLAYBOOK_DIR` = `$DATA_DIR/playbook`
- `ROSTER_PATH` = `$PLAYBOOK_DIR/rosters/reviewers.json`
- `RUN_DIR` = a **unique-per-run** scratch dir for this run's human-readable artifacts (requirements + plan), outside the user's repo so nothing needs gitignoring. Build it as `$DATA_DIR/runs/<repo-slug>/<run-id>/`, where `<repo-slug>` is the basename of the git toplevel (`git rev-parse --show-toplevel`, falling back to `$(pwd)`) and `<run-id>` is a fresh identifier you generate **now** — a timestamp plus a short random suffix (e.g. `20260724-143512-a3f9`), optionally prefixed with a short kebab slug of the brief. Create it.

> The Playbook under `$DATA_DIR` is shared across all runs on this machine (that's intentional — it's the cross-run learning), and candidate/lesson **writes there are not locked**, so avoid two runs racing to promote/stage at the exact same moment.

## Step 1 — Bootstrap / merge the Playbook

1. If `$PLAYBOOK_DIR` does **not** exist: copy the shipped seeds wholesale —
   `cp -R "$PLUGIN_ROOT/playbook-seeds/" "$PLAYBOOK_DIR"` — then write `$PLAYBOOK_DIR/SEED_VERSION` with the contents of `$PLUGIN_ROOT/playbook-seeds/VERSION`.
2. If `$PLAYBOOK_DIR` exists and `SEED_VERSION` < shipped `VERSION`: **merge, don't clobber.** For each seed `catalog.md`/roster, add only entries whose pattern/name is **absent** from the user's file; never modify or delete existing rows (they may carry learned edits). Then update `SEED_VERSION`. Handle multi-version jumps (auto-update is off for third-party marketplaces).
3. Ensure candidate staging files exist (create empty with headers if missing): `patterns/<domain>/candidates.md` and `lessons/<lens>.candidates.md`.

## Step 2 — Refine + Plan (first call, stops for approval)

The workflow ships as a plain file — call it by path. It runs in the **current worktree**, so invoke `/masterdevs:feature` from the feature's worktree/branch. **Pass `args` as a real JSON object, never a stringified/escaped blob** (a stringified value reaches the script as one string and the run fails). Substitute resolved absolute paths (no `<...>` placeholders or literal `$VARS`):

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/feature-loop.js",
  args: { brief: "<the user's brief>", playbookDir: "<PLAYBOOK_DIR>", rosterPath: "<ROSTER_PATH>", runDir: "<RUN_DIR>" }
})
```

This first call runs **Refine → Plan**, then **stops**. It returns either:
- `{outcome: "needs-clarification", openQuestions, requirementsPath}` — Refine hit a blocking ambiguity/contradiction. **Stop and ask the user** the questions; when answered, re-run this call with the answers folded into the brief.
- `{outcome: "awaiting-plan-approval", summary, stepCount, requirementsPath, planPath, outputTokens}` — the plan is ready for review.

## Step 3 — Plan approval gate (STOP)

Read `planPath` (and `requirementsPath` for context). Summarize the plan — the design approach, the steps, the resolved patterns, and the success criteria Verify will check — and ask the user to **approve, edit, or reject**. Human edits to `plan.md` win (the next call re-reads the file, so their edits are authoritative). Do not proceed until approved.

## Step 4 — Run the loop (second call, `startFrom: "implement"`) with 5-minute status updates

On approval, resume into the Implement → Refactor → (Verify ∥ Review) → Iterate loop with the **same `runDir`**.

First, read the two things the loop would otherwise spend an agent apiece fetching, and pass them inline:

- **`approved`** — parse the trailing fenced ` ```json ` block from `requirementsPath` and from `planPath` (the human may have edited them at the gate; those files are authoritative) and pass them as `{refine: <requirements json>, plan: <plan json>}`.
- **`userReviewers`** — the array in `$PLAYBOOK_DIR/rosters/reviewers.user.json`, or `[]` if the file is absent or empty.

Both are optional: omit either and the workflow falls back to loading it itself. Run it **in the background** so this session can post progress while it works:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/feature-loop.js",
  args: { brief: "<the user's brief>", playbookDir: "<PLAYBOOK_DIR>", rosterPath: "<ROSTER_PATH>", runDir: "<RUN_DIR>",
          startFrom: "implement", approved: {refine: {...}, plan: {...}}, userReviewers: [] },
  run_in_background: true
})
```

The call returns a **run id** immediately. **Post a status line to this chat every ~5 minutes while the loop runs** — this cadence is a deliberate user requirement, not completion-polling:

1. Record the start time and the run id.
2. Schedule the next check ~5 minutes out with `ScheduleWakeup` (`delaySeconds: 300`, a `reason` like "masterdevs 5-min status update", and a `prompt` that re-enters this status step for this run id).
3. On each wakeup, read the run's **live progress** — via its task status, or its state file at `~/.claude/projects/<encoded-cwd>/<session>/workflows/<runId>.json` (fields `status`, `phases`, `workflowProgress`, `agentCount`, `startTime`) — and post **one concise line** to the chat, e.g. `⏳ masterdevs: Verify (iteration 2/3) · 3 agents run · 11 min elapsed`. Then re-schedule (step 2).
4. When the run's `status` is no longer running (`completed`/`killed`) **or** its completion notification arrives, **stop the heartbeat** (`ScheduleWakeup` with `stop: true`) and go to Step 5.

If this session is closed, the 5-minute posts stop but the run keeps going — catch up via `/workflows` or the completion notification. (The quick Refine+Plan call and the approval gate are **not** wrapped in this heartbeat — only this long loop is.)

When the loop returns `{outcome, iterations, changedFiles, verifyPassed, verifyNeedsApproval, conflicts, polishApplied, deferred, unresolvedBlocking, requirementsPath, planPath, outputTokens}`, two fields need you mid-flight:
- **`conflicts` non-empty** — the loop found revisions that clash with the requirements/plan and **stopped there**, because only a human can settle them. Present each (`finding` vs. `conflictsWith`) and ask how to resolve; on the user's decision, re-run this call with that decision in the brief. Note that the loop ended early, so remaining work may still be outstanding.
- **`verifyNeedsApproval` non-empty** — Verify declined to run risky/destructive steps (e.g. an infra apply, an external mutation). Surface them; the user runs or authorizes them out of band.

## Step 5 — Report (outcome first)

Lead with the bottom line: did it land clean (`outcome: "passed"`), and what's the state of the code. Then:
- **Verify:** passed or not, against which success criteria; any steps it declined to run (`verifyNeedsApproval`).
- **Review:** any `unresolvedBlocking` (high/critical) findings still open after the cap — surfaced verbatim; these need a human.
- **Conflicts:** anything left for the user to decide.
- **Polish:** what `polishApplied` covers — medium/low revisions applied in one closing pass. Say plainly that these were regression-checked but **not** re-reviewed; that trade is deliberate.
- **Deferred:** what was intentionally **not** addressed and why (record it plainly — this is a deliberate decision, not a silent drop).
- **Iterations:** how many loop passes ran (1 or 2). Point the user at `requirementsPath` / `planPath` for the artifacts.
- Note pattern/lesson **candidates** were staged (not promoted) — reviewable with `/masterdevs:playbook`.
- If `outputTokens` is present, report it as a rough cost signal.

Distinguish confirmed results (tests ran, here's the output) from anything uncertain. If it did not land clean, say so plainly and state the next step.
