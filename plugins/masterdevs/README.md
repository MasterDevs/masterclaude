# masterdevs — orchestrated feature development for Claude Code

`masterdevs` runs a feature from a one-line brief to reviewed, integrated code through a team of specialized agents, over a design-pattern knowledge base that learns as you use it.

## The loop

One RPI-style loop in a single worktree. Each phase runs in a **fresh context** seeded only by the previous phase's terse artifact, so no agent inherits another's token bloat.

```
brief
  → Interview    ── YOU ARE HERE ──────────────────────────────────
  → Preflight       a real conversation: hypothesis + confidence, one
  → Refine          question at a time, restate with an explicit
  → Plan            "Out of scope" and "Verify on" line, explicit yes.
  → Fact-check      Then: is this checkout fit to work in, and does
  → [ approve ]     the plan's story about the code actually hold?
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

Two checks run in that same window, because both catch things the run can't raise with anyone once it's dark:

- **Preflight** — is this checkout fit to start in? Feature branch, clean tree, not far behind the default branch, plus whatever the repo declares in `.masterdevs/preflight.json` (test-database freshness, migration collisions). It reports and recommends; it never fixes, because rebuilding a test database can break another session mid-run.
- **Fact-check** — the Architect states the facts about the code its plan depends on (`claims`), each with the check that settles it. Those are run before you see the plan. Refuted claims go back for one revision; **unverifiable** ones surface at the gate, which is where "I'm assuming this and can't confirm it here" belongs. Measured on real runs, plans asserted three call sites where there were five, an attribute that only exists on IPv6, and four affected test files where there were roughly five hundred failing tests — all settleable by a grep.
- **Criteria check** — can the success criteria be satisfied *at all*? It runs alongside the Architect, so it's free in wall clock. Two criteria that contradict, or a target correct code can never produce, **stop the run right there** and come back as a question. Verification is the most expensive phase in the system — 22% of an average run — and aimed at an impossible target it compounds: one real feature spent 5.8M tokens across two full loops on an acceptance number that *was* the bug being fixed, so nothing correct could ever match it.

Once dark, agents have two channels for anything they notice and neither one interrupts you:

- **`punted`** — small, out of scope, better later. Recorded and reported at the end. This is the default, and it's the backlog each run generates.
- **`escalations`** — the code contradicted the plan. If there's a defensible path forward the agent takes it and keeps going; the escalation still surfaces at the end. Only a genuine dead end stops the run.

Scope questions are neither — those were settled before the run started.

**The loop is capped at 2 rounds, and nits can't buy one.** Earlier versions ran three rounds and re-reviewed after every revision; in practice the findings list churned rather than converged — a fresh crop each round, at 50–67% of the run's cost. Medium/low findings now collect into the single closing Polish pass. They are regression-checked but deliberately **not** re-reviewed; the report says so explicitly.

The loop stops early and hands back to you only when something genuinely needs you: a dead-end escalation, or a revision that conflicts with the approved requirements.

**Verification remembers.** It is the most expensive phase in the system — 22% of an average run, more than Implement — because every pass used to re-derive how to operate the repo from nothing. Now it keeps two notes: a per-repo one (`verify-repo-notes.md`, next to the run dir) holding the env setup, how to reach the app, and the fastest **proven** way to run tests — full suite with its measured runtime, a scoped subset, one test, which expensive setup (a test database, say) is reusable — stable across every future feature in that repo — and a per-run log of which criteria passed and how. Any agent that finds a faster correct invocation writes it back, so the notes converge on the best known way to run that repo's tests rather than each run rediscovering it. A re-verify after a fix is scoped to what the fix touched rather than redoing the first pass, and exploration is explicitly bounded: unproven-with-a-reason is a valid answer. Unbounded hunting is what made agents do double the usual tool calls, run out of room, and get restarted from zero — retries alone were 11% of all tokens ever spent.

**One full-suite gate per round.** Transcript analysis across three real runs found the full test suite — minutes of wall clock per run — being run dozens of times per round by implement, refactor, fix, and polish agents; suite runs and the loops polling them were 70–90% of *all* tool-execution time, the system's largest wall-clock cost. Now only Verify runs the suite — and never on a tree it has already passed on; every mutating agent runs tests scoped to what it touched. And a suite pass is treated as a fact about a tree state: Verify fingerprints the worktree when the suite goes green (a throwaway-index `git write-tree` — exact, read-only, runner-agnostic), records it in the run log, and returns it as `suiteGreen`. Anything downstream that wants a suite run — the final regression net, a pre-push check — recomputes the fingerprint first and skips the run when nothing has changed.

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
| `/masterdevs:gold` | Capture a curated example of good code, an abstraction, or a design — and send it to the public repo, your team's repo, or just this machine. The only way entries get there. |

The middle three are the loop's phases as standalone entry points. `/masterdevs:feature` is the front
door and the one to reach for by default; the others exist for when you want one phase without the rest —
a review on hand-written code, or the thinking done today and the building later. They share the same
protocols (`references/interview.md`, `references/reporting.md`), so the interview you get from
`/masterdevs:refine` is the one the full loop runs.

## Model routing

Routed per phase by what the phase actually demands:

| Phase | Model | Why |
|---|---|---|
| Plan | `fable` | the one phase that reads the whole repo with the design in view; every later phase inherits its calls |
| Implement, Review | `opus` | multi-file reasoning, adversarial judgment |
| Refine, Refactor, Verify, Iterate, Polish | `sonnet` | bounded, mechanical, or already-specified work |

**When a model runs out of usage credits.** An agent that gets no answer from its model makes the run say so instead of crashing. If the Plan gets no answer on `fable`, it is asked once more on `opus`. If a step the run cannot skip still gets no answer, the run stops and names that step; resume it later and the finished steps are reused. A check that never answered (a review, a verification) is listed in `agentFailures`, and the run cannot report `passed` while any are listed.

When a step crosses a sensitivity tripwire — auth, crypto/secrets, payments, PII, access control, trust boundaries — the Architect flags it in the plan so the engineer and reviewer both treat it as must-not-break.

## The report you get back

You were away for an hour. You come back to a decision, not a changelog.

Every finding, escalation, and deferral carries a **`soWhat`** — one plain sentence written by the agent
that had the code open, saying what it means and what happens if nobody acts. That translation has to
happen where the code context is; the report step can only paraphrase what it's handed.

> ❌ `refresh_stale_invoices`' sweep matches only the schema prefix of the cache key.
>
> ✅ Editing a tax rate makes that invoice recalculate from scratch on every view, permanently — no
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

## While it runs

### The live status pane

When this session starts a run (planning or building), a **MasterDevs** pane opens beside the chat. It does not take the keyboard, and it redraws every five seconds with no model calls.

```
MasterDevs · Implement · step 3 of 7 · running · 6m 12s
ETA ~5:40 PM (5:25 PM–6:10 PM, from 28 past runs)
last progress 4s ago
next: Refactor → Verify ∥ Review → Iterate → another round (only if blocking findings) → Polish (if needed)

