#!/usr/bin/env node
// What did masterdevs actually cost you?
//
// The design bets that your time is the scarce resource: you front-load attention into the interview
// and plan gate, then the run goes dark and you go do something else. That bet is only testable if
// interruptions are counted, so this reads the workflow state Claude Code already writes for every run
// and reports them — no instrumentation, no extra cost, works retroactively.
//
//   node scripts/run-report.mjs                 # all recorded runs, grouped by feature
//   node scripts/run-report.mjs --since 2026-08-01 --until 2026-08-06   # one version's window
//   node scripts/run-report.mjs --json          # machine-readable, for before/after diffing
//   node scripts/run-report.mjs --snapshot      # persist to evals/results/ (see below)
//   node scripts/run-report.mjs --history       # the trend across saved snapshots
//
// A "feature" is one worktree. Landing a feature normally means TWO stops: the interview + plan gate
// (one sitting), then the report at the end. Everything else is the loop failing to stay dark.
//
// WHY SNAPSHOTS: the source data is Claude Code's local project state, which is periodically swept and
// only exists on this machine. Oldest surviving run as of 2026-08-05 was ~1 month old. Without
// snapshots the history this design is judged by quietly evaporates.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const PROJECTS = path.join(os.homedir(), '.claude/projects')
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RESULTS = path.join(ROOT, 'evals/results')

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const doSnapshot = argv.includes('--snapshot')
const doHistory = argv.includes('--history')
const redact = argv.includes('--redact')
const labelArg = argv.includes('--label') ? argv[argv.indexOf('--label') + 1] : null
const sinceArg = argv[argv.indexOf('--since') + 1]
const since = argv.includes('--since') ? Date.parse(sinceArg) : null
if (since !== null && Number.isNaN(since)) {
  console.error(`--since: could not parse "${sinceArg}" (try 2026-08-01)`)
  process.exit(2)
}
// --until closes the window. Needed to re-measure an OLD version after newer runs have landed: by date
// alone, `--since <old ship date>` now sweeps in everything that came after it.
const untilArg = argv[argv.indexOf('--until') + 1]
const until = argv.includes('--until') ? Date.parse(untilArg) : null
if (until !== null && Number.isNaN(until)) {
  console.error(`--until: could not parse "${untilArg}" (try 2026-08-06)`)
  process.exit(2)
}

// Bumped whenever disposition scoring changes, so --history can refuse to compare across a change
// instead of silently charting two different definitions against each other.
const SCORING = 2

const n = (x) => x.toLocaleString('en-US')

const readVersion = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/masterdevs/.claude-plugin/plugin.json'), 'utf8')).version
  } catch { return 'unknown' }
}
const readCommit = () => {
  try { return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() }
  catch { return null }
}

// ── --history: read saved snapshots, show the trend ─────────────────────────
if (doHistory) {
  let files = []
  try {
    files = fs.readdirSync(RESULTS).filter((f) => f.endsWith('.json')).sort()
  } catch { /* no results dir yet */ }
  if (!files.length) {
    console.log(`\nNo snapshots yet. Take one with:\n  node scripts/run-report.mjs --since <date> --snapshot\n`)
    process.exit(0)
  }
  console.log('\nmasterdevs — trend across snapshots\n')
  console.log('  date        version   window       feats  unplanned/feat  clean   hours    tokens')
  console.log('  ' + '─'.repeat(74))
  let stale = 0
  for (const f of files) {
    let s
    try { s = JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8')) } catch { continue }
    const t = s.totals || {}
    const win = (s.window && s.window.since) ? String(s.window.since).slice(0, 10) : 'all-time'
    const old = (s.scoring || 1) !== SCORING
    if (old) stale++
    console.log(
      `  ${(s.generated || '').slice(0, 10).padEnd(11)} ${String(s.versionAtSnapshot || '?').padEnd(9)} ` +
      `${win.padEnd(12)} ${String(t.features ?? '?').padStart(5)} ` +
      `${String((t.unplannedPerFeature ?? 0).toFixed(1)).padStart(14)} ` +
      `${String(`${t.landedClean ?? 0}/${t.features ?? 0}`).padStart(6)} ` +
      `${String(((t.minutes ?? 0) / 60).toFixed(1)).padStart(7)} ${n(t.tokens ?? 0).padStart(11)}` +
      (old ? '  ⚠ old scoring' : ''))
  }
  console.log('\n  Lower unplanned/feat is the goal. "clean" = features that finished with nothing outstanding.')
  console.log('  Snapshots taken with --since measure one version; without it they are cumulative.')
  if (stale) {
    console.log(`\n  ⚠ ${stale} snapshot(s) use an older scoring definition and are NOT comparable to the`)
    console.log('    rest of this table. Re-take them against the same window to compare:')
    console.log('      node scripts/run-report.mjs --since <start> --until <end> --snapshot --label <what ran>')
  }
  console.log('')
  process.exit(0)
}

// How each run landed on the human.
//
//   designed   the plan gate — the stop the design intends
//   interview  a question asked BEFORE the run went dark — the interview working, not failing
//   clean      finished with nothing outstanding
//   killed     you stopped it; a choice, not a loop failure, so it is counted on its own
//   unplanned  the loop failed to stay dark: a plan conflict, a dead end, or a red verification
//
// This is derived from what actually happened rather than from the outcome label, because the label
// logic has changed (escalations used to force `needs-attention`) and old runs keep whatever label
// they were written with. Deriving keeps the history comparable across plugin versions.
function disposition(outcome, phase, r) {
  if (outcome === 'killed') return 'killed'
  if (outcome === 'blocked' || outcome === 'failed' || outcome === 'error') return 'unplanned'
  if (phase === 'plan') {
    if (outcome === 'awaiting-plan-approval') return 'designed'
    return outcome === 'needs-clarification' ? 'interview' : 'unplanned'
  }
  if (r.conflicts > 0 || r.verifyPassed === false || r.unresolvedBlocking > 0) return 'unplanned'
  return 'clean'
}

function walk(dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.isFile() && e.name.startsWith('wf_') && e.name.endsWith('.json')) out.push(p)
  }
  return out
}

