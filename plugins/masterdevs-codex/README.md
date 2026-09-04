# masterdevs-codex

This is the Codex-native adapter for MasterDevs. It packages explicit `$masterdevs-*` skills, internal Architect/Engineer/Reviewer role skills, shared interview and reporting protocols, preflight, and a self-learning Playbook.

The full entry point is `$masterdevs-feature`. Standalone entry points are `$masterdevs-refine`, `$masterdevs-plan`, `$masterdevs-review`, `$masterdevs-playbook`, and `$masterdevs-roster`.

The adapter deliberately lives beside `plugins/masterdevs` instead of inside it. Codex supplements a manifest's custom skill path with default skill discovery, so a mixed plugin would also expose Claude-specific skills. Separate distributable roots keep both runtimes unambiguous.

See [the Codex guide](../../docs/CODEX.md) for installation, local testing, state, and reload instructions.
