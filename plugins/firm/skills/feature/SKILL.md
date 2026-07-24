---
name: feature
description: "Run the firm feature pipeline on a brief: bootstrap the Playbook, scout + architect a plan, stop for your approval, then build with model-routed engineers, a triggered review panel, a bounded fix loop, and a final integrate-and-verify pass. Invoke as /firm:feature <brief>."
---

# /firm:feature — orchestrated feature development

You are running the firm feature pipeline. The user's brief follows the command. Work through these steps in order. Report **outcome first** (per the user's communication rules), demoting mechanism to supporting detail.

## Step 0 — Resolve paths (do this first)

- `PLUGIN_ROOT` = `${CLAUDE_PLUGIN_ROOT}` (this plugin's cache dir — read-only seeds; wiped on update).
- `DATA_DIR` = `${CLAUDE_PLUGIN_DATA}` if it resolves to a real absolute path; **otherwise fall back** to `~/.claude/plugins/data/firm/` (create it). All mutable state lives here — never write learned data under `PLUGIN_ROOT`.
- `PLAYBOOK_DIR` = `$DATA_DIR/playbook`
- `PLAN_PATH` = an absolute path in the current repo, e.g. `$(pwd)/.firm/PLAN.md` (create `.firm/` if needed; suggest the user gitignore it).
- `ROSTER_PATH` = `$PLAYBOOK_DIR/rosters/reviewers.json`

## Step 1 — Bootstrap / merge the Playbook (state model §3)

1. If `$PLAYBOOK_DIR` does **not** exist: copy the shipped seeds wholesale —
   `cp -R "$PLUGIN_ROOT/playbook-seeds/" "$PLAYBOOK_DIR"` — then write `$PLAYBOOK_DIR/SEED_VERSION` with the contents of `$PLUGIN_ROOT/playbook-seeds/VERSION`.
2. If `$PLAYBOOK_DIR` exists and `SEED_VERSION` < shipped `VERSION`: **merge, don't clobber.** For each seed `catalog.md`/roster, add only entries whose pattern/name is **absent** from the user's file; never modify or delete existing rows (they may carry learned edits). Then update `SEED_VERSION`. Handle multi-version jumps (auto-update is off for third-party marketplaces).
3. Ensure candidate staging files exist (create empty with headers if missing): `patterns/<domain>/candidates.md` and `lessons/<lens>.candidates.md`.

## Step 2 — Classify tier (routing)

Quick-read the brief. If it is clearly a single small/mechanical change, set `tier: "small"` (skips Scout and the approval gate, routes to sonnet, correctness-only review). Otherwise leave tier unset — the Architect classifies per subtask, failing upward.

## Step 3 — Plan (workflow, phase 1)

Invoke the planning workflow (scripts ship as plain files — call by path):

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/feature-plan.js",
  args: { brief: "<the user's brief>", playbookDir: "<PLAYBOOK_DIR>", planPath: "<PLAN_PATH>", tier: "<small|unset>" }
})
```

It returns `{summary, domains, subtaskCount, planPath, needsApproval}`.

## Step 4 — Approval gate (STOP here if needsApproval)

If `needsApproval` is true: **stop and present the plan.** Read `PLAN_PATH`, summarize the decomposition — subtasks, tier/model routing, chosen patterns, in-scope vs. flagged refactors, and any security tripwires — and ask the user to approve, edit, or reject. If they edit, they edit `PLAN.md` directly (the build phase re-reads it, so their edits win). Do not proceed until approved. If `needsApproval` is false (small tier), continue.

## Step 5 — Build (workflow, phase 2)

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
- Note that pattern/lesson **candidates** were staged (not promoted) and can be reviewed with `/firm:playbook`.

Distinguish confirmed results (tests ran, here's the output) from anything uncertain. If the build did not land clean, say so plainly and state the next step.