ENGINEER · implement:1                          ELAPSED 2m 14s
Step 3 of 7 · Add the shortcut listener
Read oil_pricing.py                                 5:10:27 PM
Edit oil_pricing.py                                 5:10:44 PM
Write test_oil_pricing.py                           5:11:02 PM
Run unit tests — failed                             5:11:20 PM
Edit oil_pricing.py                                 5:11:58 PM
Run unit tests …                                    5:12:03 PM
```

- **Which plan step is being built.** While the build runs, the headline reads `Implement · step 3 of 7`, and the engineer's section names the step. The engineer marks each step as it starts it; a later round counts its fixes the same way (`fix 1 of 2`).
- **One section per live agent.** Parallel Verify and Review agents each get their own section. A retry is a new section.
- **Six lines per agent, newest at the bottom.** A new action enters at the bottom; once six are shown, the oldest leaves at the top. No new action means no new line. Long lines are cut, not wrapped.
- **Lines come from what the agent actually did.** Each line uses the tool, the file name, and the agent's own short description of the call. Every agent is asked to describe each shell command in plain words, 10 or fewer. When one does not, the pane says what the command is doing from its shape (`Read files and search the code`, `Run tests`), never the command itself. Commands, code, prompts, and raw results are never shown. A line ending in `…` has not finished yet. A failed call says so. The time at the right is when the action began, in local time, so a line that stays put says how long it has been running. A narrow pane leaves the time out.
- **"(sampled)"** next to an agent means its tool calls could not be observed directly. The lines then come from the run record, checked every five seconds, so some actions may be missing.
- **Time is honest.** A finished run shows its recorded duration. "Last progress" is the age of the newest recorded progress, not of the last redraw. A long quiet spell is reported as "no recorded progress", not as a stall. There is no percent complete.
- **The ETA is a range from your past runs, in local time.** It takes past runs on this machine that reached the same phase, and shows when they usually finished: the middle time, then the range most of them fell in. A planning run shows "plan ready" instead. Fewer than three past runs means "ETA unknown". A run already past the usual range says so instead of guessing a new time. To learn these times, the pane reads only the timing of this machine's past runs, about once a day, and never shows anything else from them.
- **Only this session's run.** The pane never shows a run that another session started.
- **Live from the start.** Claude Code writes a run's full record only when the run ends. While it runs, the pane reads the run's live journal instead.

The 5-minute heartbeat line does not include the ETA.

**Opening and closing**

- Type `/masterdevs-status` to open the pane at any time, even mid-turn.
- When a run ends, the pane closes by itself: when the plan is ready for your approval, when the run has questions for you, and when the build loop is done. The result is in the chat. Once you approve and the build starts, it opens again. Reopen it with `/masterdevs-status`, and it stays open.
- Close the pane yourself, and it stays closed for the rest of this session. `/masterdevs-status` opens it again.
- On a narrow terminal (under 144 columns), Claude Code holds back a pane that opens by itself. A one-line hint above the prompt then points to `/masterdevs-status`.

### The 5-minute heartbeat

The heartbeat still runs. It works where the pane cannot, for example on a surface that does not show panes.

A status line posts every ~5 minutes, and it exists for one purpose: letting you stop a run that is heading somewhere wrong. So it reports what the agents are actually doing, not that they are busy.

```
⏳ 2:47 PM PDT · Verify · verify:1.0 running commands (37 steps, 14m) · 41m total
   review:reviewer:1 → review — high in pricing.py:900: The order total multiplies each line rate by the whole billing history