const label = (encoded) => encoded.replace(/^-Users-[^-]+-src-/, '').replace(/^-+/, '')

const runs = []
for (const file of walk(PROJECTS)) {
  let d
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { continue }
  if (d.workflowName !== 'masterdevs-feature-loop') continue
  const when = Date.parse(d.timestamp) || d.startTime || 0
  if (since && when < since) continue
  if (until && when >= until) continue

  let args = d.args
  if (typeof args === 'string') { try { args = JSON.parse(args) } catch { args = {} } }
  const result = (d.result && typeof d.result === 'object') ? d.result : {}
  const outcome = d.status === 'killed' ? 'killed' : (result.outcome || d.status || 'unknown')

  const run = {
    feature: label(path.relative(PROJECTS, file).split(path.sep)[0]),
    runId: d.runId,
    when,
    outcome,
    phase: args?.startFrom === 'implement' ? 'loop' : 'plan',
    interviewed: !!args?.intent,
    minutes: Math.round((d.durationMs || 0) / 60000),
    agents: d.agentCount || 0,
    tokens: d.totalTokens || 0,
    iterations: result.iterations ?? null,
    conflicts: (result.conflicts || []).length,
    escalations: (result.escalations || []).length,
    punted: (result.punted || []).length,
    unresolvedBlocking: (result.unresolvedBlocking || []).length,
    verifyPassed: result.verifyPassed ?? null,   // null on runs that never reached Verify
  }
  run.disposition = disposition(outcome, run.phase, run)
  runs.push(run)
}

runs.sort((a, b) => a.when - b.when)

const features = new Map()
for (const r of runs) {
  if (!features.has(r.feature)) features.set(r.feature, [])
  features.get(r.feature).push(r)
}

const count = (rs, d) => rs.filter((r) => r.disposition === d).length
const summarize = (rs) => ({
  invocations: rs.length,
  designed: count(rs, 'designed'),
  interview: count(rs, 'interview'),
  killed: count(rs, 'killed'),
  unplanned: count(rs, 'unplanned'),
  minutes: rs.reduce((n, r) => n + r.minutes, 0),
  tokens: rs.reduce((n, r) => n + r.tokens, 0),
  agents: rs.reduce((n, r) => n + r.agents, 0),
  landedClean: rs.some((r) => r.disposition === 'clean'),
  interviewed: rs.some((r) => r.interviewed),
})

// Snapshots are committed, so feature names — which are branch names — are redacted to a stable hash
// by default. The same feature keeps the same id across snapshots, so trends stay traceable without
// naming anything. `--full` keeps real names for local use; don't commit that.
const anon = (s) => 'f-' + createHash('sha256').update(s).digest('hex').slice(0, 8)
const nameFor = (f) => (argv.includes('--full') && !redact ? f : anon(f))

const buildPayload = () => {
  const perFeature = [...features].map(([feature, rs]) => {
    const s = summarize(rs)
    return {
      feature: nameFor(feature),
      ...s,
      runs: rs.map((r) => ({
        outcome: r.outcome, disposition: r.disposition, phase: r.phase, interviewed: r.interviewed,
        minutes: r.minutes, agents: r.agents, tokens: r.tokens, iterations: r.iterations,
        conflicts: r.conflicts, escalations: r.escalations, punted: r.punted,
        unresolvedBlocking: r.unresolvedBlocking, verifyPassed: r.verifyPassed,
      })),
    }
  })
  const all = summarize(runs)
  return {
    generated: new Date().toISOString(),
    versionAtSnapshot: readVersion(),   // version installed WHEN SNAPSHOT TAKEN, not the version the runs used — use --label for that
    gitCommit: readCommit(),
    label: labelArg || undefined,
    scoring: SCORING,
    window: {
      since: since ? new Date(since).toISOString() : null,
      until: until ? new Date(until).toISOString() : null,
    },
    redacted: !(argv.includes('--full') && !redact),
    totals: {
      features: features.size,
      invocations: all.invocations,
      designed: all.designed,
      interview: all.interview,
      killed: all.killed,
      unplanned: all.unplanned,
      unplannedPerFeature: features.size ? all.unplanned / features.size : 0,
      interviewPerFeature: features.size ? all.interview / features.size : 0,
      landedClean: [...features.values()].filter((rs) => summarize(rs).landedClean).length,
      minutes: all.minutes,
      tokens: all.tokens,
    },
    features: perFeature,
  }
}

