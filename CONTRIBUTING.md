# Contributing

Thanks for looking. This is a small project with strong opinions about evidence — most of what's here
exists because a real run went badly and the data said so.

## Read this first: adapters load differently

**This will bite you.** The plugin has two halves, and they can silently disagree:

| | When it loads | Consequence |
|---|---|---|
| `workflows/feature-loop.js` | read from disk at invocation | edits take effect on the **next run** |
| `skills/*/SKILL.md`, `agents/*.md` | loaded into the Claude Code session at start | edits do nothing until a **new session** |
| `plugins/masterdevs-codex/` | copied into the Codex plugin cache at install | edits require a **reinstall and new Codex instance** |

It has already caused a real problem: three shipped versions of skill-side work sat dormant for a day
while the workflow half ran current code. Every run looked healthy. The only tell was `interviewed:
false` in the run data.

**After changing a skill or agent file, start a new session before testing**, and confirm the new text
loaded by checking that a command you added is present.

## Setup

```bash
git clone https://github.com/MasterDevs/masterclaude
cd masterclaude
node --version          # 18+
```

No dependencies to install — everything is stdlib Node.

Install your working copy as a local marketplace to test it:

```
/plugin marketplace add /path/to/masterclaude
/plugin install masterdevs@masterclaude
```

For Codex, use the shell commands below and then start a new instance. The complete walkthrough is in [`docs/CODEX.md`](./docs/CODEX.md).

```bash
codex plugin marketplace add /absolute/path/to/masterclaude
codex plugin add masterdevs-codex@masterclaude-codex
```

## Tests

Four suites are local and model-free. **Run all four before opening a PR.**

```bash
node scripts/loop-scenarios.mjs      # control flow; -v prints agent sequences
node scripts/mutation-check.mjs      # proves the scenarios actually catch things
node scripts/codex-state-scenarios.mjs # Codex state and shared-asset parity
node scripts/gold-checks.mjs         # the gold lane: scope precedence, validation, staleness, seed merge, scrub patterns
```

`loop-scenarios.mjs` runs the **real** `feature-loop.js` against a stubbed agent layer, so every branch
executes in milliseconds with no models and no repo. It catches the class of bug that is otherwise
invisible until a two-hour run ends in the wrong state.

`mutation-check.mjs` deliberately breaks a source file one way at a time and asserts the matching
suite goes red. This exists because a green suite can be worthless: an earlier version passed 12/12
while missing the round cap — the single most important behavior it claimed to protect. Its targets
are not only code: the shipped roster JSON and the skill files that read them are mutated too,
because the Codex adapter once shipped Claude's roster values verbatim and nothing was watching the
data. A mutation is normally a `[name, find, replace]` triple, and it replaces **every** occurrence: a skill
file states the same command in a table and again in the step that runs it, so breaking one of them
leaves the assertion matching the survivor and the mutation reports MISSED while the behavior is still
documented. Use `[name, {add, contents}]` or `[name, {addDir}]` when the invariant is about a file or
directory that must *not* exist, which find-and-replace cannot express. The harness refuses to run if a suite is already red on an
unmutated tree — every mutation would otherwise report `caught` for the wrong reason and the score
would mean nothing. A stray untracked directory is the usual cause, and git reports one as neither
a change nor something `git clean -f` removes.

`codex-state-scenarios.mjs` exercises the provider-owned Codex run store in a temporary git
repository, keeps the protocols and Playbook assets copied into both distributable plugins
byte-identical, and holds the Codex rosters to the Codex runtime — they name host-specific agents,
so they are the one thing that must *not* match Claude's.

`gold-checks.mjs` covers the gold lane end to end: which scope wins when an id is defined twice,
what a malformed entry is rejected for, when an entry goes stale, how seeds merge into an existing
Playbook without overwriting a user's edited copy, and what the scrub patterns catch before an entry
leaves the machine.

### If you add behavior, add both

A scenario **and** a mutation that breaks it. The mutation is the only check on whether your scenario
does anything. Two rules learned the hard way:

- **Assert the mechanism, not a side effect.** A scenario once checked that Polish was skipped on a plan
  conflict — but Polish is separately guarded, so deleting the conflict break changed nothing observable.
- **Make every other signal say "keep going."** A cap is only tested when it is the *only* thing that
  can stop the loop.

## Changing prompts

Prompts are the product here, so a few conventions:

- **One place per rule.** Durable role standards live in the agent definition (`agents/*.md`); the task
  lives in the workflow prompt. If a prompt stops repeating something, check the agent file actually
  says it — and add a scenario asserting both halves.
- **Structure beats exhortation.** Where behavior needed to change, a required schema field has worked
  and telling the agent to try harder has not. The `soWhat` field and the plan's `claims` are both
  examples: forcing the answer is what makes the thinking happen.
- **Keep examples domain-neutral.** Use generic domains (orders, invoices, accounts) so the point lands
  for any reader.

## Evidence, please

If you're changing loop behavior, say what data suggests it. `node scripts/run-report.mjs` reads
workflow state Claude Code already writes, works retroactively, and costs nothing. Most changes here
started as a number that looked wrong.

## Commit and PR style

Lead with the plain-English effect; demote the mechanism to a trailing clause. A teammate one month into
the codebase should follow it without opening the diff.

> ❌ Health-snapshot unique grain uses `nulls_distinct=False` so NULL rollups dedupe.
>
> ✅ Stop duplicate health snapshots. Postgres treats two NULLs as different, so duplicate whole-deal
> snapshots slipped past the uniqueness rule. `nulls_distinct=False` makes those count as duplicates.

## Versions and releases — you don't touch either

**Do not bump a version, edit `CHANGELOG.md`, or create a tag.** All of that is automated, and a manual
edit will conflict with it.

The only thing you need to get right is the **PR title**, because it is squashed into the commit and the
release automation reads it:

```
feat: stop the loop when two criteria contradict
fix: re-verify no longer redoes the first pass
docs: explain the split-brain loading gotcha
```

| Prefix | Effect on the next release |
|---|---|
| `feat:` | minor bump — a new capability |
| `fix:` | patch bump — a defect repaired |
| `perf:` `refactor:` | patch bump |
| `docs:` `test:` `ci:` `chore:` | no release on its own |

A check on your PR tells you immediately if the title doesn't parse, with an example. That's the whole
convention.

**What happens after merge:** a bot opens a `chore: release X.Y.Z` pull request that bumps both version
files, writes the changelog entry from the merged commits, and waits. Merging *that* PR tags the release
and publishes it. Nothing ships until a maintainer merges it, so releases stay deliberate while the
bookkeeping is not.

### Maintainers

Merge the release PR when you want to ship. That's it — the tag, the GitHub release, and the version
bumps all follow from it.

Users on a third-party marketplace do **not** auto-update; they pick up the new version from the
`/plugin` menu. That's why `marketplace.json` has to carry the same version as `plugin.json` — CI fails
the build if they ever disagree.

## Reporting problems

Open an issue with what you ran, what happened, and — if a feature run was involved — the output of
`node scripts/run-report.mjs`. Security issues: see [SECURITY.md](./SECURITY.md).
