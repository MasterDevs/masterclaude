# Repository guidance

This repository ships parallel Claude Code and Codex adapters over the same MasterDevs product design.

## Change boundaries

- Keep `plugins/masterdevs/workflows/feature-loop.js` compatible with the Claude workflow runtime.
- Keep Codex-specific orchestration under the isolated `plugins/masterdevs-codex/` plugin. Do not add Codex components to the Claude plugin's default discovery paths.
- Shared interview, reporting, Playbook, and evaluation semantics should not drift between adapters.
- Never write learned entries directly to promoted Playbook lanes; stage candidates and use the recurrence or human-confirmation gate.

## Verification

- Run `node scripts/loop-scenarios.mjs` after changing feature-loop semantics.
- Run `node scripts/codex-state-scenarios.mjs` after changing Codex state handling.
- Validate `plugins/masterdevs-codex` with the installed plugin-creator validator after changing Codex packaging.
- Validate every Codex skill with the installed skill-creator `quick_validate.py` helper.
