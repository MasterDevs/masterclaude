---
name: feature
description: "Run the full masterdevs feature loop on a brief: interview you until the intent is settled, plan it (stop for your approval), then build unattended — Implement → Refactor → Verify ∥ Review → Iterate → Polish — in a single worktree, stopping only for a dead end or a plan-conflict. Invoke as /masterdevs:feature <brief>. For one phase on its own, use /masterdevs:refine, /masterdevs:plan, or /masterdevs:review."
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
4. **Close the learning loop before this run's agents load anything:**

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/playbook.mjs --playbook-dir "$PLAYBOOK_DIR" --promote
   ```

   Deterministic, no models, under a second. It promotes every candidate seen ≥2 times into the lanes agents actually load, so **what the last run learned, this run knows.** Report it in one line only if something moved (`promoted 3 pattern(s) into the catalog`); say nothing when there's nothing to promote.

   This exists because the `recurrence ≥2` half of the promotion gate was policy with no code behind it. Candidates piled up for weeks — 229 of them, 16 already past the bar — while every promoted file still held its empty seed header and every agent started from zero. Anything below the bar stays staged for `/masterdevs:playbook`, which is still the only way a one-off gets promoted.

## Step 2 — Interview the user until the intent is settled

**This is the highest-leverage step in the whole command.** Read `${CLAUDE_PLUGIN_ROOT}/references/interview.md` and follow it. It is the shared protocol — `/masterdevs:refine` runs the same one standalone.

In short: skip it only if the brief is already self-contained at ~95% confidence (say so in one line if you do); otherwise open with a hypothesis and a confidence number, ask one question at a time with your guess attached, stop when you can predict the answers to your next three questions, restate in seven lines including an explicit **Out of scope** and an explicit **Verify on**, and take only an explicit yes.

Carry the confirmed seven-field restate forward as `intent`.

## Step 3 — Preflight the checkout

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs
```

Takes seconds and needs no models. It checks the **machine**, not the requirements: are you on a feature branch, is the working tree clean, is this checkout far behind the default branch, plus any project-specific checks in the repo's `.masterdevs/preflight.json` (test-database freshness, migration collisions — whatever that repo needs).

Run it here, before planning, so a bad starting state is caught before twenty minutes go into a plan written against the wrong tree.

**Report warnings to the user and let them decide.** Do not fix anything yourself — rebuilding a test database or stashing someone's work can break another session that's mid-run. Show each warning with its suggested action in one line and ask whether to proceed or settle it first. If everything passes, say so in one line and move on.

## Step 4 — Refine + Plan (first call, stops for approval)

The workflow ships as a plain file — call it by path. It runs in the **current worktree**, so invoke `/masterdevs:feature` from the feature's worktree/branch. **Pass `args` as a real JSON object, never a stringified/escaped blob** (a stringified value reaches the script as one string and the run fails). Substitute resolved absolute paths (no `<...>` placeholders or literal `$VARS`):

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/feature-loop.js",
  args: { brief: "<the user's brief>", playbookDir: "<PLAYBOOK_DIR>", rosterPath: "<ROSTER_PATH>", runDir: "<RUN_DIR>",
          intent: {outcome, user, whyNow, success, constraint, outOfScope, verifyOn} }
})
```

Pass `intent` whenever you interviewed. Refine then treats scope as settled and spends its budget researching the code instead of re-deriving what to build. Omit it only when you skipped the interview. `verifyOn` is the seventh restate line — it becomes the verification's `dataSource`, so the run can say up front whether it can actually reach the data that proves the feature works.

This call runs **Refine → Plan (∥ check the success criteria) → fact-check the plan**, then **stops**. It returns either:
- `{outcome: "needs-clarification", openQuestions, requirementsPath, criteriaIssues?}` — something must be settled before anything is built. Either Refine found a contradiction *in the code* the interview couldn't have anticipated, or (when `criteriaIssues` is present) **the success criteria themselves cannot be satisfied**: two of them contradict, or one names a target correct code can never produce — classically a number that is the *current, buggy* output. Present the questions plainly, get the user's answer, and re-run with the corrected criteria folded into the brief. Do not talk them past this; a criterion that can't be met poisons the whole run.
- `{outcome: "awaiting-plan-approval", summary, stepCount, claimChecks, criteriaIssues, planRevised, dataSource, requirementsPath, planPath, outputTokens}` — the plan is ready for review.

## Step 5 — Plan approval gate (STOP — the last interruption before the run goes dark)

Do this **in the same sitting as the interview**. The user's attention is already here; sending them away and pulling them back costs another context load.

Read `planPath` (and `requirementsPath` for context). Summarize the plan — the design approach, the steps, the resolved patterns, and the success criteria Verify will check — and ask the user to **approve, edit, or reject**. Human edits to `plan.md` win (the next call re-reads the file, so their edits are authoritative). Do not proceed until approved.

**Surface what the plan assumed but couldn't confirm.** The workflow fact-checks the plan's claims about the code before you ever see it, and returns `claimChecks`:

- **`unverifiable`** — say these out loud, every one. The plan is proceeding on an assumption nobody could settle from this checkout ("the production count was never checked"). This is the cheapest moment in the whole run to resolve one, and often the user simply knows the answer.
- **`refuted`** — already handled: the plan was sent back and revised once (`planRevised: true`). Mention in one line that it was corrected and what changed, so the user knows the plan they're reading isn't the first draft.
- **`verified`** — a count, not a list.

Also state `dataSource` in one line — what the verification will actually run against. If it says the data isn't reachable here, that's a decision the user should make now, not read about at the end. Any `criteriaIssues` that reach this point are `unverifiable` ones — say which criterion can't be proven here and what would settle it.

Before you hand off, ask yourself the question the rest of the run depends on: **is there anything left that a human could answer now?** After this gate the agents are on their own until they finish. If a step's guidance makes you uneasy, or a success criterion is ambiguous, or you're unsure whether something is in scope — raise it here. This is the last free moment.

## Step 6 — Run the loop (second call, `startFrom: "implement"`) with 5-minute status updates

On approval, resume into the Implement → Refactor → (Verify ∥ Review) → Iterate loop with the **same `runDir`**.

**First, pass these two inline — do not skip this.** You just read both files at the approval gate, so you already have the content; omitting them makes the workflow spawn an agent to re-read them. Measured across real runs, **53 of 54 loop invocations paid that toll** at ~69K tokens each, purely because this step was treated as optional:

- **`approved`** — parse the trailing fenced ` ```json ` block from `requirementsPath` and from `planPath` (the human may have edited them at the gate; those files are authoritative) and pass them as `{refine: <requirements json>, plan: <plan json>}`.
- **`userReviewers`** — the array in `$PLAYBOOK_DIR/rosters/reviewers.user.json`, or `[]` if the file is absent or empty.

