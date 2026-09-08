---
name: roster
description: "Register a specialist reviewer (or architect lens) into the masterdevs Review Panel so it fires on matching subtasks. Appends to the user roster without touching shipped defaults. Invoke as /masterdevs:roster."
---

# /masterdevs:roster — extend the Review Panel

The Review Panel is extensible: add a performance, security, accessibility, data-privacy, or any domain reviewer, and it will fire on the subtasks its triggers match — feeding findings back into the Lessons the coding agents load. Agents from **any installed plugin** are valid.

## Step 0 — Resolve `PLAYBOOK_DIR`
`${CLAUDE_PLUGIN_DATA}/playbook` if it resolves, else `~/.claude/plugins/data/masterdevs/playbook`.

## What you do
Append a reviewer entry to `$PLAYBOOK_DIR/rosters/reviewers.user.json` (create it as `[]` if absent). Entries here **run in addition to** the shipped default reviewer; the defaults are never edited. Reusing a default's `name` does not currently replace it — both run — so pick a distinct name.

Collect from the user (ask only for what's missing):
- `name` — unique key. Pick one no shipped default uses; a repeat adds a second reviewer rather than replacing the first.
- `lens` — the review dimension (`security`, `performance`, `frontend`, `accessibility`, …). Drives the Lessons lane and matching against subtask lenses.
- `agentType` — the agent to run, e.g. `some-plugin:accessibility-reviewer`, or a local agent name. Confirm it's installed. (The masterdevs default is a single combined `masterdevs:reviewer` covering security/performance/design/correctness; add your own here to run alongside it.)
- `triggers` — any of: `{"always": true}`, `{"lenses": [...]}`, `{"globs": [...]}`, `{"sensitiveTier": true}`. Recorded for the roster but **not yet honored**: the workflow currently runs every entry on every round, so treat these as intent rather than as filtering.
- `model` — `sonnet | opus | fable` (fail upward for sensitive lenses).
- `lessonsLane` — which `lessons/<lane>.md` its recurring findings stage into (defaults to `lens`). Create the lane's promoted + `.candidates.md` files if new.
- optional `fallbackAgentType` — used if `agentType` can't resolve (e.g. an uninstalled external plugin).

## After writing
Confirm back: the reviewer's name, when it will fire (its triggers in plain language), the model it runs on, and the lessons lane it feeds. Note it takes effect on the next `/masterdevs:feature` run.
