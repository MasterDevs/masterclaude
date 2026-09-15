# Using MasterDevs with Codex

The Codex adapter preserves the product loop—settle intent, fact-check a plan, approve it, implement, verify, review, and report—but uses Codex-native skills and subagents instead of the Claude workflow runtime.

## Install this working tree

Use a second terminal so the Codex process starts after the plugin is installed. From any shell:

```bash
codex plugin marketplace add /absolute/path/to/masterclaude
codex plugin add masterdevs@masterclaude-codex
codex plugin list
```

The last command should show `masterdevs@masterclaude-codex` as installed and enabled. Then launch a new Codex instance in a disposable or real feature branch:

```bash
codex -C /absolute/path/to/the/repository-you-want-to-change
```

The target must be a git repository. A clean feature branch gives the smoothest run; preflight reports a dirty tree, the default branch, or repository-specific warnings and asks before continuing.

## Try the small entry points first

Invoke skills explicitly so it is clear which adapter is under test:

```text
$masterdevs-refine add rate limiting to the public API
$masterdevs-plan add rate limiting to the public API
$masterdevs-review review the current diff
```

These respectively interview without editing, create a repository-grounded plan without editing, and review the current diff without fixing it.

To capture one example worth copying into the Playbook's gold lane — and choose whether it stays on this machine, is committed beside your code, or is offered upstream as a pull request:

```text
$masterdevs-gold
```

Six questions, each with a recommended answer you accept with `y`. It is the only writer of that lane: every agent reads entries and cites their ids, and no loop step ever stages one.

For the full run:

```text
$masterdevs-feature add rate limiting to the public API
```

MasterDevs interviews as needed, runs preflight, plans and fact-checks, then stops at the approval gate. Approve or correct the plan. To resume explicitly in the same or a new Codex session rooted at that repository, use:

```text
$masterdevs-feature continue with the approved plan
```

After approval, mutating phases run serially. Independent verification and review work may run concurrently. The loop is capped at two implementation rounds, with at most two verification-fix attempts.

## Inspect run state

MasterDevs records only state it owns; it does not depend on Codex session internals. By default the state is in a stable, repository-keyed directory under the operating system's temporary directory.

To see the latest run while developing from this checkout:

```bash
node /absolute/path/to/masterclaude/plugins/masterdevs-codex/scripts/codex-state.mjs status
```

For durable or easy-to-inspect state, choose an absolute writable directory and make it available to Codex:

```bash
MASTERDEVS_DATA_DIR=/absolute/path/to/masterdevs-state \
  codex --add-dir /absolute/path/to/masterdevs-state \
  -C /absolute/path/to/the/repository-you-want-to-change
```

The Playbook and run artifacts then live below that directory. Do not point `MASTERDEVS_DATA_DIR` at the target repository unless you intentionally want untracked state there.

The directory is created private to you. An existing one is left exactly as you set it, and a warning is printed if it is reachable by anyone else — the Playbook kept there is read back to agents as instructions. Without the variable, state goes to a per-user directory under the system temp directory and is held at owner-only.

## Reload after changing this branch

Codex installs a snapshot into its plugin cache. A running instance does not automatically pick up skill or manifest changes. Close the test instance, then refresh the local installation:

```bash
codex plugin remove masterdevs@masterclaude-codex
codex plugin marketplace remove masterclaude-codex
codex plugin marketplace add /absolute/path/to/masterclaude
codex plugin add masterdevs@masterclaude-codex
```

Start a new Codex instance after reinstalling.

## What is Codex-specific

- `plugins/masterdevs-codex/skills/` contains the user-facing skills and explicit-only Architect, Engineer, and Reviewer roles.
- Native Codex subagents replace Claude's `agentType` workflow calls. Mutators stay serial; independent read-only agents may run in parallel.
- `codex-state.mjs` provides resumable provider-owned state and a stable Playbook location without reading host-session data.
- The Claude plugin remains under `plugins/masterdevs/`; its commands and workflow runtime are unchanged.

- `gold.mjs` is shared byte-identical with the Claude adapter, the same way `playbook.mjs` is: the skills always pass explicit paths, so it needs no per-host copy. What differs is how the lane is seeded — Claude's skill prose runs `--merge-seeds` during bootstrap, while `codex-state.mjs` calls it in code, before the seed release is stamped, so a failed merge retries instead of recording itself as done.

The interview, reporting, preflight, shared scripts, and shipped Playbook assets are duplicated into the distributable Codex plugin because plugin caches are self-contained. `node scripts/codex-state-scenarios.mjs` fails if those shared copies drift, in either direction, and if a portable script or reference exists in one adapter and not the other.

## Local verification

From the MasterDevs checkout:

```bash
node scripts/codex-state-scenarios.mjs
node scripts/loop-scenarios.mjs
node scripts/mutation-check.mjs
```

The first suite covers the Codex state adapter and cross-adapter asset parity. The latter two protect the existing Claude workflow.
