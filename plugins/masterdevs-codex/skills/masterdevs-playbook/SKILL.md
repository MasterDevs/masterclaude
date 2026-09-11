---
name: masterdevs-playbook
description: Curate the MasterDevs pattern and lesson Playbook by promoting recurrent candidates, reviewing one-offs, merging duplicates, or pruning stale knowledge. Use only for explicit Playbook maintenance requests.
---

# MasterDevs Playbook

Resolve `PLUGIN_ROOT` as two directories above this skill. Resolve paths with `node "$PLUGIN_ROOT/scripts/codex-state.mjs" paths --json`. Run `node "$PLUGIN_ROOT/scripts/playbook.mjs" --playbook-dir "<playbookDir>" --status`, then promote recurrence-qualified entries deterministically with `--promote`.

For human review, group candidates by detection shape rather than wording, sum honest recurrence, and present at most ten groups ranked by recurrence and recent relevance. For each, recommend promote, reject, or edit. Never modify shipped seeds. Only recurrence of at least two or explicit human confirmation may write to promoted lanes.

## Gold lane — re-anchor or retire

The gold lane holds curated examples a human captured with `$masterdevs-gold`. It has no candidate file
and no recurrence gate — a human chose the entry, which *is* the gate — so the only curation it needs
here is what to do when an entry stops matching the code it points at.

```
node "$PLUGIN_ROOT/scripts/gold.mjs" --validate --playbook-dir "<playbookDir>"
```

Every anchor line carries a **reason code in brackets**. Branch on the code, not on the sentence: the
prose is for the user, the code decides your recommendation.

**Problems — the validator exits non-zero. Each is real staleness; act on it.** `FILE_GONE` (moved or
deleted since capture) and `RANGE_SHORT` (file now shorter than the recorded range) both mean re-anchor.
`SYMBOL_GONE` means re-anchor, or retire if the idea is gone too. A malformed entry lands here as well —
show the id and the field that failed.

**Skips — the validator stays clean. Nothing is wrong; report and stop.** `NOT_THIS_REPO` (you are in a
different repository than the entry describes), `BEHIND_ANCHOR` (right repository, checkout predates the
capture), `OUTSIDE_REPO` (the recorded path escapes the repository — fix the path, do not read the file).

**Never offer a skipped entry for retirement.** One machine's lane is shared by every repository that
machine visits, so an entry naming a common path would otherwise be offered for deletion from any
unrelated directory.

Offer three actions per problem entry: **re-anchor** (update path, symbol and sha, re-snapshot the
excerpt, re-run `--validate`), **retire** (delete the file, then `--reindex --scope <its scope>`), or
**leave it** with a stated reason. Recommend re-anchor by default — retiring is how a curated example is
lost, and a moved file is the commonest cause of a red line.

This mode is a presentation layer over `gold.mjs`. Never re-implement rot detection, never run
`playbook.mjs` for it, and never stage a gold candidate.

## Send a promoted pattern or lesson upstream

A learned row is worth more than one machine. When the user wants one shared, follow
`$PLUGIN_ROOT/references/upstream-submit.md` — the same mechanism `$masterdevs-gold` uses for its
**public** destination, so the scrub gate and the throwaway-clone rule are written once. Only a
**promoted** row is eligible; a candidate has not passed the gate.

The gold lane is written only by `$masterdevs-gold`, and the two modes above are its only curation
surface here.

Report promoted, rejected, merged, and pruned entries by count and name.
