# Changelog

Notable changes to `masterdevs`. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning is [semver](https://semver.org/), pre-1.0 — **minor versions may break interfaces** (schemas
gain required fields, result fields change meaning). Pin a version if that matters to you.

## [0.18.0](https://github.com/MasterDevs/masterclaude/compare/v0.17.0...v0.18.0) (2026-10-27)


### Added

* toggle the status pane from a button or /masterdevs-status ([#10](https://github.com/MasterDevs/masterclaude/issues/10)) ([c135eae](https://github.com/MasterDevs/masterclaude/commit/c135eae0d8d86dea8be4a3a7d209ed2f5cca169a))

## [0.17.0](https://github.com/MasterDevs/masterclaude/compare/v0.16.0...v0.17.0) (2026-10-09)


### Added

* show a live progress pane while the feature loop runs ([#8](https://github.com/MasterDevs/masterclaude/issues/8)) ([de0ddc0](https://github.com/MasterDevs/masterclaude/commit/de0ddc056a1ae04d644b4b087e91181875e0e3f2))

## [0.16.0](https://github.com/MasterDevs/masterclaude/compare/v0.15.1...v0.16.0) (2026-10-08)


### ⚠ BREAKING CHANGES

* an installed copy must be removed and re-added under the new name — `codex plugin remove masterdevs-codex@masterclaude-codex` then `codex plugin add masterdevs@masterclaude-codex`.

### Added

* add the gold lane — curated examples agents can read ([#4](https://github.com/MasterDevs/masterclaude/issues/4)) ([2924e8a](https://github.com/MasterDevs/masterclaude/commit/2924e8a7259ff374cba75a6a14b9d3bb4719f82b))
* plan on Fable, the strongest model, while every other phase stays put ([#7](https://github.com/MasterDevs/masterclaude/issues/7)) ([34a0e44](https://github.com/MasterDevs/masterclaude/commit/34a0e447404309ab87475179d3156dd301a529b7))
* run the MasterDevs feature loop inside Codex ([#5](https://github.com/MasterDevs/masterclaude/issues/5)) ([68ef1a4](https://github.com/MasterDevs/masterclaude/commit/68ef1a47f60e76e8316ef3dfaa25325831d85ed5))

## [0.15.1](https://github.com/MasterDevs/masterclaude/compare/v0.15.0...v0.15.1) (2026-08-20)


### Fixed

* run the full test suite once per round, not dozens of times ([#2](https://github.com/MasterDevs/masterclaude/issues/2)) ([37c4794](https://github.com/MasterDevs/masterclaude/commit/37c4794e912066ed887da3c0365255b76f475e93))

## [0.15.0] — 2026-08-17

First public release. Everything below landed during pre-release development and is summarized here
because it explains why the design is shaped the way it is — nearly every decision came from measuring
a real run that went badly.

### Added

- **Interview before planning.** Hypothesis with a confidence number, one question at a time with a
  guess attached, stopping when it can predict your next three answers. The restate carries a mandatory
  **Out of scope** line and a **Verify on** line naming what proves the feature works and on what data.
- **Preflight** (`scripts/preflight.mjs`) — checks the checkout is fit to work in before planning
  starts: feature branch, clean tree, distance from the default branch, plus per-repo checks declared in
  `.masterdevs/preflight.json`. Reports and recommends; never fixes.
- **Plan fact-checking.** The architect must state the facts its plan depends on, each with the check
  that settles it. Those run before you see the plan; refuted claims send it back for one revision,
  and unverifiable ones surface at the approval gate.
- **Success-criteria check.** Runs alongside the architect, so it costs no extra waiting. Criteria that
  contradict each other, or name a target correct code can never produce, stop the run and come back as
  a question.
- **Standalone phase commands** — `/masterdevs:refine`, `/masterdevs:plan`, `/masterdevs:review` — for
  when you want one phase without the rest.
- **Verification memory.** A per-repo note (env setup, suite command, how to reach the app) reused by
  every future feature in that repo, plus a per-run log of which criteria passed and how.
- **Automatic playbook promotion** (`scripts/playbook.mjs`) — the `recurrence ≥2` half of the promotion
  gate, which had been documented policy with no code behind it. Runs at the start of every feature, so
  what one run learns the next run knows.
- **Live status** (`scripts/run-status.mjs`) — the 5-minute heartbeat now reports what agents are
  actually doing and what the last one found, so you can intervene when something looks wrong.
- **Craft standards** for generated code: low branching, written for a reader who has never seen the
  file, and reuse searched repo-wide before anything new is authored. Every plan step must name the
  existing code it should extend.
- **Measurement** (`scripts/run-report.mjs`) — unplanned stops per feature, read from workflow state
  Claude Code already writes. Works retroactively; snapshots commit to `evals/results/`.
- **Control-flow tests** (`scripts/loop-scenarios.mjs`, `scripts/mutation-check.mjs`) — 26 scenarios
  against the real workflow with a stubbed agent layer, plus a mutation checker that breaks the loop 41
  ways and asserts the suite goes red.

### Changed

- **One loop, not a multi-workflow pipeline.** Refine → Plan → Implement → Refactor → (Verify ∥ Review)
  → Iterate → Polish, each phase in a fresh context seeded by the previous phase's terse artifact.
- **Capped at 2 rounds, and minor findings can't buy one.** Earlier versions ran three rounds and
  re-reviewed after every revision; the findings list churned rather than converged, at 50–67% of the
  run's cost. Medium/low findings now batch into a single closing Polish pass.
- **Verify and Review run concurrently** — both are read-only, which saves roughly 12 minutes per
  iteration. Verify's fix agents are hoisted out and run serially afterward.
- **Escalate-and-continue.** An agent that hits a surprise takes a defensible path and keeps going
  rather than halting; the escalation still surfaces at the end. Only a genuine dead end stops the run.
- **Reports are written for a decision, not a diff** — capped at 25 lines, in the vocabulary of the
  intent you confirmed, with every finding carrying a plain-language consequence.
- **An escalation alone no longer fails a run.** It is report content, not a verdict. This had made
  success nearly unreachable: 2 of 22 runs, with most "needs attention" results carrying no conflict and
  no failure behind them.
- **Run scoring derives from what happened**, not the label a run was saved with, so history stays
  comparable when the logic changes.
- Plans and requirements write to the plugin data directory, never into your repository.

### Fixed

- A re-verify after a fix inherited the first pass's scope and redid the entire job — which is why
  re-verifies measured *more* expensive than first passes. It is now scoped to what the fix touched.
- Unbounded exploration during verification caused agents to exhaust their context and restart from
  zero; retries alone accounted for 11% of all tokens spent.
- The feature skill treated passing the approved plan inline as optional, so 53 of 54 loop runs spawned
  an agent to re-read files the session already had open.
- Workflow args are robust to string-encoded input.
- Each run's artifacts are scoped to a unique path so parallel runs don't clobber each other.

[0.15.0]: https://github.com/MasterDevs/masterclaude/releases/tag/v0.15.0
