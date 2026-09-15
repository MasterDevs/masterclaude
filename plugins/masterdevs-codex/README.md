# masterdevs (Codex adapter)

This is the Codex-native adapter for MasterDevs. It installs as `masterdevs@masterclaude-codex` and ships from `plugins/masterdevs-codex/` — the directory keeps the `-codex` suffix so the two adapters stay obvious side by side, while the installed plugin is named for the product. It packages explicit `$masterdevs-*` skills, internal Architect/Engineer/Reviewer role skills, shared interview and reporting protocols, preflight, and a self-learning Playbook with three lanes — pattern catalogs, reviewer lessons, and a gold lane of curated examples a human captured.

The full entry point is `$masterdevs-feature`. Standalone entry points are `$masterdevs-refine`, `$masterdevs-plan`, `$masterdevs-review`, `$masterdevs-playbook`, `$masterdevs-roster`, and `$masterdevs-gold`.

The adapter deliberately lives beside `plugins/masterdevs` instead of inside it. Codex supplements a manifest's custom skill path with default skill discovery, so a mixed plugin would also expose Claude-specific skills. Separate distributable roots keep both runtimes unambiguous.

See [the Codex guide](../../docs/CODEX.md) for installation, local testing, state, and reload instructions.