The fallback exists for standalone invocations that never went through this skill. If you are here, you have the data — pass it. Run it **in the background** so this session can post progress while it works:

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
3. On each wakeup, run:

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/run-status.mjs <runId>
   ```

   and post its output verbatim. It reads the live per-agent state and prints at most two lines — the timestamp and what's running now, then what the last finished agent actually found:

   ```
   ⏳ 2:47 PM PDT · Verify · verify:1.0 running commands (37 steps, 14m) · 41m total
      review:reviewer:1 → review — high in bucket_values.py:900: The dollar total multiplies each bucket rate by the whole revenue history
   ```

   The second line is the point of the whole heartbeat: it is what lets the user stop a run that's heading somewhere wrong. A status that only says the machine is busy cannot do that.

   It also flags a stall (`⚠ no progress for 23m`) — worth calling out in your own words if you see it, since that usually means an agent is stuck rather than working.

   **Add a sentence of your own only when you have something the script cannot see** — the run is on its second round for the same finding, or an escalation just landed that changes what the user should expect. Otherwise post the two lines and nothing else; the value here is that it stays skimmable.

   Then re-schedule (step 2).
4. When the run's `status` is no longer running (`completed`/`killed`) **or** its completion notification arrives, **stop the heartbeat** (`ScheduleWakeup` with `stop: true`) and go to Step 7.

If this session is closed, the 5-minute posts stop but the run keeps going — catch up via `/workflows` or the completion notification. (The quick Refine+Plan call and the approval gate are **not** wrapped in this heartbeat — only this long loop is.)

When the loop returns `{outcome, iterations, changedFiles, verifyPassed, verifyNeedsApproval, conflicts, escalations, punted, polishApplied, deferred, unresolvedBlocking, requirementsPath, planPath, outputTokens}`, three fields may need you mid-flight:
- **`conflicts` non-empty** — the loop found revisions that clash with the requirements/plan and **stopped there**, because only a human can settle them. Present each (`finding` vs. `conflictsWith`) and ask how to resolve; on the user's decision, re-run this call with that decision in the brief. Note that the loop ended early, so remaining work may still be outstanding.
- **`escalations` non-empty** — an agent hit something the plan didn't predict: a file not shaped as described, a missing dependency, an approach that would break existing behavior. If `outcome` is `blocked`, work stopped there. Otherwise the agent found a way forward and kept going — surface these anyway, since a human should confirm the path it chose.
- **`impossibleCriteria` non-empty** — Verify found that a success criterion **cannot be met by correct code**: the target itself is wrong (typically a number that turns out to be the pre-fix value). The loop stopped immediately rather than throwing engineers at it. Present the criterion and what Verify found, and get a corrected criterion before re-running — **re-running with the same criteria repeats the whole cost for the same result.** This has happened: one feature spent 5.8M tokens across two full loops on criteria that were internally contradictory the entire time.
- **`verifyNeedsApproval` non-empty** — Verify declined to run risky/destructive steps (e.g. an infra apply, an external mutation). Surface them; the user runs or authorizes them out of band.

## Step 7 — Report

Read `${CLAUDE_PLUGIN_ROOT}/references/reporting.md` and follow it. That file owns the structure, the altitude rules, and the 25-line cap.

Feature-run specifics on top of it:

- **Bottom line** is framed against the success criteria from the confirmed intent — not against `outcome: "passed"`.
- **Needs you** draws from `conflicts`, `escalations`, `verifyNeedsApproval`, and `unresolvedBlocking`. Each gets a recommendation and a stated default.
- **For the record** covers `polishApplied` (say plainly: regression-checked, **not** re-reviewed — that trade is deliberate), `punted` (the backlog this run generated), `deferred`, and any escalations the agents resolved themselves. One line each.
- **Stats line:** wall clock, agents, `outputTokens`, artifact paths (`requirementsPath` / `planPath`), and the **interruption count** for this feature — interview and plan gate included. That last number is the metric this design optimizes, so it belongs in every report.
- Note pattern/lesson **candidates** were staged, not promoted — one clause, reviewable with `/masterdevs:playbook`.
