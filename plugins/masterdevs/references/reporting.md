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

## Plan previews — one screen by default

Use this guidance for standalone plans and feature approval gates. It replaces the completed-work
structure below; do not append that structure or run stats to a plan preview.

- Keep the whole preview within roughly 12–18 displayed lines and about 140 words, including any
  visuals, blank lines, links, and closing question. Shorter is welcome; do not pad to reach a target.
  This is a presentation target, not a limit on
  the detailed plan. If the actual viewport is available, adapt to it; otherwise use this compact
  default. Terminal dimensions do not establish the chat viewport. Do not claim an exact fit.
- Make the proposed change clear using the smallest useful form: a short phrase, bullets, prose,
  pseudocode, an ASCII diagram, or a before/after comparison. Choose or combine forms only when they
  help explain this plan. No particular presentation form is mandatory.
- When a visual helps, keep it small and label it with domain concepts and meaningful boundaries or
  decisions. Avoid generic "plan -> build -> test" diagrams and prose that repeats the visual.
  Keep diagram lines under roughly 60 characters; use a vertical flow if needed. Fence ASCII or
  pseudocode to preserve alignment.
- Add only the design choice worth challenging (with a recommendation), a compact statement of
  success and how it will be verified, and the relevant claim status. Include only what applies;
  do not fill template slots. Keep file lists, pattern recipes, per-step guidance, and evidence in
  the full plan.
- Link the full plan artifact when one exists, using a short label. Preserve the complete structured
  plan and its acceptance criteria for implementation; never replace them with the preview.
- Show every unresolved or unverifiable claim or criterion that affects the decision, with its
  consequence. Never present a still-refuted claim as resolved. Summarize verified claims by count;
  mark unchecked claims as unchecked. Mention a correction only if it changed the proposed design.
  If material caveats cannot fit, shorten the visual and other prose first, then exceed the target
  rather than hide them. Do not dump all successful checks into the preview.
- End with one next action appropriate to the command: challenge the design for a standalone plan;
  approve, edit, or reject at a feature gate. Include required continuation/edit instructions in that
  line where possible. Do not imply approval from silence.

For example (illustrative, not a template to copy regardless of the feature):

```text
Import invoices once, without duplicating retries.

Upload -> Validate -> Match invoice ID
                        | known -> Skip
                        | new   -> Save

Recommend: use the existing invoice ID for deduplication.
Verify: import the same fixture twice; one stored invoice.
Claims: 3 verified; no unresolved assumptions.
Full plan: <artifact link>
Approve, edit, or reject?
```

## Completed-work structure — these sections, in this order

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

## Completed-work rules

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
