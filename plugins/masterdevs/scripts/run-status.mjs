#!/usr/bin/env node
// One or two lines saying what the run is ACTUALLY doing right now.
//
//   node run-status.mjs                 # newest running masterdevs workflow
//   node run-status.mjs <runId>         # a specific run
//
// A status line exists so you can intervene when something looks wrong. "Verify (iteration 2/3) · 3
// agents · 11 min" cannot support that: it says the machine is busy, not what it is busy doing. This
// reads the per-agent state Claude Code already writes — which agent is live, what tool it last
// reached for, and what the previously finished agent actually returned — and reports the one or two
// things worth knowing.
//
// The agent state includes a `resultPreview`, truncated at ~400 characters mid-JSON, so everything
// here parses tolerantly by pattern. It never throws and never blocks: no signal prints as "starting
// up", which is itself information.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const wanted = process.argv.slice(2).find((a) => !a.startsWith('-')) || null
const PROJECTS = path.join(os.homedir(), '.claude/projects')

const walk = (dir, out = []) => {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.isFile() && e.name.startsWith('wf_') && e.name.endsWith('.json')) out.push(p)
  }
  return out
}

// Newest masterdevs run — preferring one that is still going, since that is what a status line is for.
let best = null
for (const file of walk(PROJECTS)) {
  let d
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { continue }
  if (d.workflowName !== 'masterdevs-feature-loop') continue
  if (wanted && d.runId !== wanted) continue
  const running = d.status === 'running' || d.status === 'in_progress'
  const started = d.startTime || 0
  if (!best) { best = { d, running, started }; continue }
  if (running !== best.running) { if (running) best = { d, running, started }; continue }
  if (started > best.started) best = { d, running, started }
}

if (!best) {
  console.log(wanted ? `No masterdevs run found with id ${wanted}.` : 'No masterdevs runs recorded.')
  process.exit(0)
}

const d = best.d
const agents = (d.workflowProgress || []).filter((x) => x && x.label)
const phases = (d.workflowProgress || []).filter((x) => x && x.type === 'workflow_phase')

const now = Date.now()
const mins = (ms) => Math.max(0, Math.round(ms / 60000))
const clock = new Date().toLocaleTimeString('en-US',
  { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })

