#!/usr/bin/env node
// Close the Playbook's learning loop.
//
// Agents stage what they learn as CANDIDATES; only promoted entries are loaded by future agents. The
// shipped policy — printed in every promoted file's own header — is:
//
//     Promotion gate: recurrence >=2 OR human confirmation via /masterdevs:playbook
//
// Only the second half was ever built. The first half was policy with no code behind it, so nothing
// was ever promoted automatically: 229 candidates accumulated across weeks of runs, 15 of them already
// past the recurrence bar (one marked "Seen 9x"), and every promoted file still held its empty seed
// header. Every agent started as ignorant as the first one.
//
//   node playbook.mjs --status            # what is staged, what is eligible, what is promoted
//   node playbook.mjs --promote           # promote everything at recurrence >= threshold
//   node playbook.mjs --promote --dry-run # show exactly what that would do, change nothing
//   node playbook.mjs --dedupe            # merge near-identical candidates, summing their counts
//   node playbook.mjs --threshold 3       # raise the bar (default 2, matching the shipped policy)
//
// Deterministic and free — no models. Safe to run at the start of every feature, which is the point:
// what one run learns, the next run knows.
//
// WHY A SCRIPT AND NOT AN AGENT: promotion decides what gets injected into every future agent's
// context. That deserves a mechanism you can read, diff, and re-run — not a judgment call that varies
// per invocation. Genuinely ambiguous merges are left for `/masterdevs:playbook`, where a human looks.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const dryRun = has('--dry-run')
const THRESHOLD = argv.includes('--threshold')
  ? Math.max(1, parseInt(argv[argv.indexOf('--threshold') + 1], 10) || 2) : 2

const dirArg = argv.includes('--playbook-dir') ? argv[argv.indexOf('--playbook-dir') + 1] : null
const PLAYBOOK = dirArg || path.join(os.homedir(), '.claude/plugins/data/masterdevs-masterclaude/playbook')

if (!fs.existsSync(PLAYBOOK)) {
  console.log(`No playbook at ${PLAYBOOK} — nothing to do (it is created on the first feature run).`)
  process.exit(0)
}

// ── Parsing ────────────────────────────────────────────────────────────────
// A candidate is a `## Heading` and everything under it until the next `## `.
const parseCandidates = (file) => {
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch { return { header: '', entries: [] } }
  const lines = text.split('\n')
  const firstHeading = lines.findIndex((l) => l.startsWith('## '))
  if (firstHeading === -1) return { header: text, entries: [] }
  const header = lines.slice(0, firstHeading).join('\n')
  const entries = []
  let cur = null
  for (const line of lines.slice(firstHeading)) {
    if (line.startsWith('## ')) {
      if (cur) entries.push(cur)
      cur = { title: line.slice(3).trim(), body: [] }
    } else if (cur) cur.body.push(line)
  }
  if (cur) entries.push(cur)
  return { header, entries: entries.map((e) => ({ ...e, body: e.body.join('\n').replace(/\s+$/, '') })) }
}

// How many DISTINCT times has this been seen? Two independent signals, because agents have written
// both shapes: an explicit "Seen Nx" marker, and one provenance line per sighting.
const recurrenceOf = (entry) => {
  const blob = `${entry.title}\n${entry.body}`
  const marks = [...blob.matchAll(/Seen\s+(\d+)\s*x/gi)].map((m) => parseInt(m[1], 10))
  const provenanceLines = (blob.match(/^\s*[-*]?\s*\**Provenance/gim) || []).length
  const sightingLines = (blob.match(/\d+(?:st|nd|rd|th)\s+sighting/gi) || []).length
  return Math.max(1, ...marks, provenanceLines, sightingLines)
}

