# Baseline — before the interview restructure

Measured **2026-08-05** over the last real runs made with the pre-interview design (plugin `0.4.1`,
commit `ccd4b8b`). This is the number the current design is trying to move, and it's the only "before"
we get — the source data is Claude Code's local project state, which gets swept.

Machine-readable snapshot: [`results/2026-08-05-v0.6.0-pre-interview-v0.4.1.json`](./results/2026-08-05-v0.6.0-pre-interview-v0.4.1.json).
Feature names are redacted to stable ids (`f-…`) so the same feature stays traceable across snapshots
without naming a branch. Regenerate with:

```bash
node scripts/run-report.mjs --since 2026-08-01 --snapshot --label pre-interview-v0.4.1
```

## ⚠️ Rescored 2026-08-13 — do not compare the raw numbers below to current output

The tables on this page use the **original** scoring, which counted two things as failures that aren't:

- **Questions asked during the interview**, before the run ever went dark. Those are the design working.
- **Escalations** — things an agent hit, resolved defensibly, and kept going past. Any escalation forced
  `needs-attention`, so `passed` was nearly unreachable: 2 of 22 runs.

`run-report.mjs` now derives each run's disposition from what happened rather than from its label, so
old runs rescore too. Both sides measured the same way:

| | Baseline (3 features, Aug 1–6) | v0.6–0.8 (12 features) |
|---|---|---|
| **Unplanned stops per feature** | 2.3 | **1.0** |
| Interview questions per feature | 0.3 | 0.8 |
| Features landing clean | 0/3 | **4/12** |

Rescoring left this particular window unchanged at 2.3 — those three features failed on conflicts and
dead ends, which still count. Against the wider set of **every run before 2026-08-06** (9 features,
spanning older designs) the baseline is **1.8 unplanned per feature, 1/9 clean**. Both comparisons
point the same way: attention moved from after the handoff to before it, which is the trade the design
is built on.

Snapshots: [`2026-08-13-…-pre-interview-v0.4.1-rescored.json`](./results/2026-08-13-v0.8.0-pre-interview-v0.4.1-rescored.json)
and [`2026-08-13-…-v0.6-0.8-interviewed.json`](./results/2026-08-13-v0.8.0-v0.6-0.8-interviewed.json).
The original 2026-08-05 snapshot is kept as the historical record and is marked `⚠ old scoring` in
`--history`. Re-take an old window with `--since X --until Y`.

The raw figures below are what was measured on 2026-08-05, under the original scoring.

## Headline (original scoring — superseded)

| Metric | Value |
|---|---|
| Features | 3 |
| Workflow invocations | 11 |
| **Unplanned stops** | **7 (2.3 per feature)** |
| Wall clock | 10.3 h |
| Tokens | 8.26 M |
| Features that ended `passed` | **0** |

A stop is "designed" when it's the plan gate — the one interruption the design intends. Everything else
is the loop failing to stay dark.

## Per feature

**`f-37b43fe2`** — 8 invocations, 2 designed, **6 unplanned**, 6.1 h, 5.29 M tokens

| Outcome | Wall | Tokens | Notes |
|---|---|---|---|
| `needs-clarification` | 10m | 151 K | ten minutes and 151 K tokens to ask a question |
| `awaiting-plan-approval` | 16m | 277 K | designed |
| `blocked` | 19m | 274 K | plan-reality mismatch |
| `blocked` | 15m | 245 K | plan-reality mismatch |
| `needs-attention` | 144m | 2.03 M | 3 rounds, 5 conflicts |
| `killed` | 0m | 50 K | |
| `awaiting-plan-approval` | 17m | 289 K | designed — replanned from scratch |
| `needs-attention` | 144m | 1.97 M | 3 rounds, 8 conflicts |

**`f-b270e160`** — 2 invocations, 1 designed, **1 unplanned**, 3.8 h, 2.66 M tokens

| Outcome | Wall | Tokens | Notes |
|---|---|---|---|
| `awaiting-plan-approval` | 17m | 256 K | designed |
| `needs-attention` | 211m | 2.40 M | 3 rounds, 1 conflict |

**`f-bafadb6b`** — 1 invocation, 1 designed, 0 unplanned, 0.4 h

Planned but not yet run through the loop at snapshot time, so it says nothing about loop behavior.
Included for completeness.

## Wider context

All-time across every recorded run (9 features, back to early July, spanning older versions):

**38 invocations · 24 unplanned stops (2.7 per feature) · 36.7 h · 28.4 M tokens · exactly 1 run ever
ended `passed`.**

The August window above is the fair comparison — those runs used the most recent pre-interview code.
The all-time figure is worse and includes older designs, but points the same direction.

## What the numbers say

1. **Nothing landed clean.** Every completed feature in the window ended `needs-attention`.
2. **Conflicts arrived late and often** — 5, 8, and 1. These are scope disagreements surfacing *after*
   hours of unattended work. They're the single best argument for the interview: a scope question caught
   in conversation costs a minute; caught at hour two it costs the run.
3. **Two `blocked` runs**, both plan-reality mismatches, both under the old "STOP and report back"
   instruction. These motivated escalate-and-continue.
4. **Replanning is expensive.** One feature went through the plan gate twice — the second plan cost
   another 17 minutes and 289 K tokens because the first had been invalidated. Another feature (outside
   this window) hit the plan gate four separate times.

## Comparing against this

```bash
node scripts/run-report.mjs --since <date the new version shipped> --snapshot --label v0.6.0
node scripts/run-report.mjs --history
```

The comparison worth making is **unplanned stops per feature** and **share of features ending
`passed`**. Tokens and wall clock are secondary — the design deliberately trades them for uninterrupted
time.

Runs made with an interview are tagged (`args.intent` is present), so interviewed and non-interviewed
features break out without hand-sorting.
