// What the status pane draws, as plain lines: { text, tone }. Pure, so the scenario script checks the
// exact layout the pane shows, and register.js only maps lines to Text elements.
//
//   MasterDevs · Implement · step 3 of 7 · running · 41m 12s
//   ETA ~5:40 PM (5:25 PM–6:10 PM, from 28 past runs)
//   last progress 12s ago
//   next: Iterate → another round (only if blocking findings) → Polish (if needed)
//   review:security:1 → review — high in pricing.py:900: …
//
//   ENGINEER · implement:1                   ELAPSED 2m 14s
//   Step 3 of 7 · Add the shortcut listener
//   Read oil_pricing.py                         5:12:03 PM
//   Run unit tests …                            5:12:41 PM
//
// Every line is cut to the body's width, so nothing wraps: an agent's section is exactly one header
// plus at most six activity lines, however long the captions are.

import { duration, fit, mins } from './run-status.mjs'
import { TAIL, entryText } from './activity.mjs'
import { etaText, localClock } from './eta.mjs'

// The time a line appeared, to the second, in the viewer's local time.
export const localStamp = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
// Below this width the time is dropped: the action matters more than when it began.
const STAMP_MIN_WIDTH = 40

const line = (text, tone = 'normal') => ({ text, tone })

// "LEFT ... RIGHT" in `width` cells; the right side wins when space runs out.
function spread(left, right, width) {
  if (right.length >= width) return fit(right, width)
  const room = width - right.length - 1
  const l = fit(left, room)
  return `${l}${' '.repeat(Math.max(1, width - l.length - right.length))}${right}`
}

function sectionFor(agent, tails, samples, width, stamp, progress) {
  const observed = agent.agentId && Array.isArray(tails?.[agent.agentId]) ? tails[agent.agentId] : []
  const sampled = Array.isArray(samples?.[agent.key]) ? samples[agent.key] : []
  const isSampled = observed.length === 0 && sampled.length > 0
  const entries = (isSampled ? sampled : observed).slice(-TAIL)
  const name = `${agent.role} · ${agent.label}${agent.retry ? ' (retry)' : ''}${isSampled ? ' (sampled)' : ''}`
  const time = agent.elapsedMs == null ? 'unknown' : duration(agent.elapsedMs)
  // On a narrow pane the role matters more than the word "ELAPSED".
  const right = name.length + 9 + time.length <= width ? `ELAPSED ${time}` : time
  const body = entries.map((x) => line(
    Number.isFinite(x.at) && width >= STAMP_MIN_WIDTH ? spread(entryText(x), stamp(x.at), width) : fit(entryText(x), width),
    x.state === 'failed' || x.state === 'denied' ? 'warn' : 'normal'))
  if (body.length === 0) body.push(line(fit('no activity observed yet', width), 'dim'))
  const mark = agent.agentId ? progress?.[agent.agentId] : null
  const step = mark ? [line(fit(`${mark.kind === 'fix' ? 'Fix' : 'Step'} ${mark.step} of ${mark.of} · ${mark.title}`, width), 'title')] : []
  return [line(spread(name, right, width), 'header'), ...step, ...body]
}

// view: what the last refresh recorded (see register.js `refresh`).
// rows: the body's height; sections that do not fit are counted, not squeezed.
// clock, stamp: format epoch ms as a local time of day, to the minute and to the second (injected so
// tests do not depend on the time zone).
// progress: step markers by agent id (see activity.mjs `progressOf`).
export function paneLines({ view, tails, samples, progress = {}, width = 60, rows = 24, clock = localClock, stamp = localStamp }) {
  const w = Math.max(10, Math.floor(width))
  const out = []
  if (!view || view.kind === 'starting') return [line(fit('MasterDevs · looking for this session’s run…', w), 'dim')]
  if (view.kind === 'unavailable') {
    return [
      line(fit('MasterDevs · status unavailable', w), 'title'),
      line(fit(view.reason || 'run records could not be read', w), 'dim'),
    ]
  }
  if (view.kind === 'none') {
    return [
      line(fit('MasterDevs · no run in this session', w), 'title'),
      line(fit(view.reason || 'Start one with /masterdevs:feature.', w), 'dim'),
    ]
  }

  const m = view.model
  const lc = m.lifecycle
  const total = m.elapsed.ms == null ? 'time unknown' : duration(m.elapsed.ms)
  // The step a live build agent said it is on, so the headline reads "Implement · step 3 of 7".
  const marked = lc.terminal ? null : m.live.map((a) => a.agentId && progress?.[a.agentId]).find(Boolean)
  const where = marked ? `${m.phase || 'starting'} · ${marked.kind} ${marked.step} of ${marked.of}` : (m.phase || 'starting')
  out.push(line(fit(`MasterDevs · ${where} · ${lc.text} · ${total}`, w), lc.terminal && /BLOCKED|failed|error/i.test(lc.text) ? 'warn' : 'title'))

  // The estimate gets its own line: it is the one people look for first.
  const eta = lc.terminal ? null : etaText(view.eta, view.now, clock)
  if (eta) out.push(line(fit(eta, w), view.eta?.at == null || view.eta?.overdue ? 'dim' : 'normal'))

  const facts = []
  if (view.stale) facts.push(`showing the last good read (source unreadable: ${view.problem || 'unknown'})`)
  if (!lc.terminal) {
    if (m.sourceAgeMs == null) facts.push('no progress recorded yet')
    // A long quiet spell is worth saying, but it is not proof of a stall: a test suite can be silent.
    else if (mins(m.sourceAgeMs) >= 10) facts.push(`no recorded progress for ${mins(m.sourceAgeMs)}m — may still be working`)
    else facts.push(`last progress ${duration(m.sourceAgeMs)} ago`)
  }
  if (facts.length) out.push(line(fit(facts.join(' · '), w), view.stale ? 'warn' : 'dim'))
  if (m.next.length) out.push(line(fit(`next: ${m.next.join(' → ')}`, w), 'dim'))
  if (m.lastFinished?.headline) out.push(line(fit(`${m.lastFinished.label} → ${m.lastFinished.headline}`, w)))

  const sections = m.live.length
    ? m.live.map((a) => sectionFor(a, tails, samples, w, stamp, progress))
    : (m.lastFinished && lc.terminal
      ? [sectionFor({ ...m.lastFinished, retry: false }, tails, samples, w, stamp, progress)]
      : [])
  let room = Math.max(0, Math.floor(rows) - out.length)
  let shown = 0
  for (const s of sections) {
    const remaining = sections.length - shown - 1
    // Leave a row to say how many were left out, unless this is the last one.
    const need = s.length + 1 + (remaining > 0 ? 1 : 0)
    if (need > room) {
      if (shown === 0 && room >= 3) {
        // Not even one full section fits: keep its header and its NEWEST lines.
        const lines = Math.max(1, room - 2 - (remaining > 0 ? 1 : 0))
        out.push(line('', 'dim'), s[0], ...s.slice(1).slice(-lines))
        shown = 1
      }
      break
    }
    out.push(line('', 'dim'), ...s)
    room -= s.length + 1
    shown += 1
  }
  if (shown < sections.length) {
    out.push(line(fit(`+${sections.length - shown} more agent(s) running — enlarge the pane to see them`, w), 'dim'))
  }
  return out
}
