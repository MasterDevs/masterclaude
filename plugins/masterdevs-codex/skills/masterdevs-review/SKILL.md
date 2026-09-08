---
name: masterdevs-review
description: Run the MasterDevs read-only review panel over current changes and report push-blocking risks separately from advisory findings. Use for review requests without implementation.
---

# MasterDevs review

Determine scope in this order: user-specified range; uncommitted work against `HEAD`; otherwise the branch merge-base with the default branch. State the selected range. If empty, stop. If larger than roughly 2,000 changed lines, recommend a narrower review and wait for confirmation.

Resolve `PLUGIN_ROOT` as two directories above this skill, then resolve the Playbook with `node "$PLUGIN_ROOT/scripts/codex-state.mjs" paths --json`. Build the panel from the shipped defaults in `playbook/rosters/reviewers.codex.defaults.json` plus any entries in `playbook/rosters/reviewers.codex.user.json` whose triggers match, where an entry replaces a shipped default of the same `name`. An entry with no `triggers`, or with `lens: "all"`, always runs; if the user file is absent, empty, or unreadable, run the shipped defaults alone. Invoke each entry as `$<roleSkill>`; the shipped default is `$masterdevs-reviewer` alone. Run reviewers concurrently and read-only. Give each the exact diff command and the known or inferred intent.

Deduplicate findings. Read `$PLUGIN_ROOT/references/reporting.md` and report whether the change is safe to push. Critical/high findings need a recommendation and default; medium/low findings get one line each. Do not fix anything or run tests.
