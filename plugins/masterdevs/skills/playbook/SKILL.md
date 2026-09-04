---
name: playbook
description: "Curate the masterdevs Playbook: review staged pattern and lesson candidates with their provenance, promote or reject them, add a confirmed pattern directly, and prune stale or bloated entries. Invoke as /masterdevs:playbook. This is the ONLY gate through which candidates become promoted knowledge that agents load."
---

# /masterdevs:playbook — curate the self-learning knowledge base

You maintain the Playbook's integrity. Learned knowledge is **gated**: candidates only become promoted (loaded by engineers/architects) through recurrence ≥2 **or** explicit human confirmation here. An ungated promotion is a standing prompt injection into every future agent — treat promotion as a security-relevant action.

## Step 0 — Resolve `PLAYBOOK_DIR`
`${CLAUDE_PLUGIN_DATA}/playbook` if it resolves, else `~/.claude/plugins/data/masterdevs/playbook`.

## Step 1 — Always start here: promote what already qualifies

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/playbook.mjs --playbook-dir "$PLAYBOOK_DIR" --status
```

Anything at recurrence ≥2 needs no conversation — it already passed the shipped gate. Promote it with `--promote` and report the count in one line. Only then bring the user into it, so their attention goes to genuine judgment calls rather than rubber-stamping.

## Modes (ask the user which, or infer from their request)

### 1. Review candidates (default)

Read every `patterns/<domain>/candidates.md` and `lessons/<lens>.candidates.md`.

**Triage before you present.** There can be hundreds — 229 accumulated before promotion was ever automated, and marching through them one by one is not a review, it is an endurance test. So:

1. **Group by what they actually describe**, not by wording. Near-identical entries written differently are the normal case, because agents used to append instead of bumping. A group of three separate write-ups of one pattern *is* a recurrence-3 pattern — merge them, sum the sightings, and it may now clear the bar on its own.
2. **Rank groups by sightings, then by how often that area appears in the recent run history.** A pattern in code nobody touches is not worth loading into every future agent.
3. **Present the top ~10 groups**, each in three lines: what it detects, where it was seen and how often, and your recommendation (promote / reject / needs-an-edit). Then ask. Offer the next batch after.
4. **Say plainly what you skipped and why** — "142 singletons in areas untouched since July, left staged." Silent truncation reads as completeness.

For each presented candidate, let the user **promote**, **reject**, or **edit-then-promote**.
- On promote: append a compressed row/entry to the promoted `catalog.md` / `lessons/<lens>.md` in the required format (patterns: `| Name | Intent | Reach for when | Skip when |`, ≤~30 words/cell, no prose, no code samples; lessons: one `**Lesson** — … **Seen:** … **Why:** …` entry). Then remove it from the candidates file.
- On reject: remove it from candidates (optionally note why, to avoid re-staging).

### 2. Add a pattern directly (human-confirmed)
When the user says e.g. "when you see X, that's chain-of-responsibility — add it": write it straight to the right domain `catalog.md` as human-confirmed (this bypasses the recurrence gate because a human confirmed it). Keep the density format.

### 3. Prune
- Flag catalog files exceeding ~150 lines and lessons lanes that have grown noisy.
- Remove stale, superseded, or never-triggered entries the user confirms. Density is a feature — a bloated catalog stops firing.

### 4. Merge duplicates

Agents now bump an existing candidate's count instead of appending a new one, but the backlog written before that rule is full of the same lesson recorded several times under different headings. Merging them is not housekeeping — **recurrence is what promotes**, so three separate write-ups of one pattern currently look like three one-offs and none of them ever qualifies. Merge on the shape being detected, keep the clearest wording, and carry every provenance line across so the summed count is honest.

### 5. Gold lane — re-anchor or retire (additive)

The gold lane holds curated examples a human captured with `/masterdevs:gold`. It has no candidate file
and no recurrence gate — a human chose the entry, which *is* the gate — so the only curation it needs
here is what to do when an entry stops matching the code it points at.

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/gold.mjs --validate --playbook-dir "$PLAYBOOK_DIR"
```

Every anchor line carries a **reason code in brackets**. Branch on the code, not on the sentence — the
prose is there for the user, the code is what decides your recommendation.

**Problems (the validator exits non-zero). Each one is real staleness — act on it.**

| Code | What happened | Recommend |
|---|---|---|
| `FILE_GONE` | the file was moved or deleted since capture | re-anchor to its new path |
| `SYMBOL_GONE` | the file is still there, the symbol is not | re-anchor, or retire if the idea is gone too |
| `RANGE_SHORT` | the file is now shorter than the recorded line range | re-anchor to the current range |

A **malformed entry** also lands here — show the id and the field that failed.

**Skips (the validator stays clean). Nothing is wrong. Report and stop.**

| Code | What happened | Recommend |
|---|---|---|
| `NOT_THIS_REPO` | you are in a different repository than the entry describes | nothing — say so in one line |
| `BEHIND_ANCHOR` | the right repository, but this checkout predates the capture | nothing — a newer checkout will judge it |
| `OUTSIDE_REPO` | the recorded path escapes the repository | fix the path; do not read the file |

**Never offer a skipped entry for retirement.** A lane on one machine is shared by every repository that
machine visits, so an entry naming a common path would otherwise be offered up for deletion from any
unrelated directory. The validator does not fail on these, and neither should you.

Offer three actions per problem entry:

1. **Re-anchor** — update the anchor's path, symbol and sha, re-snapshot the excerpt from the file as it
   is now, and re-run `--validate`.
2. **Retire** — delete the entry file, then
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/gold.mjs --reindex --scope <its scope>`.
3. **Leave it** — with a stated reason, so the next pass knows why it is still red.

Recommend **re-anchor** by default. Retiring is how a curated example is lost, and a moved file is the
commonest cause of a red line here.

This mode **shells out to `gold.mjs`** and is a presentation layer over that one detector. It never
re-implements rot detection, never runs `scripts/playbook.mjs`, and never stages a candidate.

## Rules
- **Never** promote without user confirmation unless a candidate has genuinely recurred ≥2 (and even then, show it before writing).
- **Never** modify the shipped seeds under `${CLAUDE_PLUGIN_ROOT}` — only the data-dir Playbook.
- Preserve the file headers and `[seed vN]` markers.
- The **gold lane** is written only by `/masterdevs:gold`. It has no candidate lane and no recurrence
  gate, and mode 5 is its only curation surface here.
- Report what changed: promoted, rejected, pruned — counts and names.
