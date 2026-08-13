# masterdevs — orchestrated feature development for Claude Code

`masterdevs` runs a feature from a one-line brief to reviewed, integrated code through a team of specialized agents, over a design-pattern knowledge base that learns as you use it.

## The loop

One RPI-style loop in a single worktree. Each phase runs in a **fresh context** seeded only by the previous phase's terse artifact, so no agent inherits another's token bloat.

```
brief
  → Interview    ── YOU ARE HERE ──────────────────────────────────
  → Refine          a real conversation: hypothesis + confidence, one
  → Plan            question at a time, restate with an explicit
  → [ approve ]     "Out of scope" line, explicit yes. Then the plan.
  ─────────────────────────────────────────── run goes dark ───────
  → Implement    build the plan in one pass, tests alongside
  → Refactor     clean up what the implementation introduced
  → Verify ∥ Review    run concurrently — both read-only
       Verify    exercise the success criteria; failures route back to a fix agent
       Review    one combined reviewer (+ your roster) over the new code only
  → Iterate      another round ONLY for critical/high findings or a failed verify
  → Polish       the batched medium/low revisions, applied once and regression-checked
```

**The design optimizes for interruptions, not tokens.** The product is your parallel time: you spend attention up front, then the run goes dark and you go do something else. A question asked at minute 40 costs a context switch; a wrong assumption costs the whole run. So everything answerable is answered before the handoff — that's what the interview is for, and why the plan gate sits in the same sitting.

Once dark, agents have two channels for anything they notice and neither one interrupts you:

- **`punted`** — small, out of scope, better later. Recorded and reported at the end. This is the default, and it's the backlog each run generates.
- **`escalations`** — the code contradicted the plan. If there's a defensible path forward the agent takes it and keeps going; the escalation still surfaces at the end. Only a genuine dead end stops the run.

Scope questions are neither — those were settled before the run started.

**The loop is capped at 2 rounds, and nits can't buy one.** Earlier versions ran three rounds and re-reviewed after every revision; in practice the findings list churned rather than converged — a fresh crop each round, at 50–67% of the run's cost. Medium/low findings now collect into the single closing Polish pass. They are regression-checked but deliberately **not** re-reviewed; the report says so explicitly.

The loop stops early and hands back to you only when something genuinely needs you: a dead-end escalation, or a revision that conflicts with the approved requirements.

Priority hierarchy governing all generated code: **security > reliability/correctness > velocity**.

## Commands

