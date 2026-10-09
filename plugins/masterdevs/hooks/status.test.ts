// Offline host tests for the status pane (hooks/register.js), run with `claude plugin test plugins/masterdevs`.
// The world beneath the plugin — clock, files, session, panes — is answered here from memory, so these
// prove scheduling, session isolation, pane lifecycle and drawing without a live run. The pure layout
// and history rules have their own, finer scenarios in scripts/run-status-scenarios.mjs.

import { describe, expect, mock, test } from 'claude-code/testing'

const PANE = 'masterdevs-status'
const SID = '11111111-2222-3333-4444-555555555555'
const OTHER = '99999999-8888-7777-6666-555555555555'
const HOME = '/home/dev'
const CWD = '/work/app'
const PROJECT = `${HOME}/.claude/projects/-work-app`
const T0 = 1_800_000_000_000

type Agent = Record<string, unknown>
const phase = (index: number, title: string) => ({ type: 'workflow_phase', index, title })
const agent = (o: Agent) => ({ type: 'workflow_agent', attempt: 1, ...o })

function record(o: { runId: string, status?: string, agents?: Agent[], outcome?: string, durationMs?: number, startTime?: number }) {
  return JSON.stringify({
    workflowName: 'masterdevs-feature-loop',
    runId: o.runId,
    status: o.status ?? 'running',
    startTime: o.startTime ?? T0 - 120_000,
    ...(o.durationMs !== undefined ? { durationMs: o.durationMs } : {}),
    result: o.outcome ? { outcome: o.outcome } : null,
    args: { runDir: '/runs/r1' },
    script: 'x'.repeat(1000),
    workflowProgress: [phase(3, 'Implement'), phase(5, 'Verify'), phase(6, 'Review'), ...(o.agents ?? [])],
  })
}

const engineer = agent({ index: 1, label: 'implement:1', phaseTitle: 'Implement', agentId: 'a-eng', state: 'progress',
  startedAt: T0 - 60_000, lastProgressAt: T0 - 2_000, lastToolName: 'Read', lastToolSummary: 'cat secrets.env', toolCalls: 3 })

type Files = Record<string, { text: string, mtimeMs?: number }>

// A tiny in-memory filesystem behind $.fs.
function fsWorld(on: any, files: Files) {
  const reads: string[] = []
  const lists: string[] = []
  const children = (dir: string) => {
    const out = new Map<string, { name: string, kind: 'file' | 'dir', size: number, mtimeMs: number, isLink: boolean }>()
    for (const [p, f] of Object.entries(files)) {
      if (!p.startsWith(`${dir}/`)) continue
      const [name, ...rest] = p.slice(dir.length + 1).split('/')
      out.set(name, rest.length
        ? { name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false }
        : { name, kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs ?? 1, isLink: false })
    }
    return [...out.values()]
  }
  on('fs.list', (_$: any, e: any) => { lists.push(e.path); return { value: children(e.path) } })
  on('fs.exists', (_$: any, e: any) => ({ value: Object.keys(files).some((p) => p === e.path || p.startsWith(`${e.path}/`)) }))
  on('fs.read', (_$: any, e: any) => {
    reads.push(e.path)
    if (!files[e.path]) throw new Error('ENOENT')
    return { value: files[e.path].text }
  })
  return { reads, lists }
}

// Everything a session answers beneath the plugin. Returns what the plugin asked for.
// `store` is $.store across sessions. By default the ETA history was seeded moments ago, so the
// once-a-day scan of past runs stays out of tests about other things.
function world(on: any, o: { sessionId?: string | null, files?: Files, placed?: boolean, store?: Record<string, unknown> } = {}) {
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, { HOME })
  const fsw = fsWorld(on, o.files ?? {})
  const store: Record<string, unknown> = o.store ?? { etaHistory: { scannedAt: T0, runs: [] } }
  on('store.get', (_$: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_$: any, e: any) => { store[e.key] = e.value; return { value: undefined } })
  const asked = { opens: [] as any[], closes: [] as any[], commands: [] as string[], model: 0, prompts: 0 }
  let sessionId = o.sessionId === undefined ? SID : o.sessionId
  on('session.id', () => (sessionId ? { value: sessionId } : { deny: 'no session' }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.root', () => ({ value: CWD }))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.end', (_$: any, e: any) => ({ sessionId: e.sessionId }))
  on('command.register', (_$: any, e: any) => { asked.commands.push(e.name); return { value: undefined } })
  const panes = new Map<string, boolean>()
  on('ui.open', (_$: any, e: any) => {
    asked.opens.push(e)
    panes.set(e.id, o.placed ?? true)
    return { value: (o.placed ?? true) ? { isPlaced: true } : { isPlaced: false, reason: 'below 144 columns' } }
  })
  on('ui.panes', () => ({ value: [...panes].map(([id, isPlaced]) => ({ id, title: 'MasterDevs', isShown: true, isFocused: false, isPlaced })) }))
  on('ui.close', (_$: any, e: any) => { asked.closes.push(e); panes.delete(e.id); return { value: undefined } })
  on('model.complete', () => { asked.model += 1; return { value: { isAnswered: false, reason: 'aborted' } } })
  on('prompt.submit', (_$: any, e: any) => { asked.prompts += 1; return e })
  return { clock, asked, store, reads: fsw.reads, lists: fsw.lists, switchTo: (id: string) => { sessionId = id } }
}