if (asJson) {
  console.log(JSON.stringify(buildPayload(), null, 2))
  process.exit(0)
}

if (doSnapshot) {
  const payload = buildPayload()
  fs.mkdirSync(RESULTS, { recursive: true })
  const stamp = payload.generated.slice(0, 10)
  const slug = [stamp, `v${payload.versionAtSnapshot}`, labelArg].filter(Boolean).join('-')
    .replace(/[^a-zA-Z0-9.-]/g, '-')
  const file = path.join(RESULTS, `${slug}.json`)
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n')
  console.log(`\nSnapshot written: ${path.relative(ROOT, file)}`)
  console.log(`  ${payload.totals.features} feature(s) · ${payload.totals.unplanned} unplanned ` +
    `(${payload.totals.unplannedPerFeature.toFixed(1)}/feature) · ` +
    `${payload.totals.landedClean}/${payload.totals.features} landed clean` +
    `${payload.redacted ? ' · feature names redacted' : ' · NAMES IN CLEAR — do not commit'}`)
  if (!since) console.log('  Window: all-time (cumulative). Use --since to measure one version.')
  console.log('')
  process.exit(0)
}

if (!runs.length) {
  console.log(since ? `No masterdevs runs recorded since ${sinceArg}.` : 'No masterdevs runs recorded yet.')
  process.exit(0)
}

console.log('\nmasterdevs — cost per feature\n')
console.log('  UNPLANNED stops are the number this design tries to drive down: the loop failed to')
console.log('  stay dark. Questions asked during the interview are counted separately — those are')
console.log('  the design working. A clean feature is 1 designed stop and 0 unplanned.\n')

for (const [feature, rs] of features) {
  const s = summarize(rs)
  const hrs = (s.minutes / 60).toFixed(1)
  console.log(`▸ ${feature}`)
  console.log(`  ${s.invocations} invocation(s) · ${s.designed} designed · ` +
    `${s.interview} interview Q · ${s.unplanned} UNPLANNED` +
    `${s.killed ? ` · ${s.killed} killed by you` : ''} · ` +
    `${hrs}h · ${n(s.tokens)} tokens · ${s.agents} agents${s.interviewed ? ' · interviewed' : ''}`)
  for (const r of rs) {
    const mark = { clean: '✓', designed: '•', interview: '?', killed: '⊘' }[r.disposition] || '✗'
    const extra = [
      r.iterations != null ? `${r.iterations} round(s)` : null,
      r.conflicts ? `${r.conflicts} conflict(s)` : null,
      r.escalations ? `${r.escalations} escalation(s)` : null,
      r.punted ? `${r.punted} punted` : null,
    ].filter(Boolean).join(', ')
    console.log(`    ${mark} ${r.outcome.padEnd(22)} ${String(r.minutes).padStart(4)}m  ` +
      `${n(r.tokens).padStart(10)} tok  ${extra}`)
  }
  console.log('')
}

const all = summarize(runs)
const feats = features.size
console.log('─'.repeat(72))
const clean = [...features.values()].filter((rs) => summarize(rs).landedClean).length
console.log(`${feats} feature(s) · ${all.invocations} invocations · ${all.unplanned} unplanned stops ` +
  `(${(all.unplanned / feats).toFixed(1)} per feature) · ${(all.minutes / 60).toFixed(1)}h · ${n(all.tokens)} tokens`)
console.log(`${all.interview} interview question(s) (${(all.interview / feats).toFixed(1)} per feature) · ` +
  `${clean}/${feats} features landed clean` + (all.killed ? ` · ${all.killed} run(s) killed by you` : ''))
const interviewed = [...features.values()].filter((rs) => summarize(rs).interviewed)
if (interviewed.length) {
  const iu = interviewed.reduce((t, rs) => t + summarize(rs).unplanned, 0) / interviewed.length
  const rest = [...features.values()].filter((rs) => !summarize(rs).interviewed)
  const ru = rest.length ? rest.reduce((t, rs) => t + summarize(rs).unplanned, 0) / rest.length : null
  console.log(`interviewed: ${iu.toFixed(1)} unplanned/feature (n=${interviewed.length})` +
    (ru !== null ? `  ·  not interviewed: ${ru.toFixed(1)} (n=${rest.length})` : ''))
}
console.log('')
