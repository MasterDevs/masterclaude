# firm — orchestrated feature development for Claude Code

`firm` runs a feature from a one-line brief to reviewed, integrated code through a team of specialized agents, over a design-pattern knowledge base that learns as you use it.

## The pipeline

```
brief
  → Scout        read-only map of the affected subsystems
  → Architect    decompose into subtasks; choose patterns; route each to a model
     └ Principal  (only when the brief spans domains) designs cross-domain seams, fans out specialists
  → [ you approve the plan ]
  → Engineers    one per subtask, model-routed, in isolated worktrees
  → Review Panel triggered, parallel: correctness + security + performance + frontend (extensible)
  → fix loop     findings route back to the same engineer, max 2 rounds
  → Integrate    merge in dependency order, run the suite, verify the combined result
```

Priority hierarchy governing all generated code: **security > reliability/correctness > velocity**.

## Commands

| Command | What it does |
|---|---|
| `/firm:feature <brief>` | Run the full pipeline. Stops for your approval between plan and build (except small-tier). |
| `/firm:playbook` | Review, promote, or prune staged pattern/lesson candidates — the only gate into promoted knowledge. |
| `/firm:roster` | Register a specialist reviewer (any installed plugin's agent) into the Review Panel. |

## Model routing

| Tier | Model | Why |
|---|---|---|
| small / straightforward | `sonnet` | mechanical work |
| complex | `opus` | multi-file reasoning |
| must-not-break / sensitive | `fable` | auth, crypto, payments, PII, access control, trust boundaries |
| standalone text/docs only | `haiku` | never split comments from the code they explain |

Classification **fails upward**: uncertain tier → the higher model. Sensitivity tripwires are non-negotiable.

## The Playbook (self-learning)

Agents share a knowledge base — per-domain **pattern catalogs** (detection recipes: a smell to match, an overfit guard to honor), per-lens **reviewer lessons**, and a **refactor backlog**. It learns in two lanes:

- **Shipped seeds** live read-only in the plugin and are versioned. On update they **merge** into your data, never clobber.
- **Learned state** lives in `~/.claude/plugins/data/firm/` and survives updates.

New patterns and lessons are **staged as candidates** with provenance. They only become promoted (loaded by agents) via recurrence ≥2 **or** your confirmation through `/firm:playbook`. Ungated promotion is treated as a security-relevant action — a bad lesson would inject into every future agent.

## Extending the Review Panel

`/firm:roster` registers a reviewer with a lens, triggers (`always` / `lenses` / `globs` / `sensitiveTier`), a model, and a lessons lane. Its findings flow back into the lessons engineers preload, so the team gets better at avoiding what your reviewers catch.

## Notes
- Workflow scripts (`workflows/*.js`) ship as plain files and are invoked by path from the `feature` skill.
- Reviewer memory from the `eng-skills` plugin, if installed, is read defensively as a rejection catalog — never written to.