const start = ($: any) => $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })

async function paneText($: any, columns = 60, rows = 30) {
  const ui = await $.ui.mount({
    plugin: 'masterdevs', surface: 'terminal', component: 'Pane', requestId: PANE,
    props: { title: 'MasterDevs', isFocused: false, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: rows }, view: {} },
  })
  const texts = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
  await ui.unmount?.()
  return texts as string[]
}

describe('refresh', () => {
  test('redraws every five seconds and never calls a model or submits a prompt', async ($, on) => {
    const files: Files = { [`${PROJECT}/${SID}/workflows/wf_a.json`]: { text: record({ runId: 'r1', agents: [engineer] }) } }
    const w = world(on, { files })
    await start($)
    await w.clock.settle()
    const first = w.reads.length
    expect(first).toBe(1)
    // Unchanged file: no re-read, but the tick still runs (it would re-read once the file changes).
    files[`${PROJECT}/${SID}/workflows/wf_a.json`] = { text: record({ runId: 'r1', agents: [{ ...engineer, toolCalls: 4 }] }), mtimeMs: 2 }
    await w.clock.advance(4_999)
    expect(w.reads.length).toBe(first)
    await w.clock.advance(1)
    expect(w.reads.length).toBe(first + 1)
    await w.clock.advance(15_000)
    expect(w.asked.model).toBe(0)
    expect(w.asked.prompts).toBe(0)
    expect(w.asked.commands).toEqual(['masterdevs-status'])
  })
})

describe('session isolation', () => {
  test('shows only this session’s run, never a running one from another session', async ($, on) => {
    const files: Files = {
      [`${PROJECT}/${OTHER}/workflows/wf_o.json`]: { text: record({ runId: 'other-run', agents: [engineer] }) },
      [`${PROJECT}/${SID}/workflows/wf_m.json`]: { text: record({ runId: 'mine', status: 'completed', outcome: 'passed', durationMs: 90_000 }) },
    }
    const w = world(on, { files })
    await start($)
    await w.clock.settle()
    expect(w.reads.every((p) => p.includes(`/${SID}/`))).toBe(true)
    const text = (await paneText($)).join('\n')
    expect(text).toContain('finished — verification passed')
    expect(text).not.toContain('implement:1')
  })

  test('the transcript path Claude reports binds the session exactly, without a search', async ($, on) => {
    const elsewhere = `${HOME}/.claude/projects/-where-it-started`
    const files: Files = {
      [`${elsewhere}/${SID}/workflows/wf_a.json`]: { text: record({ runId: 'r1', agents: [engineer] }) },
      [`${PROJECT}/${OTHER}/workflows/wf_o.json`]: { text: record({ runId: 'theirs', agents: [engineer] }) },
    }
    const w = world(on, { files })
    on('classic.SessionStart', () => ({}))
    await $.classic.SessionStart({ source: 'startup', session_id: SID, transcript_path: `${elsewhere}/${SID}.jsonl` } as any)
    await start($)
    await w.clock.settle()
    expect((await paneText($)).join('\n')).toContain('implement:1')
    expect(w.lists.some((p) => p.endsWith('/projects'))).toBe(false)
    expect(w.reads.every((p) => p.includes(`/${SID}/`))).toBe(true)
  })

  test('no session identity: says so, reads nothing', async ($, on) => {
    const w = world(on, { sessionId: null, files: { [`${PROJECT}/${OTHER}/workflows/wf_o.json`]: { text: record({ runId: 'x', agents: [engineer] }) } } })
    await start($)
    await w.clock.settle()
    expect(w.reads.length).toBe(0)
    expect((await paneText($)).join('\n')).toContain('session identity unavailable')
  })

  test('after /clear the pane keeps refreshing, drops the old run, and the command still exists', async ($, on) => {
    const files: Files = { [`${PROJECT}/${SID}/workflows/wf_a.json`]: { text: record({ runId: 'r1', agents: [engineer] }) } }
    const w = world(on, { files })
    await start($)
    await w.clock.settle()
    expect((await paneText($)).join('\n')).toContain('implement:1')
    await $.session.end({ reason: 'clear', sessionId: SID, resume: {} } as any)
    expect((await paneText($)).join('\n')).not.toContain('implement:1')
    w.switchTo(OTHER)
    files[`${PROJECT}/${OTHER}/workflows/wf_b.json`] = { text: record({ runId: 'r2', agents: [{ ...engineer, label: 'refactor:1', agentId: 'a-ref' }] }) }
    await w.clock.advance(5_000)
    const text = (await paneText($)).join('\n')
    expect(text).toContain('refactor:1')
    expect(text).not.toContain('implement:1')
    expect(w.asked.commands.length).toBe(2)
    expect(w.asked.opens.length).toBe(2)
  })

  test('a session switch drops the old run and its history', async ($, on) => {
    const files: Files = { [`${PROJECT}/${SID}/workflows/wf_a.json`]: { text: record({ runId: 'r1', agents: [engineer] }) } }
    const w = world(on, { files })
    await start($)
    await w.clock.settle()
    expect((await paneText($)).join('\n')).toContain('implement:1')
    w.switchTo(OTHER)
    await w.clock.advance(5_000)
    const text = (await paneText($)).join('\n')
    expect(text).not.toContain('implement:1')
    expect(text).toContain('no run in this session')
  })
})

