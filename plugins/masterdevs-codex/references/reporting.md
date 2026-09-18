# How to report back

Shared by every masterdevs command that hands results to a human. Load this before writing the report.

**The situation you're writing into.** The user has been away — minutes for a review, an hour or two for
a full feature. They come back to results about code they did not write and will not read. **Your job is
to make the decisions obvious, not to summarize the work.**

Write in the vocabulary of the **confirmed intent** if you have one — their Outcome, Success, and
Constraint lines, in their nouns. If a sentence's subject is a file, function, or symbol name, it is
written at the wrong altitude.

Every finding, escalation, and deferral carries a `soWhat`: one plain sentence about consequence,
written by the agent that had the code open. **Lead with `soWhat`. Put `summary`, `file`, and `line` in
a trailing clause or leave them out** — the user can ask.

## Structure — these sections, in this order

**1. The bottom line (1–2 sentences).** Did they get what they asked for? Frame it against their success
criteria, not against a status enum. If something they explicitly asked for wasn't delivered, that goes
here, not further down.

**2. Needs you.** Only items where doing nothing has a cost. Each one gets:
- what it means, in their words (the `soWhat`)
- **your recommendation**
- **what happens by default if they say nothing**

If this section is empty, say so in one line — that's the win condition, not an omission.

**3. For the record.** Everything else, **one line each**, no sub-bullets. Close with *"ask if you want
detail on any of these."* Resist expanding; the detail is available on request.

Then one closing line of run stats.

## Rules

- **Hard cap: 25 lines** before the stats line. If it doesn't fit, you are explaining rather than
  deciding — cut section 3, never section 2.
- **Never ask a bare question.** "Want me to X or Y?" makes the user do the analysis. Ask with a
  recommendation and a default attached.
- **Don't narrate the process.** How many rounds ran, which agent found what, how the plan was revised —
  none of it changes a decision. One line in section 3 at most.
- **Say which results are confirmed** (tests ran, here's the output) versus asserted.

## The altitude test

> ❌ The reviewer flagged high (performance lens): `recompute_los_bucket_variants`' sweep matches only
> the schema prefix of the cache key, not the per-invoice values fingerprint.
>
> ✅ Editing a tax rate makes that invoice recalculate from scratch on every view, permanently — no
> wrong numbers, just slow. *Recommend: follow-up ticket, don't hold the PR.*

Same finding. The second one can be acted on without opening the diff.

## Rationalizations

| You'll be tempted to think | Reality |
|---|---|
| "They'll want the technical detail" | They'll ask. Offering it costs one line; front-loading it costs the whole report |
| "This finding needs context to understand" | If it can't be stated as a consequence, it may not be worth reporting |
| "I should show what the agents did" | Effort is not a deliverable. Only decisions and outcomes are |
| "I'll list both options and let them choose" | A bare choice hands back the analysis you were meant to do |
| "It's all important" | Then nothing is marked important, and they read none of it |
