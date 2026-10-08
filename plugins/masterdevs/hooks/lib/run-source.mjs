// Finds and reads THIS session's masterdevs workflow records — never another session's.
//
// Claude Code persists each workflow as <config>/projects/<project>/<sessionId>/workflows/wf_*.json.
// The CLI's old selector walked every project and took the newest running run anywhere, which is fine
// for a human who passes a run id and wrong for a pane that opens by itself: with two sessions running
// features, each would show the other's run. So this module is scoped by session id from the start:
//   - locating the session directory only tests for a directory NAMED by this session's id; it never
//     opens another session's files to decide anything;
//   - reading touches only wf_*.json under that one directory.
//
// The filesystem is injected (`fsx`: { list, read, exists }) so the same code runs over the Mods
// `$.fs` noun in the pane and over plain fixtures in scripts/run-status-scenarios.mjs. Every failure —
// missing, denied, oversized, half-written — becomes data the caller can show, never a throw.

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/
const WF_FILE = /^wf_[A-Za-z0-9-]{1,64}\.json$/

// Claude names a project directory after its path, every character outside [A-Za-z0-9] made '-'.
export const projectSlug = (dir) => (dir || '').replace(/[^A-Za-z0-9]/g, '-')

const join = (...parts) => parts.join('/').replace(/\/+/g, '/')

// Returns { dir } or { dir: null, reason }.
//
// Best: `transcriptPath`, which Claude hands its SessionStart hook. The session's directory sits beside
// its transcript (<project>/<sessionId>.jsonl → <project>/<sessionId>/), so nothing is searched. It is
// trusted only when its file name is this session's id.
//
// Otherwise `candidates` (directories the session ran in) name likely project directories. Last, a
// scan lists the projects directory one level deep — bounded by `maxProjects` — and asks each only
// whether a `<sessionId>` directory exists inside it. That finds a session whose project directory
// no longer matches where it runs (it moved with /cd); the caller decides how often to pay for it.
export async function locateSessionDir(fsx, { projectsDir, sessionId, transcriptPath = null, candidates = [], scan = true, maxProjects = 2000 }) {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return { dir: null, reason: 'session identity unavailable' }
  const none = { dir: null, reason: 'no workflow recorded in this session yet' }
  if (typeof transcriptPath === 'string' && transcriptPath.endsWith(`/${sessionId}.jsonl`)) {
    const dir = transcriptPath.slice(0, -'.jsonl'.length)
    return (await fsx.exists(dir).catch(() => false)) ? { dir } : none
  }
  if (!projectsDir) return { dir: null, reason: 'Claude config directory unknown' }
  for (const c of [...new Set(candidates.filter(Boolean).map(projectSlug))]) {
    const dir = join(projectsDir, c, sessionId)
    if (await fsx.exists(dir).catch(() => false)) return { dir }
  }
  if (!scan) return none
  let entries
  try { entries = await fsx.list(projectsDir) } catch { return { dir: null, reason: 'projects directory unreadable' } }
  let seen = 0
  for (const e of entries) {
    if (e.kind !== 'dir') continue
    if (++seen > maxProjects) break
    const dir = join(projectsDir, e.name, sessionId)
    if (await fsx.exists(dir).catch(() => false)) return { dir }
  }
  return none
}

// Keep what the status model reads; drop the rest (the workflow script, the brief) so a record held
// between polls stays small.
const AGENT_KEYS = ['type', 'index', 'label', 'phaseIndex', 'phaseTitle', 'agentId', 'state', 'attempt',
  'startedAt', 'durationMs', 'lastProgressAt', 'lastToolName', 'toolCalls', 'resultPreview', 'title']
