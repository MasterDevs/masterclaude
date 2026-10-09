// The one interpretation of a masterdevs run's persisted progress, shared by the CLI
// (scripts/run-status.mjs) and the live status pane (hooks/register.js).
//
// Pure: no filesystem, no clock. Callers pass the parsed workflow record and `now`. It must load in
// Node and in the Mods environment alike, so it imports nothing.
//
// Honesty rules this file exists to keep:
//   - The workflow's own `status` wins over an agent's `state`. A killed run leaves its agents marked
//     `progress` forever; showing them as live would claim work that is not happening.
//   - `resultPreview` is cut at ~400 characters mid-JSON. A field missing from it is UNKNOWN, never
//     empty: "no findings" is only said when the preview literally holds `"findings": []`.
//   - No percent complete. The loop repeats on blocking findings, so a phase count is not a progress
//     bar. The pane's ETA is a range from past runs' real timing (hooks/lib/eta.mjs), not from here.

export const WORKFLOW_NAME = 'masterdevs-feature-loop'

// ── tolerant readers over truncated JSON ───────────────────────────────────
export const str = (s, key) => {
  const m = (s || '').match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`))
  return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').trim() : null
}
export const bool = (s, key) => {
  const m = (s || '').match(new RegExp(`"${key}"\\s*:\\s*(true|false)`))
  return m ? m[1] === 'true' : null
}
export const num = (s, key) => {
  const m = (s || '').match(new RegExp(`"${key}"\\s*:\\s*(-?\\d+)`))
  return m ? m[1] : null
}
// The strings of `"key": [ ... ]`. Anchored on the key's own array: a key holding anything else
// must not borrow the next array in the preview.
export const strings = (s, key) => {
  const head = new RegExp(`"${key}"\\s*:\\s*\\[`).exec(s || '')
  if (!head) return []
  const open = head.index + head[0].length - 1
  const close = s.indexOf(']', open)
  const out = []
  const re = /"((?:[^"\\]|\\.)*)"/g
  re.lastIndex = open
  let m
  while ((m = re.exec(s))) {
    if (close !== -1 && m.index > close) break
    out.push(m[1])
  }
  return out
}
// First object inside an array-of-objects field, as a raw slice (still truncation-safe). Anchored on
// `"key": [ {`, so an empty array never borrows the object of the field after it.
export const firstObject = (s, key) => {
  const m = new RegExp(`"${key}"\\s*:\\s*\\[\\s*\\{`).exec(s || '')
  return m ? s.slice(m.index + m[0].length - 1) : null
}
// True only when the preview literally shows the array as empty: `"key": []`.
const emptyArray = (s, key) => new RegExp(`"${key}"\\s*:\\s*\\[\\s*\\]`).test(s || '')

// ── safe display text ──────────────────────────────────────────────────────
// Everything shown comes from files and tool events an agent influenced, so strip anything a
// terminal would act on (ESC, C0/C1 controls, bidi overrides) before it reaches a drawing or stdout.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g
export const clean = (s) => (s == null ? '' : String(s)).replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim()

export const short = (s, n = 96) => {
  const t = clean(s)
  if (!t) return null
  if (t.length <= n) return t
  const cut = t.slice(0, n - 1).replace(/\s+\S*$/, '')
  return `${cut || t.slice(0, n - 1)}…`
}
// Hard cap to one display line of `width` cells. Unlike `short` it never keeps more than fits.
export const fit = (s, width) => {
  const t = clean(s)
  if (width <= 0) return ''
  return t.length <= width ? t : `${t.slice(0, Math.max(0, width - 1))}…`
}
export const base = (p) => clean((p || '').split(/[\\/]/).filter(Boolean).slice(-1)[0])

// ── durations ──────────────────────────────────────────────────────────────
export const mins = (ms) => Math.max(0, Math.round(ms / 60000))
export const duration = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}
const finiteTime = (v) => (Number.isFinite(v) && v > 0 ? v : null)

// ── lifecycle ──────────────────────────────────────────────────────────────
const RUNNING = new Set(['running', 'in_progress'])
export const isRunning = (d) => RUNNING.has(d?.status)

// The process status says whether anything still runs; `result.outcome` says what a finished run
// asks of you. They are different questions and a pane that merges them misleads.
const OUTCOME_TEXT = {
  'awaiting-plan-approval': 'plan ready — waiting for your approval',
  'needs-clarification': 'stopped — needs your answers before planning',
  blocked: 'BLOCKED — an agent hit a dead end',
  error: 'stopped on an error',
  'needs-attention': 'finished — needs your attention',
  passed: 'finished — verification passed',
}
export function lifecycle(d) {
  const status = typeof d?.status === 'string' ? d.status : 'unknown'
  if (RUNNING.has(status)) return { status: 'running', text: 'running', terminal: false }
  const outcome = d?.result && typeof d.result === 'object' ? d.result.outcome : undefined
  if (status === 'killed') return { status, outcome, text: 'stopped (killed)', terminal: true }
  if (status === 'failed') return { status, outcome, text: 'failed', terminal: true }
  if (status === 'completed') {
    return { status, outcome, terminal: true,
      text: OUTCOME_TEXT[outcome] || (outcome ? `finished — ${clean(outcome)}` : 'finished — outcome not recorded') }
  }
  return { status, outcome, text: `status ${clean(status)}`, terminal: true }
}

// Elapsed run time. A finished run freezes at its recorded duration; one with no usable start time is
// unknown rather than "0m".
export function runElapsed(d, now) {
  const start = finiteTime(d?.startTime)
  if (!isRunning(d)) {
    if (Number.isFinite(d?.durationMs) && d.durationMs >= 0) return { ms: d.durationMs, frozen: true }
    return { ms: null, frozen: true }
  }
  return start ? { ms: Math.max(0, now - start), frozen: false } : { ms: null, frozen: false }
}

// ── agents ─────────────────────────────────────────────────────────────────
// The harness appends " (retry N)" when it restarts an agent.
export const baseLabel = (label) => (label || '').replace(/\s*\(retry \d+\)\s*$/, '')

export function roleOf(label) {
  const L = baseLabel(label)
  if (L.startsWith('verify-plan')) return 'PLAN CHECK'
  if (L.startsWith('verify')) return 'VERIFIER'
  if (L.startsWith('review')) return 'REVIEWER'
  if (L.startsWith('implement') || L === 'polish') return 'ENGINEER'
  if (L.startsWith('refactor')) return 'REFACTORER'
  if (L.startsWith('iterate')) return 'TRIAGE'
  if (L === 'refine') return 'REFINER'
  if (L === 'plan' || L === 'plan:revised') return 'ARCHITECT'
  if (L === 'check-criteria') return 'CRITERIA CHECK'
  return 'AGENT'
}

export const agentsOf = (d) =>
  (Array.isArray(d?.workflowProgress) ? d.workflowProgress : [])
    .filter((x) => x && x.type !== 'workflow_phase' && typeof x.label === 'string')

export const phasesOf = (d) =>
  (Array.isArray(d?.workflowProgress) ? d.workflowProgress : [])
    .filter((x) => x && x.type === 'workflow_phase' && typeof x.title === 'string')

// An agent is live only while BOTH it and its workflow say so.
export const liveAgents = (d) => (isRunning(d) ? agentsOf(d).filter((a) => a.state === 'progress') : [])

// Stable identity per execution: a retry is a new execution even under the same label.
export const agentKey = (a) => clean(a.agentId) || `${baseLabel(a.label)}#${a.attempt || 1}#${a.index ?? ''}`

export function agentElapsed(a, d, now) {
  const start = finiteTime(a.startedAt)
  if (!start) return null
  if (a.state === 'progress' && isRunning(d)) return Math.max(0, now - start)
  if (Number.isFinite(a.durationMs) && a.durationMs >= 0) return a.durationMs
  return null
}

// ── what a finished agent actually found ───────────────────────────────────
// Phrased for someone deciding whether to interrupt, not for a log. Returns null when the preview
// does not support any claim — the caller says nothing rather than something optimistic.
export function headline(a) {
  const p = a.resultPreview || ''
  const L = baseLabel(a.label)

  // MUST precede the `verify` branch: 'verify-plan:1' also startsWith('verify').
  if (L.startsWith('verify-plan')) {
    const verdicts = p.match(/"verdict"\s*:\s*"(\w+)"/g) || []
    const refuted = verdicts.filter((r) => r.includes('refuted')).length
    if (refuted) return `${refuted} plan claim(s) REFUTED — plan being revised`
    // A truncated preview may hold only some verdicts; count what is visible and say so.
    if (verdicts.length) return `plan claims seen so far check out (${verdicts.length} visible)`
    const first = firstObject(p, 'results')
    return first ? `checking plan claim: ${short(str(first, 'claim'), 80)}` : 'fact-checking the plan'
  }
  if (L.startsWith('verify')) {
    const passed = bool(p, 'passed')
    const fails = strings(p, 'failures').filter(Boolean)
    const imp = firstObject(p, 'impossible')
    if (imp && str(imp, 'why')) return `verification says a criterion CANNOT be met: ${short(str(imp, 'why'), 90)}`
    if (passed === true) return 'verification passed'
    if (fails.length) return `verification failing: ${short(fails[0], 90)}`
    return passed === false ? 'verification failed' : null
  }
  if (L.startsWith('review')) {
    if (emptyArray(p, 'findings')) return 'review found nothing'
    const f = firstObject(p, 'findings')
    if (!f) return null
    const sev = str(f, 'severity'), file = base(str(f, 'file')), line = num(f, 'line')
    const sum = short(str(f, 'summary'), 90)
    if (!sev && !sum) return 'review reported findings (details cut off)'
    return `review — ${clean(sev) || 'finding'}${file ? ` in ${file}${line ? `:${line}` : ''}` : ''}${sum ? `: ${sum}` : ''}`
  }
  if (L.startsWith('implement') || L === 'polish') {
    const files = strings(p, 'changedFiles').map(base).filter(Boolean)
    const st = str(p, 'status')
    if (st === 'blocked') return `BLOCKED: ${short(str(p, 'notes'), 90) || 'no reason recorded'}`
    if (files.length) return `touched ${files.length}${p.length >= 380 ? '+' : ''} file(s): ${files.slice(0, 3).join(', ')}${files.length > 3 ? '…' : ''}`
    return short(str(p, 'notes'), 90)
  }
  if (L.startsWith('refactor')) {
    const applied = strings(p, 'applied').filter(Boolean)
    if (applied.length) return `refactored: ${short(applied[0], 80)}${applied.length > 1 ? ` (+${applied.length - 1} more)` : ''}`
    return emptyArray(p, 'applied') ? 'refactor: nothing worth changing' : null
  }
  if (L.startsWith('iterate')) {
    const dec = str(p, 'decision')
    const must = strings(p, 'mustFix').filter(Boolean)
    const conflicts = firstObject(p, 'conflicts')
    if (conflicts && str(conflicts, 'finding')) return `PLAN CONFLICT — ${short(str(conflicts, 'finding'), 85)}`
    if (must.length) return `another round for: ${short(must[0], 85)}`
    return dec ? `decided to ${clean(dec)}` : null
  }
  if (L === 'refine') return short(str(p, 'requirements'), 105)
  if (L === 'plan' || L === 'plan:revised') return short(str(p, 'summary'), 105)
  if (L === 'check-criteria') {
    if (emptyArray(p, 'issues')) return 'success criteria check out'
    const i = firstObject(p, 'issues')
    return i && str(i, 'problem') ? `criteria problem (${clean(str(i, 'kind'))}): ${short(str(i, 'problem'), 80)}` : null
  }
  return null
}

// What a live agent last reached for, from metadata alone. "last", because it is one sample.
export const DOING = {
  Bash: 'running commands', Read: 'reading code', Grep: 'searching the codebase',
  Glob: 'searching the codebase', Edit: 'editing code', Write: 'writing code',
  StructuredOutput: 'writing up its result', WebFetch: 'fetching docs', Task: 'delegating', Agent: 'delegating',
}
export const doing = (tool) => DOING[tool] || (tool ? `using ${clean(tool)}` : 'starting up')

// ── what may come next ─────────────────────────────────────────────────────
// The feature loop's shape: Refine → Plan → (you approve) → Implement → Refactor → Verify ∥ Review →
// Iterate, repeated only while blocking findings remain, then Polish only if anything was deferred.
// Possible, not promised: the stages carry no times (the pane's estimate lives in eta.mjs).
const ORDER = ['Refine', 'Plan', 'Implement', 'Refactor', 'Verify', 'Review', 'Iterate', 'Polish']
export function nextStages(d, phase) {
  const lc = lifecycle(d)
  if (lc.terminal) {
    if (lc.outcome === 'awaiting-plan-approval') return ['your approval', 'Implement', 'Refactor', 'Verify ∥ Review', 'Iterate', 'Polish (if needed)']
    if (lc.outcome === 'needs-clarification') return ['your answers', 'Plan']
    return []
  }
  const at = ORDER.indexOf(phase)
  if (at === -1) return []
  if (phase === 'Refine') return ['Plan', 'your approval']
  if (phase === 'Plan') return ['your approval']
  if (phase === 'Polish') return []
  const rest = []
  if (at < ORDER.indexOf('Refactor')) rest.push('Refactor')
  if (at < ORDER.indexOf('Verify')) rest.push('Verify ∥ Review')
  if (at < ORDER.indexOf('Iterate')) rest.push('Iterate')
  rest.push('another round (only if blocking findings)', 'Polish (if needed)')
  return rest
}

// ── the model both views draw from ─────────────────────────────────────────
export function summarize(d, now) {
  const agents = agentsOf(d)
  const live = liveAgents(d)
  const phases = phasesOf(d)
  const finished = agents.filter((a) => a.state === 'done' && a.resultPreview)
  const last = finished[finished.length - 1] || null
  // Every phase is declared when the script starts, so the last DECLARED phase is always Polish. The
  // phase is where the newest agent ran.
  const phase = clean(live[0]?.phaseTitle || agents[agents.length - 1]?.phaseTitle || phases[0]?.title) || null
  const lc = lifecycle(d)
  const elapsed = runElapsed(d, now)
  // How old the newest recorded progress is. Independent of when we last redrew: a pane that
  // refreshes every five seconds must not make a frozen source look fresh.
  const progressTimes = agents.map((a) => finiteTime(a.lastProgressAt)).filter(Boolean)
  const lastProgressAt = progressTimes.length ? Math.max(...progressTimes) : null
  return {
    runId: clean(d?.runId) || null,
    // Set when a resume brought an ended run back to life under the same id.
    resumedAfter: finiteTime(d?.resumedAfter),
    lifecycle: lc,
    phase,
    elapsed,
    lastProgressAt,
    sourceAgeMs: lastProgressAt ? Math.max(0, now - lastProgressAt) : null,
    agentCount: agents.length,
    live: live.map((a) => ({
      key: agentKey(a),
      agentId: clean(a.agentId) || null,
      label: clean(baseLabel(a.label)),
      retry: /\(retry \d+\)\s*$/.test(a.label),
      role: roleOf(a.label),
      phaseTitle: clean(a.phaseTitle) || null,
      elapsedMs: agentElapsed(a, d, now),
      toolCalls: Number.isFinite(a.toolCalls) ? a.toolCalls : null,
      lastToolName: clean(a.lastToolName) || null,
      lastProgressAt: finiteTime(a.lastProgressAt),
    })),
    lastFinished: last ? {
      key: agentKey(last), agentId: clean(last.agentId) || null, label: clean(baseLabel(last.label)), role: roleOf(last.label),
      elapsedMs: agentElapsed(last, d, now), headline: headline(last),
    } : null,
    next: nextStages(d, phase),
  }
}

// ── CLI lines ──────────────────────────────────────────────────────────────
// The 5-minute heartbeat's two lines. Kept byte-compatible with what the feature skill documents.
export function statusLines(d, now, clockText) {
  const m = summarize(d, now)
  const stateWord = m.lifecycle.status === 'running' ? '' : ` [${m.lifecycle.status}]`
  const total = m.elapsed.ms == null ? 'total unknown' : `${mins(m.elapsed.ms)}m total`
  const phase = m.phase || '—'
  let line1
  if (m.live.length) {
    const a = m.live[0]
    const forMin = a.elapsedMs == null ? '?' : mins(a.elapsedMs)
    const stalledFor = a.lastProgressAt ? mins(now - a.lastProgressAt) : 0
    const stall = stalledFor >= 10 ? `  ⚠ no progress for ${stalledFor}m` : ''
    // A live run's journal records no tool use: say "working", not "starting up", for an agent whose
    // tool count is unknown rather than zero.
    const what = a.lastToolName || a.toolCalls != null ? doing(a.lastToolName) : 'working'
    line1 = `⏳ ${clockText}${stateWord} · ${phase} · ${a.label} ${what}` +
      `${a.toolCalls ? ` (${a.toolCalls} steps, ${forMin}m)` : ` ${forMin}m`}` +
      ` · ${total}${stall}` +
      `${m.live.length > 1 ? ` · +${m.live.length - 1} running alongside` : ''}`
  } else {
    line1 = `⏳ ${clockText}${stateWord} · ${phase} · ${m.agentCount} agent(s) done · ${total}`
  }
  const out = [line1]
  if (m.lastFinished?.headline) out.push(`   ${m.lastFinished.label} → ${m.lastFinished.headline}`)
  return out
}

// ── choosing a run ─────────────────────────────────────────────────────────
// Among records the caller already scoped (to one session, or explicitly to every session for the
// CLI): masterdevs runs only, an explicit run id when given, a running one before a finished one,
// then the newest.
export function selectRun(records, { runId = null } = {}) {
  let best = null
  for (const d of records) {
    if (!d || d.workflowName !== WORKFLOW_NAME) continue
    if (runId && d.runId !== runId) continue
    const running = isRunning(d)
    const started = finiteTime(d.startTime) || 0
    if (!best || (running && !best.running) || (running === best.running && started > best.started)) {
      best = { d, running, started }
    }
  }
  return best ? best.d : null
}

// The planning call and the build call are separate workflow invocations. They belong to one feature
// only when they wrote to the same run directory — never by being close in time.
export function relatedRuns(records, d) {
  const dir = d?.args?.runDir
  if (!dir) return []
  return records.filter((x) => x && x !== d && x.workflowName === WORKFLOW_NAME && x.args?.runDir === dir)
}

// What one refresh found, as the pane stores it. `found` is locateSessionDir's answer; `records` and
// `problems` are readSessionRuns' (empty when there is no directory to read).
export function viewFor({ found, records = [], problems = [], now }) {
  if (!found?.dir) return { kind: 'none', reason: found?.reason, now }
  const d = selectRun(records)
  if (!d) {
    return problems.length
      ? { kind: 'unavailable', reason: problems[0], now }
      : { kind: 'none', reason: 'Start one with /masterdevs:feature.', now }
  }
  return { kind: 'run', model: summarize(d, now), now, stale: Boolean(d.stale), problem: problems[0] || null }
}
