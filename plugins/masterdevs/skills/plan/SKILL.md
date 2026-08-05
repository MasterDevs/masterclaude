---
name: plan
description: "Produce a masterdevs implementation plan — ordered steps with design guidance resolved from the pattern Playbook — without building it. Use when you want to see and argue with the design before any code is written, or to plan work you intend to implement yourself. Invoke as /masterdevs:plan <what to plan>."
---

# /masterdevs:plan — design it, don't build it

The Architect phase on its own. Produces a plan you can read, edit, or reject. Nothing is implemented.

## Step 1 — Get to a settled ask

The Architect needs a clear target or it plans the wrong thing.

- If the user points at a confirmed intent (from `/masterdevs:refine`) or a written spec — use it.
- If the ask is self-contained, proceed.
- Otherwise, interview first: `${CLAUDE_PLUGIN_ROOT}/references/interview.md`. Keep it tight — you need
  enough to design against, not the full treatment.

## Step 2 — Resolve the Playbook

`PLAYBOOK_DIR` = `$DATA_DIR/playbook`, where `DATA_DIR` is `${CLAUDE_PLUGIN_DATA}` or
`~/.claude/plugins/data/masterdevs-masterclaude/`. If it doesn't exist, seed it:
`cp -R "${CLAUDE_PLUGIN_ROOT}/playbook-seeds/" "$PLAYBOOK_DIR"` and write `SEED_VERSION` from the shipped
`VERSION`.

## Step 3 — Run the Architect

One `masterdevs:architect` agent on `opus`. Give it the settled ask, the Playbook root, and the
instruction to resolve the design — inline the concrete guidance per step so an engineer never has to
open the pattern catalog.

It returns `{summary, lenses, steps: [{title, intent, files, guidance, acceptance}]}`.

## Step 4 — Present it for argument, not approval

There's no build behind this command, so don't ask "approve?" — ask what's wrong with it. Summarize:

- **The approach** in two or three sentences, in the user's vocabulary.
- **The steps**, one line each — what changes and why, not a file listing.
- **The design calls worth arguing with**: where a pattern was chosen over an alternative, where existing
  code is being extended rather than replaced, anything the user might disagree with. This is the part
  with value; a plan nobody argues with was not worth reading.
- **What this plan assumes** — the assumptions that, if wrong, invalidate it.

Offer to save it to `$DATA_DIR/plans/<slug>-<date>.md` if they want it, and mention that
`/masterdevs:feature` can take it from here — it will re-plan against its own interview, so a plan
produced here is input to that conversation, not a substitute for it.
