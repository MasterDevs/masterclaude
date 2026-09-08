---
name: masterdevs-roster
description: Register a Codex-compatible specialist reviewer in the MasterDevs review panel. Use when the user explicitly wants to add or update a review lens.
---

# MasterDevs reviewer roster

Resolve `PLUGIN_ROOT` as two directories above this skill. Resolve the Playbook with `node "$PLUGIN_ROOT/scripts/codex-state.mjs" paths --json`. Store user reviewers in `playbook/rosters/reviewers.codex.user.json`; never edit the shipped `playbook/rosters/reviewers.codex.defaults.json`. An entry you write there replaces a shipped default of the same `name`.

Each entry contains:

```json
{
  "name": "unique-name",
  "lens": "accessibility",
  "roleSkill": "installed-skill-name",
  "triggers": {"always": true, "lenses": [], "globs": [], "sensitiveTier": false},
  "lessonsLane": "accessibility"
}
```

`always: true` fires on every review regardless of the other triggers; `lenses` and `globs` match the
change; `sensitiveTier` fires on security-sensitive scope. An entry with `always: false` and every list
empty matches nothing and never runs — set `always: true`, or use `lens: "all"`, if you want it on
every review.

Codex sets the model and reasoning effort for the whole session, not per agent, so an entry carries no
model or effort field. `roleSkill` is the installed skill name without the `$` — the panel invokes it as
`$<roleSkill>`.

Name only a read-only skill. Never name a workspace-writing one such as `masterdevs-engineer`: the
panel runs concurrently with the verifier, which reads the tree while the suite runs.

Ask only for missing fields. Confirm the named role skill is installed and suitable for read-only review. Create the lesson lane and candidate file when new. Replace entries by `name`; otherwise append. Report when it fires and which lane it feeds.