// Not lastToolSummary: it can hold the raw command an agent ran, and nothing here may show that.
export function slim(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]))
  return {
    workflowName: d.workflowName,
    runId: d.runId,
    status: d.status,
    startTime: d.startTime,
    durationMs: d.durationMs,
    result: d.result && typeof d.result === 'object' ? { outcome: d.result.outcome } : null,
    args: d.args && typeof d.args === 'object' ? { runDir: typeof d.args.runDir === 'string' ? d.args.runDir : undefined } : {},
    workflowProgress: Array.isArray(d.workflowProgress)
      ? d.workflowProgress.filter((x) => x && typeof x === 'object').slice(0, 400).map((x) => pick(x, AGENT_KEYS))
      : [],
  }
}

// A run's live journal, while the run is going. Claude writes the full record (workflows/wf_*.json)
// only once a workflow ENDS; until then all there is lives in subagents/workflows/<runId>/: a
// journal.jsonl of agent events (started, result, failed — no times, no workflow name) and, per agent,
// agent-<id>.meta.json (written as it starts) and agent-<id>.jsonl (its transcript, appended as it
// works). Times come from those files' mtimes.
//
// The journal does not name its workflow. `known` holds the run ids this session saw launched as the
// masterdevs feature loop (the Workflow tool's own result says so). Without that — the pane loaded
// after the launch — a run counts as masterdevs only when its first agent is one the loop starts
// with, and the record says it was inferred.
const FIRST_LABELS = new Set(['refine', 'load-approved', 'roster', 'implement:1'])
const RUN_DIR = /^wf_[A-Za-z0-9-]{1,64}$/

// `resumedAfter`: the time of the run's earlier final record, when this journal continues a run that
// had ended (a resume keeps the run id and appends to the same journal). Time is counted from the
// resume, not from the first attempt.
export function journalRecord(runId, text, files, { known = false, resumedAfter = null } = {}) {
  const events = []
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue
    try { events.push(JSON.parse(line)) } catch { /* the line being written; the next poll has it */ }
  }
  const agents = new Map()
  for (const ev of events) {
    if (!ev || typeof ev.agentId !== 'string') continue
    if (ev.type === 'started') {
      agents.set(ev.agentId, { type: 'workflow_agent', index: agents.size + 1, label: String(ev.label || 'agent'),
        phaseTitle: typeof ev.phase === 'string' ? ev.phase : undefined, agentId: ev.agentId, state: 'progress' })
    } else if (agents.has(ev.agentId)) {
      const a = agents.get(ev.agentId)
      if (ev.type === 'result') {
        a.state = 'done'
        const r = typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result ?? null)
        a.resultPreview = r.slice(0, 400)
      } else if (ev.type === 'failed') {
        a.state = 'error'
      }
    }
  }
  const list = [...agents.values()]
  const inferred = !known
  if (inferred && !(list.length && FIRST_LABELS.has(list[0].label))) return null
  const mtime = (name) => files.get(name)?.mtimeMs || null
  for (const a of list) {
    a.startedAt = mtime(`agent-${a.agentId}.meta.json`) || undefined
    a.lastProgressAt = mtime(`agent-${a.agentId}.jsonl`) || a.startedAt
    if (a.state !== 'progress' && a.startedAt && a.lastProgressAt) a.durationMs = Math.max(0, a.lastProgressAt - a.startedAt)
  }
  const all = list.map((a) => a.startedAt).filter(Boolean)
  const sinceResume = resumedAfter ? all.filter((t) => t > resumedAfter) : []
  const starts = sinceResume.length ? sinceResume : all
  return {
    workflowName: 'masterdevs-feature-loop',
    runId,
    status: 'running',
    startTime: starts.length ? Math.min(...starts) : undefined,
    result: null,
    args: {},
    workflowProgress: list,
    source: 'journal',
    inferred,
    ...(resumedAfter ? { resumedAfter } : {}),
  }
}

