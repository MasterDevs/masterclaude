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
`VERSION`. If it exists but has no `SEED_VERSION`, another adapter created it: fill in only the seed
files that are absent and write `SEED_VERSION`, rather than copying over what is already there.

If it already exists and `SEED_VERSION` is behind, merge the gold lane in too. One command, safe to
re-run — it creates the lane if absent, adds only ids the user lacks, never overwrites an edited entry,
and refreshes the index:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/gold.mjs --merge-seeds --playbook-dir "$PLAYBOOK_DIR"
```

Both this command and `/masterdevs:feature` create `$PLAYBOOK_DIR`, and the merge rules used to be
written out in prose in both places. They drifted. The command above is now the one copy — call it,
don't restate it.

## Step 3 — Run the Architect

One `masterdevs:architect` agent on `fable`. Give it the settled ask, the Playbook root, and the
instruction to resolve the design — inline the concrete guidance per step so an engineer never has to
open the pattern catalog.

It returns `{summary, lenses, claims, steps: [{title, intent, files, guidance, acceptance}]}`.

`claims` are the facts about existing code the plan depends on — call-site counts, a symbol existing with the signature used, an invariant already permitting what's prescribed — each with the `check` that settles it and what breaks `ifWrong`.

## Step 4 — Present it for argument, not approval

Read `${CLAUDE_PLUGIN_ROOT}/references/reporting.md` and follow its **Plan previews** guidance. Choose
the smallest useful form for this plan; sentences and diagrams are optional. Include only the
decision and verification notes needed to judge the design. Keep the complete returned plan
available for detail; do not paste its steps into chat.

There's no build behind this command, so don't ask "approve?" — ask what's wrong with it. Claims have
not been fact-checked by this command: label them unchecked, surface decision-relevant assumptions
and their consequences, and offer to check them. Do not imply that a plausible plan is verified.

Offer to save it to `$DATA_DIR/plans/<slug>-<date>.md` if they want it, and mention that
`/masterdevs:feature` can take it from here — it will re-plan against its own interview, so a plan
produced here is input to that conversation, not a substitute for it.
