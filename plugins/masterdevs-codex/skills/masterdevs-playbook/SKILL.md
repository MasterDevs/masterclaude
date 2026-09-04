---
name: masterdevs-playbook
description: Curate the MasterDevs pattern and lesson Playbook by promoting recurrent candidates, reviewing one-offs, merging duplicates, or pruning stale knowledge. Use only for explicit Playbook maintenance requests.
---

# MasterDevs Playbook

Resolve `PLUGIN_ROOT` as two directories above this skill. Resolve paths with `node "$PLUGIN_ROOT/scripts/codex-state.mjs" paths --json`. Run `node "$PLUGIN_ROOT/scripts/playbook.mjs" --playbook-dir "<playbookDir>" --status`, then promote recurrence-qualified entries deterministically with `--promote`.

For human review, group candidates by detection shape rather than wording, sum honest recurrence, and present at most ten groups ranked by recurrence and recent relevance. For each, recommend promote, reject, or edit. Never modify shipped seeds. Only recurrence of at least two or explicit human confirmation may write to promoted lanes.

Report promoted, rejected, merged, and pruned entries by count and name.
