---
name: masterdevs-refine
description: Turn a fuzzy feature idea into a confirmed seven-field intent through a focused interview and brief code-grounding pass. Use when the user wants to settle what to build without planning or implementation.
---

# MasterDevs refine

Resolve `PLUGIN_ROOT` as two directories above this skill. Read `$PLUGIN_ROOT/references/interview.md` completely and run that interview even when the initial idea sounds plausible; the interview is the deliverable.

After explicit confirmation, inspect the relevant code briefly to check that assumed abstractions and constraints exist. If evidence changes the picture, revise only the affected intent lines and reconfirm them.

Return the confirmed fields: Outcome, User, Why now, Success, Constraint, Out of scope, and Verify on. Do not plan or implement. Offer to persist the intent only if the user asks; use `codex-state.mjs paths --json` to resolve a worktree-safe data directory.