| Command | What it does |
|---|---|
| `/masterdevs:feature <brief>` | The whole loop. Interviews you, plans, stops for approval, then builds unattended. |
| `/masterdevs:refine <idea>` | Just the interview — turns a fuzzy idea into a settled intent. Builds nothing. |
| `/masterdevs:plan <ask>` | Just the design — an implementation plan to argue with. Builds nothing. |
| `/masterdevs:review` | Just the review panel, over your current diff. Doesn't need a plan or a loop. |
| `/masterdevs:playbook` | Review, promote, or prune staged pattern/lesson candidates — the only gate into promoted knowledge. |
| `/masterdevs:roster` | Register a specialist reviewer (any installed plugin's agent) into the Review Panel. |

The middle three are the loop's phases as standalone entry points. `/masterdevs:feature` is the front
door and the one to reach for by default; the others exist for when you want one phase without the rest —
a review on hand-written code, or the thinking done today and the building later. They share the same
protocols (`references/interview.md`, `references/reporting.md`), so the interview you get from
`/masterdevs:refine` is the one the full loop runs.

## Model routing

Routed per phase by what the phase actually demands:

| Phase | Model | Why |
|---|---|---|
| Plan, Implement, Review | `opus` | design decisions, multi-file reasoning, adversarial judgment |
| Refine, Refactor, Verify, Iterate, Polish | `sonnet` | bounded, mechanical, or already-specified work |

When a step crosses a sensitivity tripwire — auth, crypto/secrets, payments, PII, access control, trust boundaries — the Architect flags it in the plan so the engineer and reviewer both treat it as must-not-break.

## The report you get back

You were away for an hour. You come back to a decision, not a changelog.

Every finding, escalation, and deferral carries a **`soWhat`** — one plain sentence written by the agent
that had the code open, saying what it means and what happens if nobody acts. That translation has to
happen where the code context is; the report step can only paraphrase what it's handed.

> ❌ `recompute_los_bucket_variants`' sweep matches only the registry prefix of the envelope stamp.
>
> ✅ Editing a severance rate makes that deal recalculate from scratch on every view, permanently — no
> wrong numbers, just slow. *Recommend: follow-up ticket, don't hold the PR.*

The report is written in the vocabulary of the intent **you** confirmed in the interview, capped at 25
lines, and structured as: the bottom line → what needs you (each with a recommendation and a default if
you say nothing) → one line each for the record. If nothing needs you, it says so in a line — that's the
win condition.

## Developing this plugin — read this first

**The two halves load differently, and they can silently disagree.**

| | When it loads | Consequence |
|---|---|---|
| `workflows/feature-loop.js` | read from disk at invocation | edits take effect on the **next run** |
| `skills/*/SKILL.md`, `agents/*.md` | loaded into the Claude Code session at start | edits do nothing until a **new session** |

This has already bitten once: three shipped versions of skill-side work — the interview, the report
redesign, the phase commands — sat dormant for a day while the workflow half ran current code. Every run
looked healthy. The only tell was `interviewed: false` in the run data.

**After changing a skill or agent file, start a new session before testing.** Confirm the new text
actually loaded by checking that a command you added is present. `scripts/run-report.mjs` also reports
whether runs were interviewed, which is the cheapest way to catch this from the outside.

## Is it working?

The design makes a falsifiable claim — front-loading your attention buys uninterrupted time without
costing quality — so it ships with the instruments to check it:

```bash
node scripts/run-report.mjs        # unplanned stops per feature, from real runs
node scripts/loop-scenarios.mjs    # control-flow regression test, free and instant
```

`run-report.mjs` reads workflow state Claude Code already writes, so every feature you run is a free
data point and it works retroactively. The number to watch is **unplanned stops per feature** — times
the loop failed to stay dark. Questions asked *during* the interview are counted separately, because
those are the design working, not failing.

Measured over 12 features on v0.6–0.8 against the pre-interview baseline: **2.3 → 1.0 unplanned stops
per feature**, features landing clean **0/3 → 4/12**, while interview questions rose 0.3 → 0.8 per
feature. Attention moved from after the handoff to before it. See
[`evals/BASELINE.md`](../../evals/BASELINE.md).

## The Playbook (self-learning)

Agents share a knowledge base — per-domain **pattern catalogs** (detection recipes: a smell to match, an overfit guard to honor), per-lens **reviewer lessons**, and a **refactor backlog**. It learns in two lanes:

- **Shipped seeds** live read-only in the plugin and are versioned. On update they **merge** into your data, never clobber.
- **Learned state** lives in `~/.claude/plugins/data/masterdevs/` and survives updates.

New patterns and lessons are **staged as candidates** with provenance. They only become promoted (loaded by agents) via recurrence ≥2 **or** your confirmation through `/masterdevs:playbook`. Ungated promotion is treated as a security-relevant action — a bad lesson would inject into every future agent.

## Extending the Review Panel

`/masterdevs:roster` registers a reviewer with a lens, triggers (`always` / `lenses` / `globs` / `sensitiveTier`), a model, and a lessons lane. Its findings flow back into the lessons engineers preload, so the team gets better at avoiding what your reviewers catch.

## Notes
- Workflow scripts (`workflows/*.js`) ship as plain files and are invoked by path from the `feature` skill.
- Reviewer memory from the `eng-skills` plugin, if installed, is read defensively as a rejection catalog — never written to.
