// The live MasterDevs status pane: what each workflow agent of THIS session's run is doing, redrawn
// every five seconds, with no model calls and no prompts.
//
//   tool.call     notes each workflow agent's tool calls as they start and finish (observed history)
//   clock.every   every 5s: re-read this session's run record, fold the notes in, redraw
//   Pane          draws the run headline and one rolling six-line section per live agent
//   AbovePrompt   a one-line hint while the pane is open but the terminal is too narrow to seat it
//   /masterdevs-status   opens the pane now, at any width, even mid-turn
//
// The pane opens by itself once per run, never taking the keyboard, and closes by itself once when the
// run ends (a plan to approve, a finished build); the next run opens it again. Closing it by
// hand keeps it closed for the rest of the session until /masterdevs-status reopens it.

import { read, update } from 'claude-code'

import { selectRun, viewFor } from './lib/run-status.mjs'
import { locateSessionDir, readSessionRuns } from './lib/run-source.mjs'
import { addRuns, estimate, runSpans, scanPastRuns } from './lib/eta.mjs'
import { caption, observeAll, progressOf, sample, stateOf } from './lib/activity.mjs'
import { paneLines } from './lib/status-pane.mjs'

const PANE = 'masterdevs-status'
const COMMAND = 'masterdevs-status'
const TITLE = 'MasterDevs'
const PERIOD_MS = 5000
// The projects-directory scan is the fallback when Claude did not hand over the transcript path and
// the session's own directory is not where its cwd suggests. Most sessions never run a workflow, so
// the wait between scans doubles from one minute to ten.
const SCAN_FIRST_MS = 60000
const SCAN_MAX_MS = 600000
const MAX_PENDING = 500
// Past runs' timing, for the ETA, kept across sessions in $.store. Seeded from this machine's past
// records about once a day; each session also adds its own runs as they finish.
const HISTORY_KEY = 'etaHistory'
const HISTORY_RESCAN_MS = 24 * 60 * 60 * 1000

const VIEW = { plugin: 'masterdevs', key: 'view' }
const TAILS = { plugin: 'masterdevs', key: 'tails' }
const SAMPLES = { plugin: 'masterdevs', key: 'samples' }
const DISMISSED = { plugin: 'masterdevs', key: 'dismissed' }
const AUTO_OPENED = { plugin: 'masterdevs', key: 'autoOpened' }
const HINT = { plugin: 'masterdevs', key: 'hint' }
const SESSION = { plugin: 'masterdevs', key: 'session' }
const TRANSCRIPT = { plugin: 'masterdevs', key: 'transcript' }
const LAUNCHES = { plugin: 'masterdevs', key: 'launches' }
const PROGRESS = { plugin: 'masterdevs', key: 'progress' }
const AUTO_CLOSED = { plugin: 'masterdevs', key: 'autoClosed' }

const TONE = {
  title: { bold: true },
  header: { bold: true, color: 'claude' },
  warn: { color: 'warning' },
  dim: { dimColor: true },
  normal: {},
}

// Module variables reset on a hot reload; anything a drawing needs lives in $.state instead.
let timer = null
let pending = [] // tool observations not yet folded into $.state
let launched = [] // masterdevs run ids the Workflow tool reported, not yet folded into $.state
let stepped = [] // { agent, progress } step markers seen, not yet folded into $.state
let seq = 0
let inFlight = null // the refresh running now, so two never overlap
let isInteractive = true
const cache = new Map()
let located = { sessionId: null, dir: null, scanAt: -Infinity, scanGap: SCAN_FIRST_MS }
let history = null // { scannedAt, runs }, as stored under HISTORY_KEY
let historyScan = null // the background seeding scan, while it runs

function note(agent, obs) {
  pending.push({ agent, obs })
  if (pending.length > MAX_PENDING) pending = pending.slice(-MAX_PENDING)
}