describe('a run still going (only its journal exists)', () => {
  const live = `${PROJECT}/${SID}/subagents/workflows/wf_b0327ff2-139`
  const journal = [
    { type: 'launched' },
    { type: 'started', key: 'k1', agentId: 'a-ref', label: 'refine', phase: 'Refine' },
    { type: 'result', key: 'k1', agentId: 'a-ref', result: { requirements: 'r' } },
    { type: 'started', key: 'k2', agentId: 'a-plan', label: 'plan', phase: 'Plan' },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n'
  const files = (): Files => ({
    [`${live}/journal.jsonl`]: { text: journal, mtimeMs: T0 - 1_000 },
    [`${live}/agent-a-ref.meta.json`]: { text: '{}', mtimeMs: T0 - 90_000 },
    [`${live}/agent-a-ref.jsonl`]: { text: '', mtimeMs: T0 - 40_000 },
    [`${live}/agent-a-plan.meta.json`]: { text: '{}', mtimeMs: T0 - 39_000 },
    [`${live}/agent-a-plan.jsonl`]: { text: '', mtimeMs: T0 - 1_000 },
  })

  test('opens the pane and shows the live agent before any final record exists', async ($, on) => {
    const w = world(on, { files: files() })
    await start($)
    await w.clock.settle()
    expect(w.asked.opens.length).toBe(1)
    const text = (await paneText($, 80)).join('\n')
    expect(text).toContain('MasterDevs · Plan · running')
    expect(text).toContain('ARCHITECT · plan')
  })

  test('a resumed run opens the pane, though the failed first attempt left a final record', async ($, on) => {
    const failed = record({ runId: 'wf_b0327ff2-139', status: 'failed', durationMs: 56_000 })
    const w = world(on, { files: { ...files(), [`${PROJECT}/${SID}/workflows/wf_b0327ff2-139.json`]: { text: failed, mtimeMs: T0 - 100_000 } } })
    await start($)
    await w.clock.settle()
    expect(w.asked.opens.length).toBe(1)
    const text = (await paneText($, 80)).join('\n')
    expect(text).toContain('MasterDevs · Plan · running')
    expect(text).not.toContain('failed')
  })

  test('the Workflow tool’s launch result marks the run as masterdevs exactly', async ($, on) => {
    const odd = files()
    odd[`${live}/journal.jsonl`] = { text: journal.replace('"refine"', '"warm-up"'), mtimeMs: T0 - 1_000 }
    const w = world(on, { files: odd })
    on('tool.call', () => ({ result: { status: 'async_launched', workflowName: 'masterdevs-feature-loop', runId: 'wf_b0327ff2-139' }, text: 'launched' }))
    await start($)
    await w.clock.settle()
    expect(w.asked.opens.length).toBe(0) // first agent is not one the loop starts with: not guessed
    await $.tool.call({ tool: 'Workflow', scriptPath: '/x/feature-loop.js' } as any)
    await w.clock.advance(5_000)
    expect(w.asked.opens.length).toBe(1)
  })
})

describe('ETA', () => {
  // Three past build runs that each finished 30, 40 and 50 minutes after their Implement phase began.
  const past = [30, 40, 50].map((m, i) => ({ runId: `old${i}`, kind: 'build', end: T0 - 86_400_000 + m * 60_000,
    phases: { Implement: T0 - 86_400_000 } }))
  const live = () => ({ [`${PROJECT}/${SID}/workflows/wf_a.json`]: { text: record({ runId: 'r1', agents: [engineer] }) } })

  test('shows a local finish time and its range, from past runs that reached the same phase', async ($, on) => {
    const w = world(on, { files: live(), store: { etaHistory: { scannedAt: T0, runs: past } } })
    await start($)
    await w.clock.settle()
    // Implement began a minute ago (engineer.startedAt), so the median finish is 39 minutes from now.
    const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    const text = (await paneText($, 120)).join('\n')
    expect(text).toContain(`ETA ~${clock(T0 - 60_000 + 40 * 60_000)} (${clock(T0 - 60_000 + 30 * 60_000)}–${clock(T0 - 60_000 + 50 * 60_000)}, from 3 past runs)`)
  })

  test('seeds its history from past records once, reading timing only and showing none of them', async ($, on) => {
    const finished = (runId: string, minutes: number) => record({ runId, status: 'completed', outcome: 'passed',
      startTime: T0 - 86_400_000, durationMs: minutes * 60_000,
      agents: [agent({ index: 1, label: 'implement:1', phaseTitle: 'Implement', agentId: `x-${runId}`, state: 'done', startedAt: T0 - 86_400_000 })] })
    const files: Files = {
      ...live(),
      [`${PROJECT}/${OTHER}/workflows/wf_p1.json`]: { text: finished('p1', 30) },
      [`${PROJECT}/${OTHER}/workflows/wf_p2.json`]: { text: finished('p2', 40) },
      [`${HOME}/.claude/projects/-elsewhere/${OTHER}/workflows/wf_p3.json`]: { text: finished('p3', 50) },
    }
    const w = world(on, { files, store: {} })
    await start($)
    await w.clock.settle()
    await w.clock.advance(5_000)
    const runs = (w.store.etaHistory as any).runs
    expect(runs.map((r: any) => r.runId).sort()).toEqual(['p1', 'p2', 'p3'])
    expect(Object.keys(runs[0]).sort()).toEqual(['end', 'kind', 'phases', 'runId'])
    const text = (await paneText($, 120)).join('\n')
    expect(text).toContain('from 3 past runs')
    expect(text).not.toContain('p1')
    // A day passes before it scans again.
    const reads = w.reads.length
    await w.clock.advance(60_000)
    expect(w.reads.filter((p) => p.includes(OTHER)).length).toBe(3)
    expect(w.reads.length).toBe(reads)
  })
})

describe('pane lifecycle', () => {
  test('auto-opens once per running run, without focus', async ($, on) => {
    const files: Files = { [`${PROJECT}/${SID}/workflows/wf_a.json`]: { text: record({ runId: 'r1', agents: [engineer] }) } }
    const w = world(on, { files })
    await start($)
    await w.clock.settle()
    await w.clock.advance(20_000)
    expect(w.asked.opens.length).toBe(1)
    expect(w.asked.opens[0].focus).toBeUndefined()
  })

  test('does not auto-open for a finished run', async ($, on) => {
    const files: Files = { [`${PROJECT}/${SID}/workflows/wf_a.json`]: { text: record({ runId: 'r1', status: 'completed', outcome: 'passed', durationMs: 5 }) } }
    const w = world(on, { files })
    await start($)
    await w.clock.settle()
    expect(w.asked.opens.length).toBe(0)
  })

  test('narrow terminal: hint above the prompt; the command opens it at once', async ($, on) => {
    const files: Files = { [`${PROJECT}/${SID}/workflows/wf_a.json`]: { text: record({ runId: 'r1', agents: [engineer] }) } }
    const w = world(on, { files, placed: false })
    // Another mod's band content beneath ours, which the hint must keep.
    on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => {
      const { Text } = $.ui.resolve(e)
      return h(Text, {}, 'other band')
    })
    await start($)
    await w.clock.settle()
    const band = await $.ui.mount({ plugin: 'masterdevs', surface: 'terminal', component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: true, maxRows: 3, bodyColumns: 80, scroll: { offset: 0, bodyRows: 3 }, view: {} } })
    expect((await band.find({ type: 'Text', text: /masterdevs-status/ }))).toBeDefined()
    expect((await band.find({ type: 'Text', text: 'other band' }))).toBeDefined()
    const out = await $.command.run({ command: 'masterdevs-status', args: '' })
    expect(JSON.stringify(out)).toContain('opened')
    expect(w.asked.opens.length).toBe(2)
  })

  // A person's close (the pane's close mark) is raised only by the engine; the test kit has no call
  // for it, so dismissal is not exercised here. What is: the command always opens and re-reads.
  test('the command opens the pane and reads fresh state at once', async ($, on) => {
    const files: Files = { [`${PROJECT}/${SID}/workflows/wf_a.json`]: { text: record({ runId: 'r1', agents: [engineer] }) } }
    const w = world(on, { files })
    await start($)
    await w.clock.settle()
    files[`${PROJECT}/${SID}/workflows/wf_a.json`] = { text: record({ runId: 'r1', agents: [{ ...engineer, toolCalls: 9 }] }), mtimeMs: 5 }
    const reads = w.reads.length
    await $.command.run({ command: 'masterdevs-status', args: '' })
    expect(w.asked.opens.length).toBe(2)
    expect(w.reads.length).toBe(reads + 1)
  })
})

