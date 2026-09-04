---
name: masterdevs-review
description: Run the MasterDevs read-only review panel over current changes and report push-blocking risks separately from advisory findings. Use for review requests without implementation.
---

# MasterDevs review

Determine scope in this order: user-specified range; uncommitted work against `HEAD`; otherwise the branch merge-base with the default branch. State the selected range. If empty, stop. If larger than roughly 2,000 changed lines, recommend a narrower review and wait for confirmation.

Resolve `PLUGIN_ROOT` as two directories above this skill, then resolve the Playbook with `node "$PLUGIN_ROOT/scripts/codex-state.mjs" paths --json`. Spawn the default reviewer explicitly using `$masterdevs-reviewer` plus matching entries from `playbook/rosters/reviewers.codex.json`. Run reviewers concurrently and read-only. Give each the exact diff command and the known or inferred intent.

Deduplicate findings. Read `$PLUGIN_ROOT/references/reporting.md` and report whether the change is safe to push. Critical/high findings need a recommendation and default; medium/low findings get one line each. Do not fix anything or run tests.
