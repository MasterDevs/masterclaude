# Evals — is masterdevs actually working?

The design makes a falsifiable claim: **front-loading your attention buys uninterrupted time without
costing quality.** These are the three ways to check it, cheapest first.

| Tier | What it catches | Cost | Automated |
|---|---|---|---|
| 1 — Control flow | The loop branching wrong | free, seconds | ✅ `scripts/loop-scenarios.mjs` |
| 2 — Real-run metrics | Interruptions creeping back up | free | ✅ `scripts/run-report.mjs` |
| 3 — Fixture A/B | Whether a change hurt output quality | ~$40–80 + 1–2 h per run | ❌ manual |

## Tier 1 — control flow

```bash
node scripts/loop-scenarios.mjs      # -v to print agent sequences
```

Runs the real `feature-loop.js` against a stubbed agent layer. Every branch executes in milliseconds
with no models and no repo. It catches the class of bug that is otherwise invisible until a two-hour run
ends in the wrong state: a loop that won't terminate, an escalation that halts when it shouldn't, a
result field that quietly stops being populated, a mutating agent scheduled against a concurrent reader.

**Run it after any change to the workflow script.** It cannot judge agent output — no model runs.

### How much does it actually catch?

Measured by mutation testing — deliberately breaking the loop and checking the suite goes red.
**15 of 15 mutations caught**, including every one that would restore a bug this design exists to fix:

| Mutation | |
|---|---|
| Round cap 2 → 5 (re-introduce the churn) | caught |
| Merge `mustFix` and `polish` (nits buy rounds again) | caught |
| Stop obeying the conflict break | caught |
| Let the Iterate agent prolong the loop | caught |
| Move the verify-fix inside the parallel block (concurrency hazard) | caught |
| Make an escalation halt the run | caught |
| Ship post-verify fixes unreviewed | caught |
| Ignore the confirmed intent in Refine | caught |
| Drop the `soWhat` rule from the reviewer prompt | caught |
| Remove `soWhat` from the schemas | caught |
| Always claim verify passed | caught |
| …plus caps, exits, and channel collection | caught |

Re-measure it yourself — the checker is committed:

```bash
node scripts/mutation-check.mjs      # breaks the loop 15 ways, asserts the suite goes red
```

Add a mutation there whenever you add a behavior worth protecting; it is the only check on whether the
scenario you wrote alongside it does anything.

This number is worth re-measuring when scenarios are added. An earlier version of this suite passed
12/12 while silently missing three mutations — including the round cap, the single most important
behavior it claimed to protect. Scenarios that assert on a *downstream symptom* rather than the
mechanism give false confidence; a green suite you can't trust is worse than no suite.

Two design rules came out of that:

- **Assert the mechanism, not a side effect.** The old conflict scenario checked that Polish was
  skipped — but Polish is separately guarded, so deleting the conflict break changed nothing observable.
- **Make every other signal say "keep going."** A cap is only tested when it is the *only* thing that
  can stop the loop.

### Schema conformance

Every stub return is validated against the real schema the workflow declares for that call, so stub
drift and schema breakage both fail loudly. A separate scenario asserts the *contract* itself — that
`soWhat` stays required, that `mustFix` and `polish` stay separate — because validation alone cannot
notice a schema being loosened; the stub would still supply the dropped field.

## Tier 2 — real-run metrics

```bash
node scripts/run-report.mjs                    # everything, grouped by feature
node scripts/run-report.mjs --since 2026-08-06 # since a version shipped
node scripts/run-report.mjs --json             # machine-readable
```

### Persisting results

The terminal report reads Claude Code's local project state — which is periodically **swept**, and only
exists on one machine. The oldest surviving run on 2026-08-05 was about a month old. So the history this
design is judged by has to be committed, or it quietly evaporates:

```bash
# after shipping a version, snapshot the window it covers
node scripts/run-report.mjs --since 2026-08-06 --snapshot --label v0.6.0

# then, any time
node scripts/run-report.mjs --history
```

Snapshots land in `evals/results/<date>-v<version>-<label>.json` and are committed.

**Feature names are redacted by default.** A feature name is a branch name, so snapshots store a stable
hash (`f-37b43fe2`) instead — the same feature keeps the same id across snapshots, so trends stay
traceable without the repo naming anyone's work. `--full` keeps real names for local inspection; don't
commit that output.

Two things worth knowing about the file format:

- `versionAtSnapshot` is the plugin version installed **when the snapshot was taken**, not the version
  the runs used. Use `--label` to record what the runs actually were.
- A snapshot without `--since` is cumulative all-time, so two of those aren't directly comparable.
  Pass `--since` to scope a snapshot to one version's runs.

**This is the primary instrument.** Every feature you run is a free data point, and it works
retroactively because it reads workflow state Claude Code already writes. No fixtures, no extra spend.

The number that matters is **unplanned stops per feature**. A clean feature is one designed stop (the
interview plus plan gate, in one sitting) and zero unplanned ones. See [BASELINE.md](./BASELINE.md) for
the pre-interview measurement: **2.3 unplanned stops per feature, 0 of 3 features landing clean.**

Secondary: share of features ending `passed`, and `conflicts` — conflicts are scope disagreements
surfacing after the run went dark, which is exactly what the interview is meant to prevent. Conflicts
staying high after a real interview means the interview isn't asking the right questions.

Tokens and wall clock are deliberately *not* the target. The design trades them for uninterrupted time.

## Tier 3 — fixture A/B

Not automated — and worth being honest about why. Grading a feature loop means running it against a real
codebase for an hour or two at real cost, so this is a deliberate experiment you run when a change might
plausibly hurt output quality, not something in CI.

Run the same brief against the same repo at the same starting commit, before and after a change, then
compare using the rubric below. A case lives in `evals/cases/<name>.json` — see
[`cases/_template.json`](./cases/_template.json).

### Procedure

1. Pick a target repo and note the exact starting commit.
2. From a clean worktree at that commit, run `/masterdevs:feature` with the case's `brief`.
3. Answer interview questions **from the case's `interviewAnswers`**, verbatim — otherwise you're
   testing your own mood, not the change.
4. When it finishes, score against `expectations` and record `scripts/run-report.mjs` output.
5. Reset the worktree, switch plugin version, repeat.

### Rubric

Score each, and record the loop's own reported fields as evidence:

| Dimension | Question | Evidence |
|---|---|---|
| Interruptions | How many times did it need you? | `run-report.mjs` |
| Landed clean | Did it end `passed`? | `outcome` |
| Verification | Did the success criteria actually pass? | `verifyPassed` |
| Correctness | Does the diff do what the brief asked? | read it |
| Escalations | Were they real surprises, or scope questions leaking through? | `escalations` |
| Punts | Reasonable to defer, or was something important dropped? | `punted` |
| Missed defects | Anything a reviewer should have caught? | read the diff |

The last two are the ones to watch. Under the current design, medium/low findings ship
regression-checked but **not** re-reviewed, and punted items are never re-examined. If quality degrades,
that's where it will show first.