describe('drawing', () => {
  test('stays within the body width on narrow and wide panes', async ($, on) => {
    const long = agent({ ...engineer, label: `review:${'very-long-reviewer-name-'.repeat(6)}:1`, agentId: 'a-rev', phaseTitle: 'Review' })
    const files: Files = { [`${PROJECT}/${SID}/workflows/wf_a.json`]: { text: record({ runId: 'r1', agents: [engineer, long] }) } }
    const w = world(on, { files })
    await start($)
    await w.clock.settle()
    for (const columns of [24, 60, 140]) {
      const lines = await paneText($, columns, 40)
      for (const l of lines) expect(l.length <= columns).toBe(true)
    }
  })

  test('without correlated events, history is labeled sampled and shows no raw tool summary', async ($, on) => {
    const files: Files = { [`${PROJECT}/${SID}/workflows/wf_a.json`]: { text: record({ runId: 'r1', agents: [engineer] }) } }
    const w = world(on, { files })
    await start($)
    await w.clock.settle()
    const text = (await paneText($, 80)).join('\n')
    expect(text).toContain('(sampled)')
    expect(text).toContain('Reading code')
    expect(text).not.toContain('secrets.env')
    expect(text).toContain('ETA unknown — needs 3 timed past runs, has 0')
  })

  test('a killed run shows no live agents, and its time stays frozen', async ($, on) => {
    const files: Files = { [`${PROJECT}/${SID}/workflows/wf_a.json`]: { text: record({ runId: 'r1', status: 'killed', durationMs: 61_000, agents: [engineer] }) } }
    const w = world(on, { files })
    await start($)
    await w.clock.settle()
    const before = (await paneText($)).join('\n')
    await w.clock.advance(60_000)
    const after = (await paneText($)).join('\n')
    expect(before).toContain('stopped (killed) · 1m 01s')
    expect(after).toContain('stopped (killed) · 1m 01s')
    expect(after).not.toContain('ENGINEER')
  })

  test('a half-written record shows the last good read, marked stale', async ($, on) => {
    const path = `${PROJECT}/${SID}/workflows/wf_a.json`
    const files: Files = { [path]: { text: record({ runId: 'r1', agents: [engineer] }) } }
    const w = world(on, { files })
    await start($)
    await w.clock.settle()
    files[path] = { text: '{"workflowName":"masterdevs-feature-loop","runId":"r1","sta', mtimeMs: 9 }
    await w.clock.advance(5_000)
    const text = (await paneText($, 120)).join('\n')
    expect(text).toContain('implement:1')
    expect(text).toContain('last good read')
  })
})

