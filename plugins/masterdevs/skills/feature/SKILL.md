---
name: feature
description: "Run the masterdevs feature pipeline on a brief: bootstrap the Playbook, scout + architect a plan, stop for your approval, then build with model-routed engineers, a triggered review panel, a bounded fix loop, and a final integrate-and-verify pass. Invoke as /masterdevs:feature <brief>."
---

# /masterdevs:feature — orchestrated feature development

You are running the masterdevs feature pipeline. The user's brief follows the command. Work through these steps in order. Report **outcome first** (per the user's communication rules), demoting mechanism to supporting detail.

## Step 0 — Resolve paths (do this first)

- `PLUGIN_ROOT` = `${CLAUDE_PLUGIN_ROOT}` (this plugin's cache dir — read-only seeds; wiped on update).
- `DATA_DIR` = `${CLAUDE_PLUGIN_DATA}` if it resolves to a real absolute path; **otherwise fall back** to `~/.claude/plugins/data/masterdevs-masterclaude/` (the `<plugin>-<marketplace>` id; create it). All mutable state lives here — never write learned data under `PLUGIN_ROOT`.
- `PLAYBOOK_DIR` = `$DATA_DIR/playbook`
- `PLAN_PATH` = a **unique-per-run** absolute path under the plugin data dir, so plans never land inside the user's repo (no gitignore needed) and two runs never clobber each other's plan. Build it as `$DATA_DIR/plans/<repo-slug>/<run-id>.md`, where `<repo-slug>` is the basename of the git toplevel (`git rev-parse --show-toplevel`, falling back to `$(pwd)`) and `<run-id>` is a fresh identifier you generate **now** — a timestamp plus a short random suffix (e.g. `20260724-143512-a3f9`), optionally prefixed with a short kebab slug of the brief. Create `$DATA_DIR/plans/<repo-slug>/` if needed. **Reuse this exact same `PLAN_PATH` for BOTH the plan (Step 3) and build (Step 5) workflow calls** — it is the handoff between the two phases, so the build always reads the plan its own run produced. The path is outside the repo, so surface the absolute `PLAN_PATH` when you present the plan (Step 4) so the user can find and edit it.
- `ROSTER_PATH` = `$PLAYBOOK_DIR/rosters/reviewers.json`

> Parallel-run note: `PLAN_PATH` is now per-run, so concurrent runs in one repo are safe with respect to their plans. The Playbook under `$DATA_DIR` is still shared across all runs on this machine (that's intentional — it's the cross-run learning), and candidate/lesson **writes there are not locked**, so avoid two runs racing to promote/stage at the exact same moment.

## Step 1 — Bootstrap / merge the Playbook (state model §3)

1. If `$PLAYBOOK_DIR` does **not** exist: copy the shipped seeds wholesale —
   `cp -R "$PLUGIN_ROOT/playbook-seeds/" "$PLAYBOOK_DIR"` — then write `$PLAYBOOK_DIR/SEED_VERSION` with the contents of `$PLUGIN_ROOT/playbook-seeds/VERSION`.
2. If `$PLAYBOOK_DIR` exists and `SEED_VERSION` < shipped `VERSION`: **merge, don't clobber.** For each seed `catalog.md`/roster, add only entries whose pattern/name is **absent** from the user's file; never modify or delete existing rows (they may carry learned edits). Then update `SEED_VERSION`. Handle multi-version jumps (auto-update is off for third-party marketplaces).
3. Ensure candidate staging files exist (create empty with headers if missing): `patterns/<domain>/candidates.md` and `lessons/<lens>.candidates.md`.

## Step 2 — Classify tier (routing)

Quick-read the brief. If it is clearly a single small/mechanical change, set `tier: "small"` (skips Scout and the approval gate, routes to sonnet, correctness-only review). Otherwise leave tier unset — the Architect classifies per subtask, failing upward.

## Step 3 — Plan (workflow, phase 1)

Invoke the planning workflow (scripts ship as plain files — call by path). **Pass `args` as a real JSON object, never as a stringified/escaped blob** — a stringified value reaches the script as one string and the run fails immediately:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/feature-plan.js",
  args: { brief: "<the user's brief>", playbookDir: "<PLAYBOOK_DIR>", planPath: "<PLAN_PATH>", tier: "<small|unset>" }
})
```

Substitute the resolved absolute paths into the values (do not leave `<...>` placeholders or literal `$VARS`).

It returns `{summary, domains, subtaskCount, planPath, needsApproval}`.

## Step 4 — Approval gate (STOP here if needsApproval)

If `needsApproval` is true: **stop and present the plan.** Read `PLAN_PATH`, summarize the decomposition — subtasks, tier/model routing, chosen patterns, in-scope vs. flagged refactors, and any security tripwires — and ask the user to approve, edit, or reject. If they edit, they edit `PLAN.md` directly (the build phase re-reads it, so their edits win). Do not proceed until approved. If `needsApproval` is false (small tier), continue.

## Step 5 — Build (workflow, phase 2)

Again, pass `args` as a real JSON object with the resolved absolute paths substituted in:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/feature-build.js",
  args: { planPath: "<PLAN_PATH>", playbookDir: "<PLAYBOOK_DIR>", rosterPath: "<ROSTER_PATH>" }
})
```

It returns per-subtask outcomes, unresolved findings, and the integration result.

## Step 6 — Report (outcome first)

Lead with the bottom line: did it land clean, and what's the state of the code. Then:
- Per-subtask: passed / unresolved-findings / blocked, with the model that ran it.
- **Unresolved findings** surfaced verbatim — never silently dropped; these need a human.
- Integration: merged? tests passed? acceptance met? Any combined-diff duplication found.
- Note that pattern/lesson **candidates** were staged (not promoted) and can be reviewed with `/masterdevs:playbook`.

Distinguish confirmed results (tests ran, here's the output) from anything uncertain. If the build did not land clean, say so plainly and state the next step.
