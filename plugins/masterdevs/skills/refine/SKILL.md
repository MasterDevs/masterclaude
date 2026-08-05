---
name: refine
description: "Interview you until a vague idea becomes a settled statement of intent — outcome, user, success, constraint, and an explicit out-of-scope line — without building anything. Use when you know roughly what you want but not precisely, when you want your thinking stress-tested before committing, or to prepare a brief you'll hand to /masterdevs:feature later. Invoke as /masterdevs:refine <the rough idea>."
---

# /masterdevs:refine — settle the intent, build nothing

The interview from the feature loop, on its own. Produces one artifact: a confirmed statement of intent.
No plan, no code.

Use it when the idea is still fuzzy, when you want to be pushed on it before committing, or when you
want the thinking done now and the building done later.

## Step 1 — Interview

Read `${CLAUDE_PLUGIN_ROOT}/references/interview.md` and follow it exactly. It is the shared protocol —
`/masterdevs:feature` runs the same one as its first step.

Two differences when running standalone:

- **Don't skip it.** The feature loop skips the interview for self-contained briefs because it has a
  plan gate behind it. Here the interview *is* the deliverable, so if the user invoked this command,
  they want the conversation. If the ask really is already settled, say so after one or two questions
  rather than manufacturing more.
- **You may go deeper on the idea itself.** The feature loop's interview is scoped to what's needed to
  build. Here you can push on whether the thing is worth building: what breaks if it doesn't exist, what
  the simplest version that still helps looks like, what they'd cut under time pressure. Stay a thinking
  partner, not a yes-machine — if the idea has a weak spot, name it.

## Step 2 — Ground it in the code, briefly

Once the restate is confirmed, take one pass through the relevant code to check the intent survives
contact with reality: does the abstraction they're assuming exist, actually exist? Is the constraint they
named the real binding one?

Keep this short — you're sanity-checking the intent, not planning the work. If you find something that
changes the picture, bring it back to them and re-confirm the affected line.

## Step 3 — Deliver

Show the confirmed six-field intent, plus anything the code check changed.

Offer to save it: `$DATA_DIR/intents/<slug>-<date>.md`, where `DATA_DIR` is `${CLAUDE_PLUGIN_DATA}` or
`~/.claude/plugins/data/masterdevs-masterclaude/`. **Only if they say yes** — an unrequested file is
clutter, and the intent is in this conversation either way.

Then tell them the two ways forward, briefly:

- `/masterdevs:feature` with this intent folded into the brief — it will recognize a settled ask and skip
  straight to planning.
- `/masterdevs:plan` if they want to see the design before committing to a build.

Do not start building. If they ask you to, hand off to `/masterdevs:feature` rather than doing it here —
this command has no plan gate, no verification, and no review behind it.