```

The first line is the live agent and what it last reached for; the second is what the previous agent found — a review finding with its file and line, the file list an implement pass touched, a plan conflict, a verification failure, or a criterion Verify has decided cannot be met at all. A stall shows as `⚠ no progress for 23m`, which usually means stuck rather than working.

Run it yourself any time with `node scripts/run-status.mjs [runId]`.

## Is it working?

The design makes a falsifiable claim — front-loading your attention buys uninterrupted time without
costing quality — so it ships with the instruments to check it:

```bash
node scripts/run-report.mjs           # unplanned stops per feature, from real runs
node scripts/loop-scenarios.mjs       # control-flow regression test, free and instant
node scripts/run-status-scenarios.mjs # status pane and status line model, free and instant
claude plugin test plugins/masterdevs # status pane inside an offline Claude Code host
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

Agents share a knowledge base — per-domain **pattern catalogs** (detection recipes: a smell to match, an overfit guard to honor) across `core`, `backend`, `frontend`, `data`, `algo`, `concurrency`, `integration`, `testing` and `infra`; per-lens **reviewer lessons**; and a **refactor backlog**. It learns in two lanes:

- **Shipped seeds** live read-only in the plugin and are versioned. On update they **merge** into your data, never clobber.
- **Learned state** lives in `~/.claude/plugins/data/masterdevs/` and survives updates.

New patterns and lessons are **staged as candidates** with provenance. They only become promoted (loaded by agents) via recurrence ≥2 **or** your confirmation through `/masterdevs:playbook`. Ungated promotion is treated as a security-relevant action — a bad lesson would inject into every future agent.

