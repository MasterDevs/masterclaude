---
name: masterdevs-roster
description: Register a Codex-compatible specialist reviewer in the MasterDevs review panel. Use when the user explicitly wants to add or update a review lens.
---

# MasterDevs reviewer roster

Resolve `PLUGIN_ROOT` as two directories above this skill. Resolve the Playbook with `node "$PLUGIN_ROOT/scripts/codex-state.mjs" paths --json`. Store user reviewers in `playbook/rosters/reviewers.codex.json`; never edit shipped `reviewers.json`.

Each entry contains:

```json
{
  "name": "unique-name",
  "lens": "accessibility",
  "roleSkill": "installed-skill-name",
  "triggers": {"always": true, "lenses": [], "globs": [], "sensitiveTier": false},
  "model": "optional model override",
  "reasoningEffort": "optional effort override",
  "lessonsLane": "accessibility"
}
```

Ask only for missing fields. Confirm the named role skill is installed and suitable for read-only review. Create the lesson lane and candidate file when new. Replace entries by `name`; otherwise append. Report when it fires and which lane it feeds.