describe('waiting for the person', () => {
  const planning = (status: string, outcome?: string) => record({ runId: 'plan-run', status, outcome,
    ...(outcome ? { durationMs: 90_000 } : {}),
    agents: [agent({ index: 1, label: 'plan', phaseTitle: 'Plan', agentId: 'a-plan', state: status === 'running' ? 'progress' : 'done', startedAt: T0 - 60_000 })] })

  test('closes when the plan is ready for approval, and opens again when the build starts', async ($, on) => {
    const files: Files = { [`${PROJECT}/${SID}/workflows/wf_p.json`]: { text: planning('running') } }
    const w = world(on, { files })
    await start($)
    await w.clock.settle()
    expect(w.asked.opens.length).toBe(1)

    files[`${PROJECT}/${SID}/workflows/wf_p.json`] = { text: planning('completed', 'awaiting-plan-approval'), mtimeMs: 2 }
    await w.clock.advance(5_000)
    expect(w.asked.closes.length).toBe(1)
    // Only once: reopened by hand while deciding, it stays open.
    await $.command.run({ command: 'masterdevs-status', args: '' })
    await w.clock.advance(10_000)
    expect(w.asked.closes.length).toBe(1)

    files[`${PROJECT}/${SID}/workflows/wf_b.json`] = { text: record({ runId: 'build-run', agents: [engineer] }), mtimeMs: 3 }
    await w.clock.advance(5_000)
    expect(w.asked.opens.length).toBe(3) // auto, by hand, then the build
    expect(w.asked.opens[2].focus).toBeFalsy()
  })

  test('closes once the build loop is done', async ($, on) => {
    const files: Files = { [`${PROJECT}/${SID}/workflows/wf_b.json`]: { text: record({ runId: 'build-run', agents: [engineer] }) } }
    const w = world(on, { files })
    await start($)
    await w.clock.settle()
    files[`${PROJECT}/${SID}/workflows/wf_b.json`] = { text: record({ runId: 'build-run', status: 'completed', outcome: 'passed', durationMs: 60_000 }), mtimeMs: 2 }
    await w.clock.advance(5_000)
    expect(w.asked.closes.length).toBe(1)
    await w.clock.advance(20_000)
    expect(w.asked.closes.length).toBe(1)
  })
})