// Reads every run of the session: each finished run's wf_*.json, and each run still going from its
// journal. `cache` (a Map the caller keeps between polls) skips files whose size and mtime are
// unchanged and holds the last good parse of each, so a file caught mid-write shows its previous
// content — marked stale, with its ORIGINAL time — instead of vanishing or flickering to "unknown".
export async function readSessionRuns(fsx, sessionDir, { cache = new Map(), maxBytes = 3_500_000, known = new Set() } = {}) {
  const problems = []
  const records = []
  const seen = new Set()
  const finished = new Map() // run id → { at: index in records, mtimeMs } of its final record

  let entries = []
  try {
    entries = await fsx.list(join(sessionDir, 'workflows'))
  } catch {
    // Missing is normal (no run has finished yet); there but unreadable is worth saying.
    if (await fsx.exists(join(sessionDir, 'workflows')).catch(() => false)) problems.push('workflow records unreadable')
    entries = []
  }
  for (const e of entries) {
    if (e.kind !== 'file' || !WF_FILE.test(e.name)) continue
    seen.add(e.name)
    const final = { at: null, mtimeMs: e.mtimeMs }
    finished.set(e.name.slice(0, -'.json'.length), final)
    const keep = (r) => { final.at = records.length; records.push(r) }
    const prior = cache.get(e.name)
    if (prior && prior.size === e.size && prior.mtimeMs === e.mtimeMs) {
      keep(prior.record)
      continue
    }
    if (e.size > maxBytes) {
      problems.push(`${e.name} too large to read`)
      if (prior) keep({ ...prior.record, stale: true })
      continue
    }
    let record = null
    try {
      record = slim(JSON.parse(await fsx.read(join(sessionDir, 'workflows', e.name))))
    } catch {
      record = null
    }
    if (record) {
      record = { ...record, sourceMtimeMs: e.mtimeMs, stale: false }
      cache.set(e.name, { size: e.size, mtimeMs: e.mtimeMs, record })
      keep(record)
    } else {
      problems.push(`${e.name} unreadable or partially written`)
      if (prior) keep({ ...prior.record, stale: true })
    }
  }

  let live = []
  try {
    live = await fsx.list(join(sessionDir, 'subagents', 'workflows'))
  } catch {
    live = []
  }
  // A final record usually means the run is over, but a resumed run keeps its id: its journal grows
  // again after the old record was written. A journal newer than the record is the live truth, and
  // the old record is dropped. (Directory listings carry no times, so each run's own files are listed.)
  const superseded = new Set()
  for (const d of live) {
    if (d.kind !== 'dir' || !RUN_DIR.test(d.name)) continue
    const dir = join(sessionDir, 'subagents', 'workflows', d.name)
    let files
    try { files = new Map((await fsx.list(dir)).map((f) => [f.name, f])) } catch { continue }
    const journal = files.get('journal.jsonl')
    if (!journal) continue
    const final = finished.get(d.name)
    if (final && !(journal.mtimeMs > final.mtimeMs)) continue
    const key = `live:${d.name}`
    seen.add(key)
    const prior = cache.get(key)
    let text = prior?.text
    if (!prior || prior.size !== journal.size || prior.mtimeMs !== journal.mtimeMs) {
      if (journal.size > maxBytes) { problems.push(`${d.name} journal too large to read`); continue }
      try {
        text = await fsx.read(join(dir, 'journal.jsonl'))
        cache.set(key, { size: journal.size, mtimeMs: journal.mtimeMs, text })
      } catch {
        problems.push(`${d.name} journal unreadable`)
        if (text === undefined) continue
      }
    }
    const record = journalRecord(d.name, text, files, {
      // A run that had a final record was already accepted as masterdevs by its recorded name.
      known: known.has(d.name) || records[final?.at]?.workflowName === 'masterdevs-feature-loop',
      resumedAfter: final ? final.mtimeMs : null,
    })
    if (record) {
      records.push({ ...record, sourceMtimeMs: journal.mtimeMs, stale: false })
      if (final?.at != null) superseded.add(final.at)
    }
  }

  for (const name of [...cache.keys()]) if (!seen.has(name)) cache.delete(name)
  return { records: records.filter((_, i) => !superseded.has(i)), problems }
}