async function configDir($) {
  const own = await $.env.get('CLAUDE_CONFIG_DIR')
  if (own) return own.replace(/\/+$/, '')
  const home = await $.env.get('HOME')
  return home ? `${home.replace(/\/+$/, '')}/.claude` : null
}

// The run-source module takes its filesystem as a parameter; this is the host's.
function hostFs($) {
  return {
    list: (path) => $.fs.list(path),
    read: (path) => $.fs.read(path),
    exists: (path) => $.fs.exists(path),
  }
}

async function sessionDir($, sessionId, now) {
  if (located.sessionId === sessionId && located.dir) return { dir: located.dir }
  if (located.sessionId !== sessionId) located = { sessionId, dir: null, scanAt: now, scanGap: SCAN_FIRST_MS }
  const transcript = await read($, TRANSCRIPT)
  const scan = now >= located.scanAt
  if (scan) {
    located.scanAt = now + located.scanGap
    located.scanGap = Math.min(SCAN_MAX_MS, located.scanGap * 2)
  }
  const config = await configDir($)
  const found = await locateSessionDir(hostFs($), {
    projectsDir: config && `${config}/projects`,
    sessionId,
    transcriptPath: transcript?.sessionId === sessionId ? transcript.path : null,
    candidates: [await $.session.cwd(), await $.session.root()],
    scan,
  })
  if (found.dir) located.dir = found.dir
  return found
}

async function loadHistory($) {
  if (history) return history
  const stored = await $.store.get(HISTORY_KEY).catch(() => undefined)
  history = stored && Array.isArray(stored.runs)
    ? { scannedAt: Number(stored.scannedAt) || 0, runs: stored.runs }
    : { scannedAt: 0, runs: [] }
  return history
}

async function saveHistory($, runs, scannedAt) {
  history = { scannedAt, runs }
  await $.store.set(HISTORY_KEY, history).catch(() => {})
}

// Folds this session's finished runs into the history (they were just read, so this costs nothing),
// and starts the background seeding scan when the last one is a day old.
async function learn($, records, now) {
  const h = await loadHistory($)
  const have = new Set(h.runs.map((r) => r.runId))
  const fresh = (records || []).map(runSpans).filter((r) => r && !have.has(r.runId))
  if (fresh.length) await saveHistory($, addRuns(h.runs, fresh), h.scannedAt)
  if (!historyScan && now - h.scannedAt >= HISTORY_RESCAN_MS) {
    historyScan = seedHistory($, now).catch(() => {}).finally(() => { historyScan = null })
  }
}

async function seedHistory($, now) {
  const config = await configDir($)
  if (!config) return
  const h = await loadHistory($)
  const found = await scanPastRuns(hostFs($), `${config}/projects`, { skip: new Set(h.runs.map((r) => r.runId)) })
  const latest = await loadHistory($)
  await saveHistory($, addRuns(latest.runs, found), now)
}

async function registerCommand($) {
  await $.command.register({
    name: COMMAND,
    description: 'Show live MasterDevs progress for this session',
    immediate: true,
  })
}

// After a reload the stored histories keep their sequence numbers while this module's counter starts
// over; continue above them, or new lines would sort above old ones or be dropped as already evicted.
async function resumeSeq($) {
  const stored = [await read($, TAILS), await read($, SAMPLES)]
  for (const tails of stored) {
    for (const list of Object.values(tails || {})) for (const x of list) seq = Math.max(seq, x.seq || 0)
  }
}

// A new session id (a /clear, a resume) starts from nothing: no other session's run, history,
// dismissal or auto-open carries over.
async function bind($, sessionId) {
  const { value: bound } = await $.state.get(SESSION)
  if (bound === sessionId) return
  // The command was declared for the session that ended; declare it for this one too.
  if (bound !== undefined) await registerCommand($).catch(() => {})
  cache.clear()
  pending = []
  await $.state.set(SESSION, sessionId)
  await $.state.set(VIEW, { kind: 'starting' })
  await $.state.set(TAILS, {})
  await $.state.set(SAMPLES, {})
  await $.state.set(DISMISSED, false)
  await $.state.set(AUTO_OPENED, null)
  await $.state.set(HINT, false)
  await $.state.set(LAUNCHES, [])
  await $.state.set(PROGRESS, {})
  await $.state.set(AUTO_CLOSED, null)
}

