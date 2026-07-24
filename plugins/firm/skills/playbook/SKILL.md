---
name: playbook
description: "Curate the firm Playbook: review staged pattern and lesson candidates with their provenance, promote or reject them, add a confirmed pattern directly, and prune stale or bloated entries. Invoke as /firm:playbook. This is the ONLY gate through which candidates become promoted knowledge that agents load."
---

# /firm:playbook — curate the self-learning knowledge base

You maintain the Playbook's integrity. Learned knowledge is **gated**: candidates only become promoted (loaded by engineers/architects) through recurrence ≥2 **or** explicit human confirmation here. An ungated promotion is a standing prompt injection into every future agent — treat promotion as a security-relevant action.

## Step 0 — Resolve `PLAYBOOK_DIR`
`${CLAUDE_PLUGIN_DATA}/playbook` if it resolves, else `~/.claude/plugins/data/firm/playbook`.

## Modes (ask the user which, or infer from their request)

### 1. Review candidates (default)
- Read every `patterns/<domain>/candidates.md` and `lessons/<lens>.candidates.md`.
- Present each candidate with its **provenance** (where seen, date, occurrence count) and whether it has met the recurrence-≥2 bar.
- For each, let the user **promote**, **reject**, or **edit-then-promote**.
- On promote: append a compressed row/entry to the promoted `catalog.md` / `lessons/<lens>.md` in the required format (patterns: `| Name | Intent | Reach for when | Skip when |`, ≤~30 words/cell, no prose, no code samples; lessons: one `**Lesson** — … **Seen:** … **Why:** …` entry). Then remove it from the candidates file.
- On reject: remove it from candidates (optionally note why, to avoid re-staging).

### 2. Add a pattern directly (human-confirmed)
When the user says e.g. "when you see X, that's chain-of-responsibility — add it": write it straight to the right domain `catalog.md` as human-confirmed (this bypasses the recurrence gate because a human confirmed it). Keep the density format.

### 3. Prune
- Flag catalog files exceeding ~150 lines and lessons lanes that have grown noisy.
- Remove stale, superseded, or never-triggered entries the user confirms. Density is a feature — a bloated catalog stops firing.

## Rules
- **Never** promote without user confirmation unless a candidate has genuinely recurred ≥2 (and even then, show it before writing).
- **Never** modify the shipped seeds under `${CLAUDE_PLUGIN_ROOT}` — only the data-dir Playbook.
- Preserve the file headers and `[seed vN]` markers.
- Report what changed: promoted, rejected, pruned — counts and names.