describe('plan steps', () => {
  test('the build agent’s step marker shows which step of how many, in the headline and its section', async ($, on) => {
    const w = world(on, { files: { [`${PROJECT}/${SID}/workflows/wf_a.json`]: { text: record({ runId: 'r1', agents: [engineer] }) } } })
    on('tool.call', () => ({ result: 'ok', text: 'ok' }))
    await start($)
    await w.clock.settle()
    await $.tool.call({ tool: 'Write', agentId: 'a-eng', tool_use_id: 'tu-s2',
      file_path: '/runs/r1/progress/implement-1-2.txt', content: 'Step 2 of 5: Add the shortcut listener\n' } as any)
    await w.clock.advance(5_000)
    const text = (await paneText($, 100)).join('\n')
    expect(text).toContain('MasterDevs · Implement · step 2 of 5 · running')
    expect(text).toContain('Step 2 of 5 · Add the shortcut listener')
    expect(text).toContain('Start step 2 of 5')
    expect(text).not.toContain('progress/implement')
  })
})

describe('tool observer', () => {
  test('passes a call and its result through unchanged', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'file body', text: 'file body' }))
    const out = await $.tool.call({ tool: 'Read', file_path: '/work/app/x.py' } as any)
    expect((out as any).result).toBe('file body')
  })

  test('an agent’s action shows the local time it began, which a later update keeps', async ($, on) => {
    const w = world(on, { files: { [`${PROJECT}/${SID}/workflows/wf_a.json`]: { text: record({ runId: 'r1', agents: [engineer] }) } } })
    on('tool.call', () => ({ result: 'ok', text: 'ok' }))
    await start($)
    await w.clock.settle()
    await w.clock.advance(3_000)
    await $.tool.call({ tool: 'Read', file_path: '/work/app/x.py', agentId: 'a-eng', tool_use_id: 'tu1' } as any)
    await w.clock.advance(5_000)
    const at = new Date(T0 + 3_000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
    const row = (await paneText($, 80)).find((t) => t.startsWith('Read x.py')) || ''
    expect(row.endsWith(at)).toBe(true)
    expect(row.length).toBe(80)
    const narrow = (await paneText($, 30)).find((t) => t.startsWith('Read x.py')) || ''
    expect(narrow).toBe('Read x.py')
  })
})
