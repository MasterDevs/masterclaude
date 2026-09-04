# masterclaude

**Build a feature while you do something else.**

A [Claude Code](https://claude.com/claude-code) plugin that takes a one-line brief, interviews you until the requirements are actually settled, shows you a plan to approve — and then goes dark and builds it. Implement, refactor, verify, review, iterate, polish. You come back to a decision, not a changelog.

```
/plugin marketplace add MasterDevs/masterclaude
/plugin install masterdevs@masterclaude

/masterdevs:feature add rate limiting to the public API
```

---

## The idea

Most AI coding tools optimize for tokens. This one optimizes for **your interruptions**, because the scarce resource is your attention, not the model's.

The bet: **spend your attention up front, buy back an hour of parallel time.** A question asked at minute 40 costs you a context switch. A wrong assumption costs the whole run. So everything answerable gets answered *before* the handoff — and once the run goes dark, agents have channels to record what they notice without stopping to ask.

That claim is falsifiable, so the repo ships the instruments to check it. Measured across 20 real features:

| | Before | After |
|---|---|---|
| **Unplanned stops per feature** | 2.3 | **1.0** |
| Features finishing with nothing outstanding | 0 / 3 | **4 / 12** |
| Questions asked during the interview | 0.3 | 0.8 |

Attention moved from *after* the handoff to *before* it. See [`evals/BASELINE.md`](./evals/BASELINE.md) for the full measurement and how to reproduce it.

## What a run looks like

```
brief
  → Interview     ── you're here ────────────────────────────
  → Preflight        one question at a time, each with a guess
  → Refine           attached. Restate. Explicit yes.
  → Plan             Then: is this checkout fit to work in, and
  → Fact-check       does the plan's story about the code hold?
  → [ you approve ]
  ──────────────────────────────── run goes dark ────────────
  → Implement     build the plan in one pass, tests alongside
  → Refactor      clean up what the implementation introduced
  → Verify ∥ Review   concurrently — both read-only
  → Iterate       another round ONLY for critical/high findings
  → Polish        batched minor fixes, applied once
```

Each phase runs in a **fresh context** seeded only by the previous phase's terse artifact, so no agent inherits another's token bloat.

## Commands

| Command | What it does |
|---|---|
| `/masterdevs:feature <brief>` | The whole loop. Interviews, plans, stops for approval, then builds unattended. |
| `/masterdevs:refine <idea>` | Just the interview — turns a fuzzy idea into settled intent. Builds nothing. |
| `/masterdevs:plan <ask>` | Just the design — a plan to argue with. Builds nothing. |
| `/masterdevs:review` | Just the review panel over your current diff. No plan or loop needed. |
| `/masterdevs:playbook` | Curate what the agents have learned — promote, reject, or prune. |
| `/masterdevs:roster` | Register a specialist reviewer into the review panel. |
| `/masterdevs:gold` | Capture a curated example of good code, an abstraction, or a design into the Playbook's gold lane — the only way entries get there. |
| `/masterdevs:contribute` | Submit a gold entry, pattern, or lesson upstream as a pull request, or promote a local entry to your team's repo scope. |

## What makes it different

**It interviews you properly.** Hypothesis and a confidence number, one question at a time with a guess attached, and it stops when it can predict your answers. The restate has a mandatory *"Out of scope"* line — most late surprises are silent disagreement about what wasn't being built.

**It checks its own homework before you approve.** The architect must state the facts its plan rests on ("only three call sites read this") along with the check that settles each one. Those run before the plan reaches you. It has caught a plan naming three call sites where there were five, and an attribute that only exists on IPv6.

**It refuses impossible goals.** If two success criteria contradict, or one names a target correct code can never produce, the run stops and asks. One real feature spent 5.8M tokens chasing an acceptance number that *was* the bug being fixed.

**It reports in your words, not the code's.** Every finding carries a plain-language consequence written by the agent that had the code open:

> ❌ `refresh_stale_invoices`' sweep matches only the schema prefix of the cache key.
>
> ✅ Editing a tax rate makes that invoice recalculate from scratch on every view, permanently — no wrong numbers, just slow. *Recommend: follow-up ticket, don't hold the PR.*

**It learns.** Agents stage patterns and lessons they discover; anything seen twice is promoted automatically into the knowledge every future agent loads. Nothing reaches that lane without recurrence or your explicit confirmation. Alongside it, curated **examples** — code, abstractions, and designs worth copying — are captured by hand rather than learned, so the two mechanisms stay distinct: one earns its place by recurring, the other because you picked it.

## Requirements

- Claude Code with plugin support
- Node.js 18+ (for the bundled scripts)
- A git repository — the loop runs in your current worktree

## Documentation

- **[Plugin reference](./plugins/masterdevs/README.md)** — the loop in depth, model routing, the playbook, extending the review panel
- **[Evals](./evals/README.md)** — how the design is measured and how to reproduce it
- **[Contributing](./CONTRIBUTING.md)** — development setup, tests, and the one gotcha that will bite you
- **[Changelog](./CHANGELOG.md)** — release history

## Status

Pre-1.0 and evolving. It's used daily on real work, but interfaces still move between minor versions — schemas gain required fields, result fields change meaning. Pin a version if that matters to you.

## License

MIT — see [LICENSE](./LICENSE).