// Near-duplicate detection on the heading. Deliberately conservative: this only merges things a human
// would call the same entry. Anything subtler is left alone rather than silently fused.
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'at', 'is', 'it', 'not', 'that'])
const tokens = (s) => new Set(
  s.toLowerCase().replace(/[`_*(),.:;/\\[\]"'—–-]/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t)))
const similarity = (a, b) => {
  const A = tokens(a), B = tokens(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / (A.size + B.size - inter)      // Jaccard
}
const SIMILAR = 0.8

// ── Lane discovery ─────────────────────────────────────────────────────────
// lessons/<lens>.candidates.md -> lessons/<lens>.md
// patterns/<domain>/candidates.md -> patterns/<domain>/catalog.md
const lanes = []
const lessonsDir = path.join(PLAYBOOK, 'lessons')
if (fs.existsSync(lessonsDir)) {
  for (const f of fs.readdirSync(lessonsDir).filter((f) => f.endsWith('.candidates.md'))) {
    lanes.push({ kind: 'lesson', name: `lessons/${f.replace('.candidates.md', '')}`,
      candidates: path.join(lessonsDir, f), promoted: path.join(lessonsDir, f.replace('.candidates.md', '.md')) })
  }
}
const patternsDir = path.join(PLAYBOOK, 'patterns')
if (fs.existsSync(patternsDir)) {
  for (const d of fs.readdirSync(patternsDir)) {
    const cand = path.join(patternsDir, d, 'candidates.md')
    if (fs.existsSync(cand)) lanes.push({ kind: 'pattern', name: `patterns/${d}`,
      candidates: cand, promoted: path.join(patternsDir, d, 'catalog.md') })
  }
}
lanes.sort((a, b) => a.name.localeCompare(b.name))

// ── Rendering a promoted entry ─────────────────────────────────────────────
// Pattern catalogs are markdown TABLES; candidates carry the exact columns as labelled bullets, so the
// row is assembled mechanically. A candidate missing them is not silently mangled — it is reported as
// needing a human, because a half-built catalog row is worse than an unpromoted one.
const field = (body, label) => {
  const m = body.match(new RegExp(`^\\s*[-*]?\\s*\\**${label}\\**\\s*[:：]\\s*(.+?)(?=\\n\\s*[-*]\\s*\\**(?:Intent|Reach for when|Skip when|Provenance)\\**\\s*[:：]|$)`, 'ims'))
  return m ? m[1].replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim() : null
}
const asTableRow = (e) => {
  const intent = field(e.body, 'Intent')
  const reach = field(e.body, 'Reach for when')
  const skip = field(e.body, 'Skip when')
  if (!intent || !reach || !skip) return null
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s)
  return `| ${e.title.replace(/\|/g, '\\|')} | ${clip(intent, 220)} | ${clip(reach, 320)} | ${clip(skip, 220)} |`
}
const asLessonBlock = (e, rec) =>
  `## ${e.title}\n_Promoted automatically at recurrence ${rec}._\n${e.body}\n`

// ── Actions ────────────────────────────────────────────────────────────────
const writeFile = (p, s) => { if (!dryRun) fs.writeFileSync(p, s) }

const dedupe = (entries) => {
  const kept = []
  const merges = []
  for (const e of entries) {
    const hit = kept.find((k) => similarity(k.title, e.title) >= SIMILAR)
    if (hit) {
      hit.body += `\n\n<!-- merged duplicate: "${e.title}" -->\n${e.body}`
      hit.merged = (hit.merged || 1) + 1
      merges.push([hit.title, e.title])
    } else kept.push({ ...e })
  }
  return { kept, merges }
}

let totalStaged = 0, totalEligible = 0, totalPromoted = 0, totalMerged = 0
const report = []

for (const lane of lanes) {
  const { header, entries } = parseCandidates(lane.candidates)
  if (!entries.length) { report.push({ lane: lane.name, staged: 0, eligible: 0, promoted: 0, merged: 0 }); continue }

  const { kept, merges } = (has('--dedupe') || has('--promote')) ? dedupe(entries) : { kept: entries, merges: [] }
  // Merging is itself evidence of recurrence: the same lesson written twice IS two sightings.
  const scored = kept.map((e) => ({ ...e, recurrence: Math.max(recurrenceOf(e), e.merged || 1) }))
  const eligible = scored.filter((e) => e.recurrence >= THRESHOLD)

  totalStaged += entries.length
  totalEligible += eligible.length
  totalMerged += merges.length

  let promotedNow = 0, unpromotable = []
  if (has('--promote') && eligible.length) {
    let promotedText = fs.existsSync(lane.promoted) ? fs.readFileSync(lane.promoted, 'utf8') : ''
    promotedText = promotedText.replace(/^\[seed v\d+ — empty\]\s*$/m, '').replace(/\s+$/, '')
    const additions = []
    for (const e of eligible) {
      if (lane.kind === 'pattern') {
        const row = asTableRow(e)
        if (!row) { unpromotable.push(e.title); continue }
        additions.push(row)
      } else {
        additions.push(asLessonBlock(e, e.recurrence))
      }
      promotedNow++
    }
    if (additions.length) {
      if (lane.kind === 'pattern') {
        // Several shipped catalogs are SECTIONED (`## Channels`, `## Construction`, …) with a table
        // under each. Appending to the end of such a file files a general pattern under whichever
        // section happens to be last, which is wrong and quietly misleading. Learned rows get their
        // own section instead — also making it obvious at a glance what was seeded vs. what was earned.
        const LEARNED = '## Learned (promoted from candidates)'
        if (promotedText.includes(LEARNED)) {
          promotedText = `${promotedText.replace(/\s+$/, '')}\n${additions.join('\n')}\n`
        } else {
          promotedText = `${promotedText}\n\n${LEARNED}\n\n` +
            `| Pattern | Intent | Reach for when | Skip when |\n|---|---|---|---|\n` +
            `${additions.join('\n')}\n`
        }
      } else {
        promotedText = `${promotedText}\n\n${additions.join('\n')}\n`
      }
      writeFile(lane.promoted, promotedText)
    }
    // Anything promoted (or unpromotable) leaves the candidate file; the rest stays staged.
    const promotedTitles = new Set(eligible.filter((e) => !unpromotable.includes(e.title)).map((e) => e.title))
    const remaining = scored.filter((e) => !promotedTitles.has(e.title))
    writeFile(lane.candidates, `${header}\n${remaining.map((e) => `## ${e.title}\n${e.body}`).join('\n\n')}\n`)
  } else if (has('--dedupe') && merges.length) {
    writeFile(lane.candidates, `${header}\n${scored.map((e) => `## ${e.title}\n${e.body}`).join('\n\n')}\n`)
  }

  totalPromoted += promotedNow
  report.push({ lane: lane.name, staged: entries.length, eligible: eligible.length,
    promoted: promotedNow, merged: merges.length, unpromotable })
}

// ── Output ─────────────────────────────────────────────────────────────────
const action = has('--promote') ? 'promote' : has('--dedupe') ? 'dedupe' : 'status'
console.log(`\nPlaybook — ${action}${dryRun ? ' (dry run, nothing written)' : ''}   threshold: recurrence >= ${THRESHOLD}`)
console.log(`${PLAYBOOK}\n`)
console.log('  lane                       staged  eligible  promoted  merged')
console.log('  ' + '─'.repeat(62))
for (const r of report) {
  if (!r.staged && !r.promoted) continue
  console.log(`  ${r.lane.padEnd(26)} ${String(r.staged).padStart(6)} ${String(r.eligible).padStart(9)} ` +
    `${String(r.promoted).padStart(9)} ${String(r.merged).padStart(7)}`)
}
console.log('  ' + '─'.repeat(62))
console.log(`  ${'total'.padEnd(26)} ${String(totalStaged).padStart(6)} ${String(totalEligible).padStart(9)} ` +
  `${String(totalPromoted).padStart(9)} ${String(totalMerged).padStart(7)}\n`)

const stuck = report.flatMap((r) => (r.unpromotable || []).map((t) => `${r.lane}: ${t}`))
if (stuck.length) {
  console.log(`  ${stuck.length} eligible candidate(s) could not be promoted mechanically — a pattern row needs`)
  console.log(`  Intent / Reach for when / Skip when. Left staged for /masterdevs:playbook:`)
  for (const s of stuck.slice(0, 8)) console.log(`    · ${s}`)
  if (stuck.length > 8) console.log(`    · …and ${stuck.length - 8} more`)
  console.log('')
}

if (action === 'status') {
  if (totalEligible) {
    console.log(`  ${totalEligible} candidate(s) are past the recurrence bar and are NOT yet loaded by any agent.`)
    console.log(`    node playbook.mjs --promote --dry-run     # see exactly what would move`)
    console.log(`    node playbook.mjs --promote               # do it\n`)
  } else if (totalStaged) {
    console.log(`  Nothing past the bar yet. Candidates promote once seen ${THRESHOLD}+ times, or via`)
    console.log(`  /masterdevs:playbook when you confirm one by hand.\n`)
  }
} else if (has('--promote')) {
  console.log(dryRun
    ? `  Dry run — re-run without --dry-run to apply.\n`
    : `  ${totalPromoted} entr(ies) promoted. Every agent from the next run on will load them.\n`)
  if (totalStaged - totalPromoted > 0) {
    console.log(`  ${totalStaged - totalPromoted} still staged below the bar — review by hand with /masterdevs:playbook.\n`)
  }
}
