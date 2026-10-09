// An estimated finish time for a live run, from how long this machine's PAST runs took to finish from
// the same point. Pure: register.js keeps the history and hands it in.
//
// The loop's length is not fixed (a second round runs only on blocking findings), so no single number
// is honest. What is honest: "past runs that reached this phase finished a median of X later, most
// between L and H". So an estimate is a range from real runs, shown with how many it rests on, and
// there is none at all below MIN_RUNS. A run already past the usual finish says so instead of
// inventing a new time.
//
// A past run is kept as timing only — { runId, kind, end, phases: { Title: firstStartMs } } — never its
// labels, results or brief. Reading other sessions' records for this is the one place the pane looks
// outside its own session, and it takes nothing from them that could be shown.

import { agentsOf, lifecycle } from './run-status.mjs'
import { slim } from './run-source.mjs'

export const MIN_RUNS = 3
export const MAX_RUNS = 60

// The feature skill calls the loop twice: Refine → Plan stops for approval ('plan'), then the build
// ('build'). Their lengths differ by an order of magnitude, so each is estimated only from its own kind.
export function kindOf(d) {
  const labels = agentsOf(d).map((a) => String(a.label || ''))
  if (labels.includes('refine')) return 'plan'
  if (labels.some((l) => /^implement:\d+$/.test(l))) return 'build'
  return null
}

const time = (v) => (Number.isFinite(v) && v > 0 ? v : null)

// Where each phase first began: the earliest start among its agents.
export function phaseStarts(d) {
  const out = {}
  for (const a of agentsOf(d)) {
    const at = time(a.startedAt)
    const p = typeof a.phaseTitle === 'string' ? a.phaseTitle : null
    if (!at || !p) continue
    if (out[p] == null || at < out[p]) out[p] = at
  }
  return out
}

// A finished run worth learning from: it ran to its normal end (not killed, failed, or stopped early).
// Runs that stopped early (a question for the user, a dead end) would pull the estimate short.
const USABLE = new Set(['awaiting-plan-approval', 'passed', 'needs-attention'])
export function runSpans(d) {
  if (!d || d.workflowName !== 'masterdevs-feature-loop' || d.status !== 'completed') return null
  const outcome = lifecycle(d).outcome
  if (!USABLE.has(outcome)) return null
  const start = time(d.startTime)
  const end = start && Number.isFinite(d.durationMs) ? start + d.durationMs : null
  const kind = kindOf(d)
  if (!end || !kind || typeof d.runId !== 'string') return null
  const phases = phaseStarts(d)
  if (!Object.keys(phases).length) return null
  return { runId: d.runId, kind, end, phases }
}

// Adds runs to the history, newest kept, one entry per run id.
export function addRuns(history, spans, cap = MAX_RUNS) {
  const byId = new Map((Array.isArray(history) ? history : []).map((h) => [h.runId, h]))
  for (const s of spans) if (s) byId.set(s.runId, s)
  return [...byId.values()].sort((a, b) => b.end - a.end).slice(0, cap)
}

// Seeds the history from past runs on this machine: the newest finished records across all projects,
// read for timing only. Bounded in listings, reads and bytes; run in the background, about once a day.
// `skip` holds run ids already in the history, so a rescan reads only what is new.
const WF_FILE = /^wf_[A-Za-z0-9-]{1,64}\.json$/
export async function scanPastRuns(fsx, projectsDir, { skip = new Set(), maxLists = 400, maxReads = 40, maxBytes = 1_000_000 } = {}) {
  let lists = 0
  const ls = async (dir) => {
    if (lists >= maxLists) return []
    lists++
    try { return await fsx.list(dir) } catch { return [] }
  }
  const files = []
  // A project directory changes when a session starts in it, so the newest come first.
  const projects = (await ls(projectsDir)).filter((e) => e.kind === 'dir').sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0))
  for (const p of projects) {
    for (const session of await ls(`${projectsDir}/${p.name}`)) {
      if (session.kind !== 'dir') continue
      const dir = `${projectsDir}/${p.name}/${session.name}/workflows`
      for (const f of await ls(dir)) {
        if (f.kind !== 'file' || !WF_FILE.test(f.name) || f.size > maxBytes) continue
        if (!skip.has(f.name.slice(0, -'.json'.length))) files.push({ path: `${dir}/${f.name}`, mtimeMs: f.mtimeMs || 0 })
      }
    }
  }
  const spans = []
  for (const f of files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, maxReads)) {
    try { spans.push(runSpans(slim(JSON.parse(await fsx.read(f.path))))) } catch { /* half-written or unreadable: skip */ }
  }
  return spans.filter(Boolean)
}

// Nearest-rank quantile. The range's ends round outward, so with few runs it stays wide, not falsely tight.
const rank = (sorted, q, round = Math.round) => sorted[Math.min(sorted.length - 1, Math.max(0, round(q * (sorted.length - 1))))]

// → null for a run that is not live; otherwise
//   { kind, n, at, lo, hi, overdue }  with at/lo/hi epoch ms, or
//   { kind, n, at: null, reason }     when there is nothing honest to say.
export function estimate(history, d, now) {
  if (!d || lifecycle(d).terminal) return null
  const kind = kindOf(d)
  const starts = phaseStarts(d)
  const live = agentsOf(d).filter((a) => a.state === 'progress')
  const phase = live[0]?.phaseTitle || agentsOf(d).at(-1)?.phaseTitle || null
  const from = phase ? starts[phase] : null
  if (!kind || !from) return { kind, n: 0, at: null, reason: 'phase start unknown' }
  const spans = (Array.isArray(history) ? history : [])
    .filter((h) => h.kind === kind && Number.isFinite(h.phases?.[phase]) && h.end > h.phases[phase])
    .map((h) => h.end - h.phases[phase])
    .sort((a, b) => a - b)
  if (spans.length < MIN_RUNS) return { kind, n: spans.length, at: null, reason: 'too few timed past runs' }
  const at = from + rank(spans, 0.5)
  const lo = from + rank(spans, 0.25, Math.floor)
  const hi = from + rank(spans, 0.75, Math.ceil)
  return { kind, n: spans.length, at, lo, hi, overdue: now > hi }
}

// The pane's ETA fact, in the viewer's local time. `clock` formats epoch ms (injected for tests).
export const localClock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export function etaText(eta, now, clock = localClock) {
  if (!eta) return null
  const what = eta.kind === 'plan' ? 'plan ready' : 'ETA'
  if (eta.at == null) return `${what} unknown — ${eta.n < MIN_RUNS && eta.reason !== 'phase start unknown' ? `needs ${MIN_RUNS} timed past runs, has ${eta.n}` : eta.reason}`
  if (eta.overdue) return `running past the usual finish (most past runs done by ${clock(eta.hi)})`
  const at = eta.at < now ? `by ${clock(eta.hi)}` : `~${clock(eta.at)}`
  return `${what} ${at} (${clock(eta.lo)}–${clock(eta.hi)}, from ${eta.n} past runs)`
}
