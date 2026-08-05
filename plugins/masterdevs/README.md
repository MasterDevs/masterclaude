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
| `/masterdevs:feature <brief>` | Run the loop. Stops for your approval between plan and build. |
| `/masterdevs:playbook` | Review, promote, or prune staged pattern/lesson candidates — the only gate into promoted knowledge. |
| `/masterdevs:roster` | Register a specialist reviewer (any installed plugin's agent) into the Review Panel. |

## Model routing

Routed per phase by what the phase actually demands:

| Phase | Model | Why |
|---|---|---|
| Plan, Implement, Review | `opus` | design decisions, multi-file reasoning, adversarial judgment |
| Refine, Refactor, Verify, Iterate, Polish | `sonnet` | bounded, mechanical, or already-specified work |

When a step crosses a sensitivity tripwire — auth, crypto/secrets, payments, PII, access control, trust boundaries — the Architect flags it in the plan so the engineer and reviewer both treat it as must-not-break.

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
