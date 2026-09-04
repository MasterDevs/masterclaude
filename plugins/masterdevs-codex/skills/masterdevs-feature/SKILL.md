---
name: masterdevs-feature
description: "Build a feature through the full MasterDevs loop: settle intent, preflight, fact-check a plan for approval, then implement, refactor, verify, review, iterate, and report with minimal interruption. Use for feature-sized implementation requests, not a small mechanical edit."
---

# MasterDevs feature

Run the full feature loop in the current worktree. The approval gate is deliberate: settle every human-answerable decision before implementation, then run unattended unless the approved plan becomes impossible or conflicts with the requested scope.

Read [references/feature-loop.md](references/feature-loop.md) completely before taking action. Resolve all paths relative to this skill directory; do not assume Claude plugin environment variables exist.

Use Codex subagents exactly where the reference requests them. Keep mutating phases serial. Parallelize only independent read-only work. At the start of each phase, give the user one concise progress update and record the phase with `codex-state.mjs`.

When this invocation is an approval or continuation, resume the newest `awaiting-approval`, `running`, or `needs-attention` run instead of creating a new one.