// ── tolerant readers over truncated JSON ───────────────────────────────────
const str = (s, key) => {
  const m = (s || '').match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`))
  return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').trim() : null
}
const bool = (s, key) => {
  const m = (s || '').match(new RegExp(`"${key}"\\s*:\\s*(true|false)`))
  return m ? m[1] === 'true' : null
}
const num = (s, key) => {
  const m = (s || '').match(new RegExp(`"${key}"\\s*:\\s*(-?\\d+)`))
  return m ? m[1] : null
}
const strings = (s, key) => {
  const at = (s || '').indexOf(`"${key}"`)
  if (at === -1) return []
  const open = s.indexOf('[', at)
  if (open === -1) return []
  const out = []
  const re = /"((?:[^"\\]|\\.)*)"/g
  re.lastIndex = open
  let m
  while ((m = re.exec(s))) {
    const close = s.indexOf(']', open)
    if (close !== -1 && m.index > close) break
    out.push(m[1])
  }
  return out
}
// First object inside an array-of-objects field, as a raw slice (still truncation-safe).
const firstObject = (s, key) => {
  const at = (s || '').indexOf(`"${key}"`)
  if (at === -1) return null
  const open = s.indexOf('{', at)
  return open === -1 ? null : s.slice(open)
}
const short = (s, n = 96) => {
  if (!s) return null
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t
}
const base = (p) => (p || '').split('/').filter(Boolean).slice(-1)[0]

// ── what a finished agent actually found ───────────────────────────────────
// Phrased for someone deciding whether to interrupt, not for a log.
function headline(a) {
  const p = a.resultPreview || ''
  // The harness appends " (retry N)" when it restarts an agent; strip it so retried agents are still
  // recognised. Without this, exactly the runs most worth watching report nothing.
  const L = a.label.replace(/\s*\(retry \d+\)\s*$/, '')

  // MUST precede the `verify` branch: 'verify-plan:1' also startsWith('verify').
  if (L.startsWith('verify-plan')) {
    const verdicts = p.match(/"verdict"\s*:\s*"(\w+)"/g) || []
    const refuted = verdicts.filter((r) => r.includes('refuted')).length
    if (refuted) return `${refuted} plan claim(s) REFUTED — plan being revised`
    if (verdicts.length) return `plan claims check out (${verdicts.length} verified)`
    // Claim text is long, so a 400-char preview often truncates before any verdict. Report what is
    // being checked rather than implying a clean result nobody can see.
    const first = firstObject(p, 'results')
    return first ? `checking plan claim: ${short(str(first, 'claim'), 80)}` : `fact-checking the plan`
  }
  if (L.startsWith('verify')) {
    const passed = bool(p, 'passed')
    const fails = strings(p, 'failures').filter(Boolean)
    const imp = firstObject(p, 'impossible')
    if (imp) return `verification says a criterion CANNOT be met: ${short(str(imp, 'why'), 90)}`
    if (passed === true) return `verification passed`
    if (fails.length) return `verification failing: ${short(fails[0], 90)}`
    return passed === false ? `verification failed` : null
  }
  if (L.startsWith('review')) {
    const f = firstObject(p, 'findings')
    if (!f) return `review found nothing`
    const sev = str(f, 'severity'), file = base(str(f, 'file')), line = num(f, 'line')
    const sum = short(str(f, 'summary'), 90)
    return `review — ${sev || 'finding'}${file ? ` in ${file}${line ? `:${line}` : ''}` : ''}: ${sum}`
  }
  if (L.startsWith('implement') || L === 'polish') {
    const files = strings(p, 'changedFiles').map(base).filter(Boolean)
    const st = str(p, 'status')
    if (st === 'blocked') return `BLOCKED: ${short(str(p, 'notes'), 90)}`
    if (files.length) return `touched ${files.length} file(s): ${files.slice(0, 3).join(', ')}${files.length > 3 ? '…' : ''}`
    return short(str(p, 'notes'), 90)
  }
  if (L.startsWith('refactor')) {
    const applied = strings(p, 'applied').filter(Boolean)
    if (applied.length) return `refactored: ${short(applied[0], 80)}${applied.length > 1 ? ` (+${applied.length - 1} more)` : ''}`
    return `refactor: nothing worth changing`
  }
  if (L.startsWith('iterate')) {
    const dec = str(p, 'decision')
    const must = strings(p, 'mustFix').filter(Boolean)
    const conflicts = firstObject(p, 'conflicts')
    if (conflicts) return `PLAN CONFLICT — ${short(str(conflicts, 'finding'), 85)}`
    if (must.length) return `another round for: ${short(must[0], 85)}`
    return dec ? `decided to ${dec}` : null
  }
  if (L === 'refine') return short(str(p, 'requirements'), 105)
  if (L === 'plan' || L === 'plan:revised') return short(str(p, 'summary'), 105)
  if (L === 'check-criteria') {
    const i = firstObject(p, 'issues')
    return i ? `criteria problem (${str(i, 'kind')}): ${short(str(i, 'problem'), 80)}` : `success criteria check out`
  }
  return null
}

// What a live agent is doing, from the tool it last reached for.
const DOING = {
  Bash: 'running commands', Read: 'reading code', Grep: 'searching the codebase',
  Glob: 'searching the codebase', Edit: 'editing code', Write: 'writing code',
  StructuredOutput: 'writing up its result', WebFetch: 'fetching docs', Task: 'delegating',
}

// ── assemble ───────────────────────────────────────────────────────────────
const live = agents.filter((a) => a.state === 'progress')
const finished = agents.filter((a) => a.state === 'done' && a.resultPreview)
const last = finished[finished.length - 1]
const phase = live[0]?.phaseTitle || phases[phases.length - 1]?.title || '—'
const elapsed = mins(now - (d.startTime || now))
const stateWord = d.status === 'running' ? '' : ` [${d.status}]`

let line1
if (live.length) {
  const a = live[0]
  const doing = DOING[a.lastToolName] || (a.lastToolName ? `using ${a.lastToolName}` : 'starting up')
  const forMin = mins(now - (a.startedAt || now))
  const stalledFor = mins(now - (a.lastProgressAt || now))
  const stall = stalledFor >= 10 ? `  ⚠ no progress for ${stalledFor}m` : ''
  line1 = `⏳ ${clock}${stateWord} · ${phase} · ${a.label} ${doing}` +
    `${a.toolCalls ? ` (${a.toolCalls} steps` : ''}${a.toolCalls ? `, ${forMin}m)` : ` ${forMin}m`}` +
    ` · ${elapsed}m total${stall}` +
    `${live.length > 1 ? ` · +${live.length - 1} running alongside` : ''}`
} else {
  line1 = `⏳ ${clock}${stateWord} · ${phase} · ${agents.length} agent(s) done · ${elapsed}m total`
}

console.log(line1)
const found = last ? headline(last) : null
if (found) console.log(`   ${last.label} → ${found}`)
