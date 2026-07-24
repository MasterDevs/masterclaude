---
name: roster
description: "Register a specialist reviewer (or architect lens) into the masterdevs Review Panel so it fires on matching subtasks. Appends to the user roster without touching shipped defaults. Invoke as /masterdevs:roster."
---

# /masterdevs:roster — extend the Review Panel

The Review Panel is extensible: add a performance, security, accessibility, data-privacy, or any domain reviewer, and it will fire on the subtasks its triggers match — feeding findings back into the Lessons the coding agents load. Agents from **any installed plugin** are valid.

## Step 0 — Resolve `PLAYBOOK_DIR`
`${CLAUDE_PLUGIN_DATA}/playbook` if it resolves, else `~/.claude/plugins/data/masterdevs/playbook`.

## What you do
Append a reviewer entry to `$PLAYBOOK_DIR/rosters/reviewers.user.json` (create it as `[]` if absent). This file **appends to / overrides by `name`** the shipped `reviewers.json` at build time — the defaults are never edited.

Collect from the user (ask only for what's missing):
- `name` — unique key (overrides a default reviewer if it reuses that name).
- `lens` — the review dimension (`security`, `performance`, `frontend`, `accessibility`, …). Drives the Lessons lane and matching against subtask lenses.
- `agentType` — the agent to run, e.g. `masterdevs:perf-reviewer`, or `some-plugin:their-reviewer`, or a local agent name. Confirm it's installed.
- `triggers` — any of: `{"always": true}`, `{"lenses": [...]}`, `{"globs": [...]}`, `{"sensitiveTier": true}`. The reviewer fires if **any** trigger matches (subject to tier depth: small = correctness only; sensitive = triggered + security always).
- `model` — `sonnet | opus | fable` (fail upward for sensitive lenses).
- `lessonsLane` — which `lessons/<lane>.md` its recurring findings stage into (defaults to `lens`). Create the lane's promoted + `.candidates.md` files if new.
- optional `fallbackAgentType` — used if `agentType` can't resolve (e.g. an uninstalled external plugin).

## After writing
Confirm back: the reviewer's name, when it will fire (its triggers in plain language), the model it runs on, and the lessons lane it feeds. Note it takes effect on the next `/masterdevs:feature` run.