// A resumed run keeps its id, so the resume counts as a new run to open or close for.
const runKey = (view) => `${view.model.runId || 'unknown'}${view.model.resumedAfter ? `@${view.model.resumedAfter}` : ''}`

// Once per run that ends — a plan waiting for approval, questions, a finished build, a stop — close the
// pane: there is nothing left to watch, the result is in the chat, and the next run opens it again.
// Only once, so a person who reopens it with /masterdevs-status to look keeps it.
async function maybeClose($, view) {
  const lc = view.kind === 'run' ? view.model.lifecycle : null
  if (!lc?.terminal) return
  const key = runKey(view)
  if ((await read($, AUTO_CLOSED)) === key) return
  await $.state.set(AUTO_CLOSED, key)
  if ((await $.ui.panes()).some((p) => p.id === PANE)) await $.ui.close({ id: PANE }).catch(() => {})
}

// Once per run, only while it runs, only if not dismissed. Never asks for focus.
async function maybeOpen($, view) {
  const live = view.kind === 'run' && !view.model.lifecycle.terminal
  if (!live) {
    if (await read($, HINT)) await $.state.set(HINT, false)
    await maybeClose($, view)
    return
  }
  if (!isInteractive || (await read($, DISMISSED))) return
  const runId = runKey(view)
  if ((await read($, AUTO_OPENED)) !== runId) {
    await $.state.set(AUTO_OPENED, runId)
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    await $.state.set(HINT, !opened.isPlaced)
    return
  }
  if (await read($, HINT)) {
    const pane = (await $.ui.panes()).find((p) => p.id === PANE)
    if (!pane || pane.isPlaced) await $.state.set(HINT, false)
  }
}

async function poll($, force) {
  const sessionId = await $.session.id().catch(() => null)
  if (!sessionId) {
    await $.state.set(VIEW, { kind: 'unavailable', reason: 'session identity unavailable' })
    return
  }
  await bind($, sessionId)
  const batch = pending
  pending = []
  if (batch.length) await update($, TAILS, (t) => observeAll(t, batch))
  const marks = stepped
  stepped = []
  if (marks.length) {
    await update($, PROGRESS, (p) => {
      const next = { ...(p || {}) }
      for (const { agent, progress } of marks) next[agent] = progress
      // Bounded like the activity histories: the newest agents' marks are kept.
      return Object.fromEntries(Object.entries(next).slice(-24))
    })
  }

  // Dismissed and not asked: keep the cheap event notes, skip reading files.
  if (!force && (await read($, DISMISSED))) return

  const ids = launched
  launched = []
  if (ids.length) await update($, LAUNCHES, (l) => [...(l || []), ...ids].slice(-20))
  const known = new Set((await read($, LAUNCHES)) || [])

  const now = await $.clock.now()
  const found = await sessionDir($, sessionId, now)
  const source = found.dir ? await readSessionRuns(hostFs($), found.dir, { cache, known }) : {}
  await learn($, source.records, now)
  let view = viewFor({ found, ...source, now })
  if (view.kind === 'run') {
    view = { ...view, eta: estimate(history?.runs, selectRun(source.records), now) }
    seq += 1
    const at = seq
    await update($, SAMPLES, (s) => sample(s, view.model.live, at, undefined, now))
  }
  // The session may have changed while the files were read; never draw its old run over the new one.
  if ((await $.session.id().catch(() => null)) !== sessionId) return
  await $.state.set(VIEW, view)
  await maybeOpen($, view)
}

