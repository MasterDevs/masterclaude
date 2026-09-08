---
name: masterdevs-plan
description: Produce a fact-checkable MasterDevs implementation plan from a settled request without changing code. Use when the user wants to inspect and challenge design before implementation.
---

# MasterDevs plan

Resolve `PLUGIN_ROOT` as two directories above this skill. Settle the ask first. When it is unclear, read and use `$PLUGIN_ROOT/references/interview.md` for a short interview.

Run `node "$PLUGIN_ROOT/scripts/codex-state.mjs" paths --json` to resolve the Playbook. Pick the lens the ask belongs to and read `playbook/rosters/architects.codex.defaults.json` for the catalogs that lens names; when no lens fits, use `core` plus the catalogs the ask actually touches. Delegate one read-only subagent as that lens's `$<roleSkill>` — `$masterdevs-architect` by default; give it the settled ask, those catalog paths, the refactor backlog, and repository evidence.

Fact-check every returned claim with targeted reads or a separate read-only subagent. Present the approach, steps, design choices worth challenging, and claim verdicts. Ask what is wrong with the plan rather than asking for build approval. Do not edit application code.