The `recurrence ≥2` half runs automatically at the start of every feature (`scripts/playbook.mjs --promote`, deterministic, no models), so **what one run learns, the next run knows.** It had to be built: for weeks that rule was policy with no code behind it, and 229 candidates accumulated — 16 already past the bar — while every promoted file still held its empty seed header and every agent started from zero. Learned entries land in a `## Learned` section, separate from the shipped taxonomy.

### The gold lane (curated examples)

A third lane, **gold**, holds curated examples: a piece of code, an abstraction, or a design worth copying. Entries resolve from three scopes — a repository's own `.masterdevs/gold/`, then your machine's `$PLAYBOOK_DIR/gold/`, then the shipped seeds — and **the repository's copy wins** an id collision, so a team can override anything.

It differs from the other two lanes in three ways that matter:

- **Human-write-only.** `/masterdevs:gold` is the only writer. Every agent reads the lane and cites entry ids; none may write, stage, or reindex it.
- **No candidate stage and no recurrence gate.** An entry is live the moment it is captured — a human chose the example, and that *is* the gate.
- **Self-contained.** Each entry snapshots the excerpt into itself, along with the file, symbol, and commit it came from, so an agent needs no access to the repository it was captured from. `scripts/gold.mjs --validate` reports an entry whose file has been deleted or renamed, or whose symbol has moved; `/masterdevs:playbook` mode 5 presents those for a human to re-anchor or retire. Because one lane serves every repository you work in, an anchor is judged only from a checkout that can actually see the commit it was captured at — run the check from an unrelated repository, or from a branch cut before the capture, and the entry is reported as unchecked rather than broken.

### Keeping your team's lane honest in CI (optional)

A repository lane is committed alongside your code, so it can go stale like any other reference to a file. If you want your own CI to catch that, add a step. It clones the plugin because the validator ships with the plugin, not with your repo:

```yaml
      - name: Curated examples still point at real code
        run: |
          git clone --depth 1 https://github.com/MasterDevs/masterclaude "$RUNNER_TEMP/masterclaude"
          node "$RUNNER_TEMP/masterclaude/plugins/masterdevs/scripts/gold.mjs" \
            --validate --gold-dir .masterdevs/gold --repo-root .
```

Two things make this work on a runner. `--gold-dir` names your lane so nothing resolves from the machine's Playbook, and `--repo-root .` says which checkout to judge the anchors against. **Fetch the full history** (`fetch-depth: 0` on `actions/checkout`) — a shallow clone will not contain the commits your entries were captured at, so every anchor reads as unchecked and the step passes without proving anything.

References run **gold → pattern only** — an entry names the patterns it demonstrates, but a catalog never points back, so a row stays readable on its own.

**Capture and contribution are one command.** `/masterdevs:gold` asks where an example goes as its *first* question — a pull request to this repo, your team's `.masterdevs/gold/`, or just this machine — because whether something is worth sharing is what a person knows at the moment they capture it, and asking later means asking never. The public answer scrubs a copy behind a gate that refuses on any hit and opens the pull request from a throwaway clone, so no checkout you work in is ever touched. `/masterdevs:playbook` mode 6 sends a promoted pattern or lesson the same way.

The Playbook is **one store shared by every repo you run against** (22 worktrees feed this one), so a pattern earned in the backend is loaded by the next frontend run whose domain matches. Domain and lens routing keeps it relevant rather than noisy.

## Extending the Review Panel

`/masterdevs:roster` registers a reviewer with a lens, a model, and a lessons lane (plus triggers, recorded for later — every registered reviewer currently runs on every review round). Its findings flow back into the lessons engineers preload, so the team gets better at avoiding what your reviewers catch.

## Notes
- Workflow scripts (`workflows/*.js`) ship as plain files and are invoked by path from the `feature` skill.
- Reviewer memory from the `eng-skills` plugin, if installed, is read defensively as a rejection catalog — never written to.