// Serialized: a forced refresh (the command) waits for the one in flight, then runs its own.
async function refresh($, force) {
  while (inFlight) await inFlight
  const mine = poll($, force).catch(() => {})
  inFlight = mine
  await mine
  if (inFlight === mine) inFlight = null
}

export const register = (on) => {
  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive !== false
    await registerCommand($)
    await resumeSeq($)
    timer?.cancel()
    timer = $.clock.every(PERIOD_MS, () => {
      // A slow read skips this tick rather than queueing behind it.
      if (!inFlight) void refresh($, false)
    })
    void refresh($, false)
    return next(e)
  })

  // Claude tells its settings hooks exactly where the transcript is, on startup, resume and /clear
  // alike; the session's workflow records sit in a directory beside it.
  on('classic.SessionStart', async ($, e, next) => {
    if (typeof e.session_id === 'string' && typeof e.transcript_path === 'string') {
      await $.state.set(TRANSCRIPT, { sessionId: e.session_id, path: e.transcript_path })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // A /clear or a resume ends the conversation but not the process, and no session.start follows, so
  // the timer must keep running: the next poll sees the new session id and starts it from nothing.
  // Until then, stop showing the old run.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      await $.state.set(VIEW, { kind: 'starting' })
      await $.state.set(HINT, false)
    } else {
      timer?.cancel()
      timer = null
    }
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($) => {
    await $.state.set(DISMISSED, false)
    await refresh($, true)
    await $.ui.open({ id: PANE, title: TITLE })
    await $.state.set(HINT, false)
    return { text: 'MasterDevs status pane opened.' }
  }).catch(() => ({ text: 'MasterDevs status pane could not open; try again in a moment.' }))

  // The person's close is a decision for the session; a plugin close or an unload is not.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin?.kind === 'person') {
      await $.state.set(DISMISSED, true)
      await $.state.set(HINT, false)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Observe, never steer: the call and its result pass through untouched, and nothing before `next`
  // can fail the call. A workflow agent's loop carries its own agentId; the main loop's calls carry
  // none and are ignored. The .catch replays `next` if it already ran, so a tool never runs twice.
  on('tool.call', async ($, e, next) => {
    const agent = e.agentId
    // The main loop launching the feature loop: its result names the run, which tells the run's
    // journal apart from any other workflow's while the run is going.
    if (!agent && String(e.tool) === 'Workflow') {
      const result = await next(e)
      const record = result?.result
      if (record?.workflowName === 'masterdevs-feature-loop' && typeof record.runId === 'string') launched.push(record.runId)
      return result
    }
    if (!agent || !e.tool_use_id) return next(e)
    const id = e.tool_use_id
    const text = caption(e.tool, e)
    const progress = progressOf(e.tool, e)
    if (progress) stepped.push({ agent, progress })
    // When the line appeared, shown beside it: a line that stays put for minutes says since when.
    const at = await $.clock.now().catch(() => null)
    note(agent, { id, seq: ++seq, at, text, state: 'started' })
    const result = await next(e)
    note(agent, { id, seq: ++seq, at, text, state: stateOf(result) })
    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const lines = paneLines({
      view: await read($, VIEW),
      tails: await read($, TAILS),
      samples: await read($, SAMPLES),
      progress: await read($, PROGRESS),
      width: e.props.bodyColumns,
      rows: e.props.scroll?.bodyRows ?? 24,
    })
    return h(Box, { flexDirection: 'column' },
      ...lines.map((l) => h(Text, { ...TONE[l.tone], wrap: 'truncate-end' }, l.text || ' ')))
  })

  // Only while the pane waits unseated: say how to see it, and keep whatever else draws here.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, HINT))) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const below = await next(e)
    return h(Box, { flexDirection: 'column' },
      h(Text, { dimColor: true, wrap: 'truncate-end' }, 'MasterDevs is running · /masterdevs-status shows live progress'),
      below)
  })
}
