#!/usr/bin/env node
// Model-free checks for the run-status model shared by the CLI and the live status pane.
//
// Pure functions over synthetic, sanitized fixtures: no Claude session, no real run records. What the
// pane does inside a host (timers, panes, the session it binds to) is checked by
// plugins/masterdevs/hooks/status.test.ts under `claude plugin test plugins/masterdevs`.
//
//   node scripts/run-status-scenarios.mjs        # exit 1 on any failure

import assert from 'node:assert/strict'

import {
  headline, lifecycle, nextStages, relatedRuns, runElapsed, selectRun, statusLines, summarize, viewFor,
} from '../plugins/masterdevs/hooks/lib/run-status.mjs'
import { caption, entryText, observe, observeAll, progressOf, sample, stateOf, TAIL } from '../plugins/masterdevs/hooks/lib/activity.mjs'
import { journalRecord, locateSessionDir, projectSlug, readSessionRuns } from '../plugins/masterdevs/hooks/lib/run-source.mjs'
import { paneLines } from '../plugins/masterdevs/hooks/lib/status-pane.mjs'
import { addRuns, estimate, etaText, MAX_RUNS, runSpans, scanPastRuns } from '../plugins/masterdevs/hooks/lib/eta.mjs'

const T0 = 1_800_000_000_000
const phase = (index, title) => ({ type: 'workflow_phase', index, title })
const agent = (o) => ({ type: 'workflow_agent', attempt: 1, state: 'progress', startedAt: T0 - 60_000, lastProgressAt: T0 - 1_000, ...o })
const run = (o = {}) => ({
  workflowName: 'masterdevs-feature-loop', runId: 'r1', status: 'running', startTime: T0 - 600_000,
  result: null, args: { runDir: '/runs/r1' },
  workflowProgress: [phase(1, 'Refine'), phase(2, 'Plan'), phase(3, 'Implement'), phase(5, 'Verify'), phase(6, 'Review'), phase(8, 'Polish'), ...(o.agents || [])],
  ...o,
})
const obs = (id, seq, text = `step ${id}`, state = 'done') => ({ id, seq, text, state })

const scenarios = []
const scenario = (name, check) => scenarios.push({ name, check })

// ── rolling history ─────────────────────────────────────────────────────────
scenario('eight distinct events keep exactly the newest six, oldest to newest', () => {
  let t = {}
  for (let i = 1; i <= 8; i++) t = observe(t, 'a', obs(`c${i}`, i))
  assert.equal(TAIL, 6)
  assert.deepEqual(t.a.map((x) => x.id), ['c3', 'c4', 'c5', 'c6', 'c7', 'c8'])
})

scenario('a call’s start and finish are one line whose state moves forward, never back', () => {
  let t = observe({}, 'a', obs('c1', 1, 'Run unit tests', 'started'))
  assert.equal(entryText(t.a[0]), 'Run unit tests …')
  t = observe(t, 'a', obs('c1', 2, 'Run unit tests', 'failed'))
  assert.equal(t.a.length, 1)
  assert.equal(entryText(t.a[0]), 'Run unit tests — failed')
  // A late duplicate "started" for the same call must not undo the result.
  t = observe(t, 'a', obs('c1', 3, 'Run unit tests', 'started'))
  assert.equal(t.a[0].state, 'failed')
})

scenario('two real calls with the same caption stay two lines', () => {
  const t = observeAll({}, [
    { agent: 'a', obs: obs('c1', 1, 'Read pricing.py') },
    { agent: 'a', obs: obs('c2', 2, 'Read pricing.py') },
  ])
  assert.equal(t.a.length, 2)
})

scenario('a burst between two refreshes lands whole and in order', () => {
  const batch = Array.from({ length: 5 }, (_, i) => ({ agent: 'a', obs: obs(`c${i}`, i + 1) }))
  const t = observeAll({ a: [obs('old', 0)] }, batch)
  assert.deepEqual(t.a.map((x) => x.id), ['old', 'c0', 'c1', 'c2', 'c3', 'c4'])
})

scenario('parallel agents never share a history', () => {
  const t = observeAll({}, [
    { agent: 'verify', obs: obs('v1', 1, 'Run the full suite') },
    { agent: 'review', obs: obs('r1', 2, 'Read pricing.py') },
    { agent: 'verify', obs: obs('v2', 3, 'Run the criteria checks') },
  ])
  assert.deepEqual(t.verify.map((x) => x.id), ['v1', 'v2'])
  assert.deepEqual(t.review.map((x) => x.id), ['r1'])
})

scenario('idle polls add nothing and evict nothing; a new tool count adds one sampled line', () => {
  const live = [{ key: 'a', lastToolName: 'Bash', toolCalls: 7 }]
  const once = sample({}, live, 1)
  const twice = sample(once, live, 2)
  assert.deepEqual(twice, once)
  const moved = sample(twice, [{ ...live[0], toolCalls: 8 }], 3)
  assert.equal(moved.a.length, 2)
  assert.equal(moved.a[1].text, 'Running commands')
})

scenario('the number of agents kept is bounded', () => {
  let t = {}
  for (let i = 0; i < 40; i++) t = observe(t, `agent${i}`, obs(`c${i}`, i))
  assert.ok(Object.keys(t).length <= 24)
  assert.ok(t.agent39, 'the newest agent survives')
})

// ── captions ────────────────────────────────────────────────────────────────
scenario('an undescribed shell call says what it is doing in plain words — never the command itself', () => {
  const cases = [
    ['cat src/app/layout.tsx && ls src/components/ui | head -40', 'Read files and look through folders'],
    ['grep -rn "Toaster\\|use client" src | head -30; cat next.config.js', 'Search the code and read files'],
    ['cd /repo && API_KEY=sk-123 npm test -- --watch=false', 'Run tests'],
    ['python3 -m pytest tests/ -q', 'Run tests'],
    ['npx eslint src/a.tsx 2>&1 | tail -20', 'Check the code'],
    ["mkdir -p src/x && cat > src/x/a.tsx <<'EOF'\nimport secret from 'y'\nrm -rf /\nEOF\nnpx vitest run src/x", 'Run tests and change files'],
    ['git log --oneline -5 && git diff main --stat', 'Look at past changes and compare changes'],
    ['pnpm install && pnpm build', 'Build the app and install packages'],
    ['sed -i "s/a/b/" file.ts', 'Change files'],
    ['rm -rf build', 'Delete files'],
    ['PGPASSWORD=hunter2 psql -c "select * from users"', 'Query the database'],
    ['curl -s https://api.example.com/x?token=1 | jq .', 'Fetch a web page'],
    ['npm run dev > /dev/null 2>&1 &', 'Start the app'],
    ['echo $X; cd /tmp; sleep 2', 'Run a command'],
  ]
  for (const [command, want] of cases) {
    const got = caption('Bash', { command })
    assert.equal(got, want, command)
    assert.ok(got.split(' ').length <= 10, `${got} is over 10 words`)
    for (const leak of ['src', 'sk-123', 'hunter2', 'users', 'example', 'token', 'secret', 'npm', 'git', 'grep']) {
      assert.ok(!got.toLowerCase().includes(leak), `${got} leaks ${leak}`)
    }
  }
})

scenario('captions name the file and the agent’s own description, never the command or code', () => {
  assert.equal(caption('Read', { file_path: '/repo/src/oil_pricing.py' }), 'Read oil_pricing.py')
  assert.equal(caption('Edit', { file_path: '/repo/src/oil_pricing.py', old_string: 'secret', new_string: 'x' }), 'Edit oil_pricing.py')
  assert.equal(caption('Bash', { command: 'pytest -k "x" && curl evil', description: 'Run unit tests' }), 'Run unit tests')
  assert.equal(caption('Bash', { command: 'rm -rf build' }), 'Delete files')
  assert.equal(caption('Bash', { command: 'echo $X; cd /tmp' }), 'Run a command')
  assert.equal(caption('Grep', { pattern: 'API_KEY=.*' }), 'Search the codebase')
  assert.equal(caption('WebFetch', { url: 'https://user:pw@docs.example.com/x?token=1' }), 'Fetch docs from docs.example.com')
  assert.equal(caption('WebFetch', { url: 'not a url' }), 'Fetch a web page')
  assert.equal(caption('WebFetch', { url: 'https://docs.example.com/x?token=1' }), 'Fetch docs from docs.example.com')
  assert.equal(caption('mcp__github__create_pull_request', {}), 'GitHub: create pull request')
  assert.equal(caption('mcp__chrome-devtools__navigate_page', { url: 'https://secret.example/x' }), 'Chrome DevTools: navigate page')
  assert.equal(caption('mcp__chrome-devtools__list_console_messages', {}), 'Chrome DevTools: list console messages')
  assert.equal(caption('mcp__claude_ai_Linear__list_issues', { query: 'private' }), 'Linear: list issues')
  assert.equal(caption('ToolSearch', { query: 'select:x' }), 'Load more tools')
})

scenario('terminal control sequences and line breaks never reach the display', () => {
  const c = caption('Bash', { description: 'Run \u001b[2J\u001b]0;pwned\u0007tests\nnow\u202e' })
  assert.ok(!/[\u0000-\u001f\u007f-\u009f\u202e]/.test(c), JSON.stringify(c))
  assert.ok(!c.includes('\n'))
})

scenario('a result is read as done, failed or not allowed — never assumed', () => {
  assert.equal(stateOf({ result: 'x' }), 'done')
  assert.equal(stateOf({ result: 'x', isError: true }), 'failed')
  assert.equal(stateOf({ deny: 'policy' }), 'denied')
})

// ── interpreting the record ─────────────────────────────────────────────────
scenario('a truncated review preview is unknown, not clean', () => {
  const cut = { label: 'review:security:1', resultPreview: '{"lens":"security","notes":"looked at pricing and the auth middleware and' }
  assert.equal(headline(cut), null)
  assert.equal(headline({ label: 'review:security:1', resultPreview: '{"findings": [], "notes": "x"}' }), 'review found nothing')
  assert.equal(headline({ label: 'refactor:1', resultPreview: '{"changedFiles":["a.py"],"notes":"long' }), null)
  assert.equal(headline({ label: 'refactor:1', resultPreview: '{"applied":[]}' }), 'refactor: nothing worth changing')
  assert.equal(headline({ label: 'check-criteria', resultPreview: '{"iss' }), null)
})

scenario('an empty field never borrows the next field’s content', () => {
  const p = '{"decision":"stop","rationale":"r","mustFix":[],"polish":[],"conflicts":[],"deferred":[{"finding":"cache key misses x","why":"later"}]}'
  assert.equal(headline({ label: 'iterate:1', resultPreview: p }), 'decided to stop')
  assert.equal(headline({ label: 'implement:1', resultPreview: '{"status":"done","changedFiles":"n/a","punted":["a.py"]}' }), null)
  const real = '{"decision":"stop","conflicts":[{"finding":"plan says keep the old API"}]}'
  assert.equal(headline({ label: 'iterate:1', resultPreview: real }), 'PLAN CONFLICT — plan says keep the old API')
})

scenario('raw tool summaries never enter the model', () => {
  const m = summarize(run({ agents: [agent({ label: 'implement:1', lastToolName: 'Bash', lastToolSummary: 'cat secrets.env' })] }), T0)
  assert.ok(!JSON.stringify(m).includes('secrets.env'))
})

scenario('one refresh becomes one view: none, unavailable, or the selected run', () => {
  assert.equal(viewFor({ found: { dir: null, reason: 'session identity unavailable' }, now: T0 }).reason, 'session identity unavailable')
  assert.equal(viewFor({ found: { dir: '/d' }, records: [], problems: ['wf_a.json unreadable or partially written'], now: T0 }).kind, 'unavailable')
  assert.equal(viewFor({ found: { dir: '/d' }, records: [], problems: [], now: T0 }).kind, 'none')
  const v = viewFor({ found: { dir: '/d' }, records: [{ ...run(), stale: true }], problems: ['x'], now: T0 })
  assert.equal(v.kind, 'run')
  assert.equal(v.stale, true)
  assert.equal(v.problem, 'x')
})

scenario('retried agents are still recognized', () => {
  assert.equal(headline({ label: 'verify:1.0 (retry 2)', resultPreview: '{"passed":true}' }), 'verification passed')
})

scenario('a killed run shows nobody live and freezes its time', () => {
  const d = run({ status: 'killed', durationMs: 61_000, agents: [agent({ label: 'implement:1', agentId: 'e1' })] })
  const m = summarize(d, T0 + 3_600_000)
  assert.equal(m.live.length, 0)
  assert.equal(m.elapsed.ms, 61_000)
  assert.equal(m.lifecycle.text, 'stopped (killed)')
  assert.deepEqual(m.next, [])
})

scenario('process status and outcome stay separate', () => {
  assert.equal(lifecycle({ status: 'completed', result: { outcome: 'awaiting-plan-approval' } }).text, 'plan ready — waiting for your approval')
  assert.equal(lifecycle({ status: 'completed', result: { outcome: 'needs-attention' } }).text, 'finished — needs your attention')
  assert.equal(lifecycle({ status: 'completed', result: null }).text, 'finished — outcome not recorded')
  assert.equal(lifecycle({ status: 'failed' }).terminal, true)
  assert.equal(lifecycle({ status: 'running' }).terminal, false)
})

scenario('missing timestamps are unknown, not zero', () => {
  assert.equal(runElapsed({ status: 'running' }, T0).ms, null)
  assert.equal(runElapsed({ status: 'completed' }, T0).ms, null)
  const m = summarize(run({ agents: [agent({ label: 'implement:1', startedAt: undefined })] }), T0)
  assert.equal(m.live[0].elapsedMs, null)
})

scenario('possible next stages, conditional ones marked, no percent', () => {
  const planning = summarize(run({ agents: [agent({ label: 'plan', phaseTitle: 'Plan' })] }), T0)
  assert.deepEqual(planning.next, ['your approval'])
  const building = summarize(run({ agents: [agent({ label: 'implement:1', phaseTitle: 'Implement' })] }), T0)
  assert.deepEqual(building.next, ['Refactor', 'Verify ∥ Review', 'Iterate', 'another round (only if blocking findings)', 'Polish (if needed)'])
  assert.deepEqual(nextStages({ status: 'completed', result: { outcome: 'awaiting-plan-approval' } }, 'Plan')[0], 'your approval')
  const text = JSON.stringify(building)
  assert.ok(!/%|percent|eta\b/i.test(text.replace(/"next":\[[^\]]*\]/, '')))
})

scenario('a running run beats a newer finished one; an explicit id wins; runs link only by run dir', () => {
  const a = run({ runId: 'old-running', startTime: T0 - 900_000 })
  const b = run({ runId: 'new-done', status: 'completed', startTime: T0 - 10_000 })
  const other = { ...run({ runId: 'x' }), workflowName: 'something-else', startTime: T0 }
  assert.equal(selectRun([b, a, other]).runId, 'old-running')
  assert.equal(selectRun([b, a], { runId: 'new-done' }).runId, 'new-done')
  const plan = run({ runId: 'plan', status: 'completed', result: { outcome: 'awaiting-plan-approval' } })
  const elsewhere = run({ runId: 'near-in-time', args: { runDir: '/runs/other' } })
  assert.deepEqual(relatedRuns([a, plan, elsewhere], a).map((r) => r.runId), ['plan'])
})

// ── reading this session only ───────────────────────────────────────────────
function memoryFs(files, { failList = false } = {}) {
  const reads = []
  const exists = []
  const list = async (dir) => {
    if (failList) throw new Error('EACCES')
    const out = new Map()
    for (const [p, f] of Object.entries(files)) {
      if (!p.startsWith(`${dir}/`)) continue
      const [name, ...rest] = p.slice(dir.length + 1).split('/')
      out.set(name, rest.length ? { name, kind: 'dir', size: 0, mtimeMs: 0 } : { name, kind: 'file', size: f.size ?? f.text.length, mtimeMs: f.mtimeMs ?? 1 })
    }
    if (!out.size && !Object.keys(files).some((p) => p.startsWith(`${dir}/`))) throw new Error('ENOENT')
    return [...out.values()]
  }
  return {
    reads, exists,
    fsx: {
      list,
      exists: async (p) => { exists.push(p); return Object.keys(files).some((k) => k === p || k.startsWith(`${p}/`)) },
      read: async (p) => { reads.push(p); if (!files[p]) throw new Error('ENOENT'); return files[p].text },
    },
  }
}
const P = '/home/dev/.claude/projects'
const MINE = '11111111-2222-3333-4444-555555555555'
const THEIRS = '99999999-8888-7777-6666-555555555555'

scenario('the project directory is named the way Claude names it', () => {
  assert.equal(projectSlug('/home/k/src/masterclaude.feat-x'), '-home-k-src-masterclaude-feat-x')
})

scenario('concurrent sessions in one project and across projects: only this one is found and read', async () => {
  const files = {
    [`${P}/-work-app/${THEIRS}/workflows/wf_t.json`]: { text: JSON.stringify(run({ runId: 'theirs' })) },
    [`${P}/-work-other/${THEIRS}/workflows/wf_u.json`]: { text: JSON.stringify(run({ runId: 'theirs-2' })) },
    [`${P}/-work-moved/${MINE}/workflows/wf_m.json`]: { text: JSON.stringify(run({ runId: 'mine' })) },
  }
  const w = memoryFs(files)
  // The session moved (its cwd no longer names its project directory), so the bounded scan runs.
  const found = await locateSessionDir(w.fsx, { projectsDir: P, sessionId: MINE, candidates: ['/work/app'] })
  assert.equal(found.dir, `${P}/-work-moved/${MINE}`)
  assert.ok(w.exists.every((p) => p.endsWith(`/${MINE}`)), 'only asks for a directory named by this session')
  const { records } = await readSessionRuns(w.fsx, found.dir)
  assert.deepEqual(records.map((r) => r.runId), ['mine'])
  assert.ok(w.reads.every((p) => p.includes(`/${MINE}/`)))
})

scenario('with the transcript path, the session directory is exact and nothing is searched', async () => {
  const w = memoryFs({
    [`${P}/-work-app/${THEIRS}/workflows/wf_t.json`]: { text: '{}' },
    [`${P}/-old-place/${MINE}/workflows/wf_m.json`]: { text: '{}' },
  })
  const found = await locateSessionDir(w.fsx, { projectsDir: P, sessionId: MINE, transcriptPath: `${P}/-old-place/${MINE}.jsonl`, candidates: ['/work/app'] })
  assert.equal(found.dir, `${P}/-old-place/${MINE}`)
  assert.deepEqual(w.exists, [`${P}/-old-place/${MINE}`])
  const notYet = await locateSessionDir(w.fsx, { projectsDir: P, sessionId: MINE, transcriptPath: `${P}/-new/${MINE}.jsonl` })
  assert.equal(notYet.dir, null)
  assert.equal(w.exists.length, 2, 'no scan when the transcript says where the session lives')
  // Another session's transcript path is never trusted for this session.
  const wrong = await locateSessionDir(w.fsx, { projectsDir: P, sessionId: MINE, transcriptPath: `${P}/-work-app/${THEIRS}.jsonl`, scan: false })
  assert.equal(wrong.dir, null)
})

scenario('no session identity, or no projects directory: an honest reason, no reads', async () => {
  const w = memoryFs({})
  assert.equal((await locateSessionDir(w.fsx, { projectsDir: P, sessionId: undefined })).reason, 'session identity unavailable')
  assert.equal((await locateSessionDir(w.fsx, { projectsDir: P, sessionId: '../../etc' })).reason, 'session identity unavailable')
  assert.equal((await locateSessionDir(w.fsx, { projectsDir: null, sessionId: MINE })).reason, 'Claude config directory unknown')
  assert.equal(w.reads.length, 0)
})

scenario('a half-written record keeps the last good read with its original time; a vanished one goes', async () => {
  const dir = `${P}/-w/${MINE}`
  const file = `${dir}/workflows/wf_a.json`
  const files = { [file]: { text: JSON.stringify(run({ runId: 'a' })), mtimeMs: 10 } }
  const w = memoryFs(files)
  const cache = new Map()
  const first = await readSessionRuns(w.fsx, dir, { cache })
  assert.equal(first.records[0].sourceMtimeMs, 10)
  files[file] = { text: '{"workflowName":"masterdevs-feature-lo', mtimeMs: 11 }
  const torn = await readSessionRuns(w.fsx, dir, { cache })
  assert.equal(torn.records[0].stale, true)
  assert.equal(torn.records[0].sourceMtimeMs, 10)
  assert.match(torn.problems[0], /partially written/)
  delete files[file]
  files[`${dir}/workflows/wf_b.json`] = { text: JSON.stringify(run({ runId: 'b' })) }
  const after = await readSessionRuns(w.fsx, dir, { cache })
  assert.deepEqual(after.records.map((r) => r.runId), ['b'])
  assert.ok(!cache.has('wf_a.json'))
})

scenario('oversized, malformed and unreadable sources are reported, not thrown', async () => {
  const dir = `${P}/-w/${MINE}`
  const w = memoryFs({
    [`${dir}/workflows/wf_big.json`]: { text: '{}', size: 50_000_000 },
    [`${dir}/workflows/wf_bad.json`]: { text: '[1,2' },
    [`${dir}/workflows/notes.txt`]: { text: 'x' },
  })
  const out = await readSessionRuns(w.fsx, dir)
  assert.equal(out.records.length, 0)
  assert.equal(out.problems.length, 2)
  assert.ok(!w.reads.some((p) => p.endsWith('wf_big.json')), 'never reads a file over the cap')
  const denied = await readSessionRuns(memoryFs({ [`${dir}/workflows/wf_a.json`]: { text: '{}' } }, { failList: true }).fsx, dir)
  assert.deepEqual(denied, { records: [], problems: ['workflow records unreadable'] })
  const nothingYet = await readSessionRuns(memoryFs({}, { failList: true }).fsx, dir)
  assert.deepEqual(nothingYet, { records: [], problems: [] })
})

// While a run is going Claude keeps only a journal; the full record appears when it ends.
const journal = (...events) => events.map((e) => JSON.stringify(e)).join('\n') + '\n'
const LIVE = journal(
  { type: 'launched' },
  { type: 'started', key: 'k1', agentId: 'a1', label: 'refine', phase: 'Refine' },
  { type: 'result', key: 'k1', agentId: 'a1', result: { requirements: 'Ctrl+D opens a dialog' } },
  { type: 'started', key: 'k2', agentId: 'a2', label: 'plan', phase: 'Plan' },
  { type: 'started', key: 'k3', agentId: 'a3', label: 'check-criteria', phase: 'Plan' },
  { type: 'result', key: 'k3', agentId: 'a3', result: { issues: [] } },
)
const liveFiles = (dir, extra = {}) => ({
  [`${dir}/subagents/workflows/wf_live-1/journal.jsonl`]: { text: LIVE, mtimeMs: T0 - 1_000 },
  [`${dir}/subagents/workflows/wf_live-1/agent-a1.meta.json`]: { text: '{}', mtimeMs: T0 - 120_000 },
  [`${dir}/subagents/workflows/wf_live-1/agent-a1.jsonl`]: { text: '', mtimeMs: T0 - 60_000 },
  [`${dir}/subagents/workflows/wf_live-1/agent-a2.meta.json`]: { text: '{}', mtimeMs: T0 - 59_000 },
  [`${dir}/subagents/workflows/wf_live-1/agent-a2.jsonl`]: { text: '', mtimeMs: T0 - 2_000 },
  [`${dir}/subagents/workflows/wf_live-1/agent-a3.meta.json`]: { text: '{}', mtimeMs: T0 - 59_000 },
  [`${dir}/subagents/workflows/wf_live-1/agent-a3.jsonl`]: { text: '', mtimeMs: T0 - 30_000 },
  ...extra,
})

scenario('a run still going is read from its journal, with times from its files', async () => {
  const dir = `${P}/-w/${MINE}`
  const w = memoryFs(liveFiles(dir))
  const { records, problems } = await readSessionRuns(w.fsx, dir)
  assert.deepEqual(problems, [])
  assert.equal(records.length, 1)
  const m = summarize(records[0], T0)
  assert.equal(m.lifecycle.status, 'running')
  assert.equal(m.phase, 'Plan')
  assert.deepEqual(m.live.map((a) => [a.label, a.elapsedMs]), [['plan', 59_000]])
  assert.equal(m.elapsed.ms, 120_000)
  assert.equal(m.sourceAgeMs, 2_000)
  assert.equal(m.lastFinished.headline, 'success criteria check out')
  assert.equal(m.lastFinished.elapsedMs, 29_000)
})

scenario('once the run ends, its final record replaces the journal', async () => {
  const dir = `${P}/-w/${MINE}`
  const w = memoryFs(liveFiles(dir, {
    [`${dir}/workflows/wf_live-1.json`]: { text: JSON.stringify(run({ runId: 'wf_live-1', status: 'failed', durationMs: 56_000 })), mtimeMs: T0 },
  }))
  const { records } = await readSessionRuns(w.fsx, dir)
  assert.equal(records.length, 1)
  assert.equal(records[0].status, 'failed')
})

scenario('a resumed run is live again: a journal newer than its final record wins, timed from the resume', async () => {
  const dir = `${P}/-w/${MINE}`
  // The first attempt failed and was recorded at T0 - 300s; the resume started agent a9 at T0 - 40s.
  const resumed = LIVE + journal({ type: 'failed', key: 'k2', agentId: 'a2' },
    { type: 'started', key: 'k2', agentId: 'a9', label: 'plan (retry 1)', phase: 'Plan' })
  const files = liveFiles(dir, {
    [`${dir}/workflows/wf_live-1.json`]: { text: JSON.stringify(run({ runId: 'wf_live-1', status: 'failed', durationMs: 56_000 })), mtimeMs: T0 - 300_000 },
    [`${dir}/subagents/workflows/wf_live-1/journal.jsonl`]: { text: resumed, mtimeMs: T0 - 1_000 },
    [`${dir}/subagents/workflows/wf_live-1/agent-a1.meta.json`]: { text: '{}', mtimeMs: T0 - 500_000 },
    [`${dir}/subagents/workflows/wf_live-1/agent-a1.jsonl`]: { text: '', mtimeMs: T0 - 450_000 },
    [`${dir}/subagents/workflows/wf_live-1/agent-a3.meta.json`]: { text: '{}', mtimeMs: T0 - 400_000 },
    [`${dir}/subagents/workflows/wf_live-1/agent-a3.jsonl`]: { text: '', mtimeMs: T0 - 380_000 },
    [`${dir}/subagents/workflows/wf_live-1/agent-a2.meta.json`]: { text: '{}', mtimeMs: T0 - 400_000 },
    [`${dir}/subagents/workflows/wf_live-1/agent-a2.jsonl`]: { text: '', mtimeMs: T0 - 350_000 },
    [`${dir}/subagents/workflows/wf_live-1/agent-a9.meta.json`]: { text: '{}', mtimeMs: T0 - 40_000 },
    [`${dir}/subagents/workflows/wf_live-1/agent-a9.jsonl`]: { text: '', mtimeMs: T0 - 1_000 },
  })
  const { records } = await readSessionRuns(memoryFs(files).fsx, dir)
  assert.equal(records.length, 1, 'the old final record must not show beside the live run')
  const m = summarize(records[0], T0)
  assert.equal(m.lifecycle.status, 'running')
  assert.equal(records[0].inferred, false, 'its recorded name already made it a masterdevs run')
  assert.deepEqual(m.live.map((a) => a.label), ['plan'])
  assert.equal(m.live[0].retry, true)
  assert.equal(m.elapsed.ms, 40_000, 'time counts from the resume, not the first attempt')
  assert.equal(m.resumedAfter, T0 - 300_000)
})

scenario('a journal is only a masterdevs run when launched as one, or when it starts like one', () => {
  const files = new Map()
  const other = journal({ type: 'started', key: 'k', agentId: 'x', label: 'scan-repo', phase: 'Scan' })
  assert.equal(journalRecord('wf_x', other, files), null)
  assert.equal(journalRecord('wf_x', other, files, { known: true }).inferred, false)
  assert.equal(journalRecord('wf_x', LIVE, files).inferred, true)
})

scenario('a journal line still being written is skipped, not misread', () => {
  const r = journalRecord('wf_x', LIVE + '{"type":"result","key":"k2","agentId":"a2","res', new Map())
  assert.equal(r.workflowProgress.find((a) => a.agentId === 'a2').state, 'progress')
  const failed = journalRecord('wf_x', LIVE + journal({ type: 'failed', key: 'k2', agentId: 'a2' }), new Map())
  assert.equal(failed.workflowProgress.find((a) => a.agentId === 'a2').state, 'error')
})

scenario('only what the model needs is kept between polls', async () => {
  const dir = `${P}/-w/${MINE}`
  const w = memoryFs({ [`${dir}/workflows/wf_a.json`]: { text: JSON.stringify({ ...run(), script: 'S'.repeat(5000), args: { brief: 'B'.repeat(5000), runDir: '/r' } }) } })
  const { records } = await readSessionRuns(w.fsx, dir)
  assert.ok(JSON.stringify(records).length < 2000)
  assert.equal(records[0].args.runDir, '/r')
})

// ── drawing ─────────────────────────────────────────────────────────────────
const live3 = run({ agents: [
  agent({ index: 1, label: 'verify:1.0', phaseTitle: 'Verify', agentId: 'v' }),
  agent({ index: 2, label: 'review:reviewer:1', phaseTitle: 'Review', agentId: 'r' }),
  agent({ index: 3, label: `review:${'x'.repeat(200)}:1 (retry 1)`, phaseTitle: 'Review', agentId: 'r2' }),
] })
const longTails = () => {
  let t = {}
  for (let i = 1; i <= 8; i++) t = observe(t, 'v', obs(`v${i}`, i, `Run a very long described check number ${i} `.repeat(6)))
  t = observe(t, 'r', obs('r1', 20, 'Read pricing.py'))
  return t
}

scenario('every pane line fits the width; a section is one header plus at most six lines', () => {
  for (const width of [20, 48, 80, 160]) {
    const lines = paneLines({ view: { kind: 'run', model: summarize(live3, T0) }, tails: longTails(), samples: {}, width, rows: 60 })
    for (const l of lines) assert.ok(l.text.length <= width, `${width}: ${l.text}`)
    const at = lines.findIndex((l) => l.tone === 'header')
    if (width >= 20) assert.ok(lines[at].text.startsWith('VERIFIER'), lines[at].text)
    const body = []
    for (let i = at + 1; i < lines.length && lines[i].tone !== 'header' && lines[i].text !== ''; i++) body.push(lines[i])
    assert.equal(body.length, 6)
  }
})

scenario('newest activity is at the bottom of its section', () => {
  const lines = paneLines({ view: { kind: 'run', model: summarize(live3, T0) }, tails: longTails(), samples: {}, width: 200, rows: 60 })
  const at = lines.findIndex((l) => l.text.startsWith('VERIFIER'))
  assert.match(lines[at + 1].text, /number 3 /)
  assert.match(lines[at + 6].text, /number 8 /)
})

scenario('a short pane shows fewer sections and counts the rest, without padding', () => {
  const lines = paneLines({ view: { kind: 'run', model: summarize(live3, T0) }, tails: longTails(), samples: {}, width: 80, rows: 14 })
  assert.ok(lines.length <= 14, String(lines.length))
  assert.ok(lines.some((l) => /^\+\d more agent/.test(l.text)))
  const empty = paneLines({ view: { kind: 'run', model: summarize(live3, T0) }, tails: {}, samples: {}, width: 80, rows: 60 })
  assert.equal(empty.filter((l) => l.text === 'no activity observed yet').length, 3)
})

scenario('sampled history is labeled; observed history is not', () => {
  const m = summarize(live3, T0)
  const samples = sample({}, [{ ...m.live[1], lastToolName: 'Read', toolCalls: 2 }], 1)
  const lines = paneLines({ view: { kind: 'run', model: m }, tails: longTails(), samples, width: 120, rows: 60 })
  assert.ok(lines.some((l) => l.text.startsWith('REVIEWER · review:reviewer:1') && !l.text.includes('(sampled)')), 'observed wins')
  const onlySampled = paneLines({ view: { kind: 'run', model: m }, tails: {}, samples, width: 120, rows: 60 })
  assert.ok(onlySampled.some((l) => l.text.startsWith('REVIEWER · review:reviewer:1 (sampled)')))
})

scenario('roles follow the agent that acted: a reviewer is never headed as an engineer', () => {
  const m = summarize(live3, T0)
  assert.deepEqual(m.live.map((a) => a.role), ['VERIFIER', 'REVIEWER', 'REVIEWER'])
  assert.equal(m.live[2].retry, true)
})

scenario('a quiet agent is "no recorded progress", not "stalled"; source age ignores redraws', () => {
  const d = run({ agents: [agent({ label: 'verify:1.0', phaseTitle: 'Verify', lastProgressAt: T0 - 15 * 60_000 })] })
  const lines = paneLines({ view: { kind: 'run', model: summarize(d, T0) }, tails: {}, samples: {}, width: 120, rows: 30 })
  const facts = lines[1].text
  assert.match(facts, /no recorded progress for 15m — may still be working/)
  assert.ok(!/stall|stuck/i.test(facts))
})

scenario('CLI and pane agree on the same record', () => {
  const d = run({ agents: [
    agent({ index: 1, label: 'review:reviewer:1', state: 'done', durationMs: 5000,
      resultPreview: '{"findings":[{"severity":"high","file":"src/pricing.py","line":900,"summary":"Totals double count"}]}' }),
    agent({ index: 2, label: 'iterate:1', phaseTitle: 'Iterate', agentId: 'i', lastToolName: 'Read', toolCalls: 3 }),
  ] })
  const cli = statusLines(d, T0, '2:47 PM').join('\n')
  const pane = paneLines({ view: { kind: 'run', model: summarize(d, T0) }, tails: {}, samples: {}, width: 200, rows: 30 }).map((l) => l.text).join('\n')
  const said = 'review:reviewer:1 → review — high in pricing.py:900: Totals double count'
  assert.ok(cli.includes(said), cli)
  assert.ok(pane.includes(said), pane)
  assert.ok(cli.includes('Iterate') && pane.includes('Iterate'))
  assert.ok(cli.includes('10m total'))
})

// ── ETA ─────────────────────────────────────────────────────────────────────
const MIN = 60_000
const hhmm = (ms) => { const d = new Date(ms); return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}` }
const pastBuild = (runId, minutesAfterImplement, extra = {}) => ({ runId, kind: 'build', end: T0 - 86_400_000 + minutesAfterImplement * MIN,
  phases: { Implement: T0 - 86_400_000 }, ...extra })
const building = (o = {}) => run({ agents: [agent({ label: 'implement:1', phaseTitle: 'Implement', startedAt: T0 - 10 * MIN })], ...o })

scenario('ETA: a range from past runs that reached the same phase, measured from when this run reached it', () => {
  const h = [pastBuild('a', 20), pastBuild('b', 30), pastBuild('c', 40), pastBuild('d', 60), pastBuild('e', 90)]
  const e = estimate(h, building(), T0)
  assert.equal(e.n, 5)
  assert.equal(e.at, T0 - 10 * MIN + 40 * MIN) // median
  assert.equal(e.lo, T0 - 10 * MIN + 30 * MIN)
  assert.equal(e.hi, T0 - 10 * MIN + 60 * MIN)
  assert.equal(etaText(e, T0, hhmm), `ETA ~${hhmm(e.at)} (${hhmm(e.lo)}–${hhmm(e.hi)}, from 5 past runs)`)
})

scenario('ETA: none below three runs, none from the other kind, none for a finished run', () => {
  assert.equal(estimate([pastBuild('a', 20), pastBuild('b', 30)], building(), T0).at, null)
  assert.match(etaText(estimate([pastBuild('a', 20)], building(), T0), T0, hhmm), /ETA unknown — needs 3 timed past runs, has 1/)
  const plans = ['a', 'b', 'c'].map((id) => pastBuild(id, 30, { kind: 'plan' }))
  assert.equal(estimate(plans, building(), T0).n, 0)
  assert.equal(estimate([pastBuild('a', 20), pastBuild('b', 30), pastBuild('c', 40)], building({ status: 'completed' }), T0), null)
})

scenario('ETA: past the usual finish says so instead of inventing a time; a passed median falls back to the range end', () => {
  const h = [pastBuild('a', 20), pastBuild('b', 30), pastBuild('c', 40)]
  const late = estimate(h, building(), T0 + 60 * MIN)
  assert.equal(late.overdue, true)
  assert.match(etaText(late, T0 + 60 * MIN, hhmm), /^running past the usual finish \(most past runs done by /)
  const between = estimate(h, building(), T0 + 25 * MIN) // median passed, upper end not yet
  assert.match(etaText(between, T0 + 25 * MIN, hhmm), new RegExp(`^ETA by ${hhmm(between.hi)} `))
})

scenario('ETA: the planning call says "plan ready", and is estimated only from planning runs', () => {
  const plans = [10, 20, 30].map((m, i) => ({ runId: `p${i}`, kind: 'plan', end: T0 + m * MIN, phases: { Refine: T0 } }))
  const d = run({ agents: [agent({ label: 'refine', phaseTitle: 'Refine', startedAt: T0 - MIN })] })
  assert.match(etaText(estimate(plans, d, T0), T0, hhmm), /^plan ready ~/)
})

scenario('ETA history: timing only, normal finishes only, newest kept, one entry per run', () => {
  const done = (o) => run({ status: 'completed', durationMs: 50 * MIN, result: { outcome: 'passed' },
    agents: [agent({ label: 'implement:1', phaseTitle: 'Implement', state: 'done', resultPreview: 'secret result' })], ...o })
  const s = runSpans(done())
  assert.deepEqual(Object.keys(s).sort(), ['end', 'kind', 'phases', 'runId'])
  assert.ok(!JSON.stringify(s).includes('secret'))
  assert.equal(s.end, T0 - 600_000 + 50 * MIN)
  assert.equal(runSpans(done({ status: 'killed' })), null)
  assert.equal(runSpans(done({ result: { outcome: 'needs-clarification' } })), null, 'a run that stopped early would pull the estimate short')
  assert.equal(runSpans(done({ result: { outcome: 'error' } })), null)
  assert.equal(runSpans(run()), null, 'a live run has no finish to learn from')
  const many = Array.from({ length: MAX_RUNS + 5 }, (_, i) => pastBuild(`r${i}`, i))
  const kept = addRuns([pastBuild(`r${MAX_RUNS + 4}`, 0)], many)
  assert.equal(kept.length, MAX_RUNS)
  assert.equal(kept.filter((r) => r.runId === `r${MAX_RUNS + 4}`).length, 1)
  assert.equal(kept[0].runId, `r${MAX_RUNS + 4}`, 'the newer reading of a run replaces the older')
})

scenario('ETA seeding scan: newest records first, bounded reads, skips what it already has and oversized files', async () => {
  const files = new Map()
  const rec = (runId, end) => JSON.stringify(run({ runId, status: 'completed', startTime: end - 30 * MIN, durationMs: 30 * MIN,
    result: { outcome: 'passed' }, agents: [agent({ label: 'implement:1', phaseTitle: 'Implement', state: 'done', startedAt: end - 30 * MIN })] }))
  for (let i = 0; i < 6; i++) files.set(`/p/proj${i % 2}/s${i}/workflows/wf_r${i}.json`, { text: rec(`wf_r${i}`, T0 + i), mtimeMs: i })
  files.set('/p/proj0/big/workflows/wf_big.json', { text: 'x'.repeat(100_000), mtimeMs: 99 })
  const reads = []
  const fsx = {
    list: async (dir) => {
      const out = new Map()
      for (const [p, f] of files) {
        if (!p.startsWith(`${dir}/`)) continue
        const [name, ...rest] = p.slice(dir.length + 1).split('/')
        out.set(name, rest.length ? { name, kind: 'dir' } : { name, kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs })
      }
      if (!out.size) throw new Error('ENOENT')
      return [...out.values()]
    },
    read: async (p) => { reads.push(p); return files.get(p).text },
  }
  const got = await scanPastRuns(fsx, '/p', { skip: new Set(['wf_r5']), maxReads: 3, maxBytes: 50_000 })
  assert.deepEqual(got.map((r) => r.runId), ['wf_r4', 'wf_r3', 'wf_r2'])
  assert.ok(!reads.some((p) => p.includes('big')))
})

scenario('pane: the ETA gets its own line under the title, and none once the run is over', () => {
  const h = [pastBuild('a', 20), pastBuild('b', 30), pastBuild('c', 40)]
  const d = building()
  const view = viewFor({ found: { dir: '/s' }, records: [d], now: T0 })
  const lines = paneLines({ view: { ...view, eta: estimate(h, d, T0) }, tails: {}, samples: {}, width: 80, clock: hhmm })
  assert.match(lines[1].text, /^ETA ~/)
  const over = { ...d, status: 'completed', durationMs: MIN, result: { outcome: 'passed' } }
  const ended = paneLines({ view: { ...viewFor({ found: { dir: '/s' }, records: [over], now: T0 }), eta: estimate(h, over, T0) }, tails: {}, samples: {}, width: 80, clock: hhmm })
  assert.ok(!ended.some((l) => /ETA|plan ready/.test(l.text)))
})

scenario('activity lines carry the time they first appeared, kept through later updates', () => {
  let t = observe({}, 'a', { id: 'c1', seq: 1, at: T0, text: 'Run unit tests', state: 'started' })
  t = observe(t, 'a', { id: 'c1', seq: 2, at: T0 + 90_000, text: 'Run unit tests', state: 'done' })
  assert.equal(t.a[0].at, T0, 'finishing must not move the time the line appeared')
  const s = sample({}, [{ key: 'k', lastToolName: 'Bash', toolCalls: 3 }], 1, TAIL, T0 + 5_000)
  assert.equal(s.k[0].at, T0 + 5_000, 'a sampled line is stamped with the read that saw it')
  const view = viewFor({ found: { dir: '/s' }, records: [run({ agents: [agent({ label: 'implement:1', phaseTitle: 'Implement', agentId: 'a' })] })], now: T0 })
  const stamp = (ms) => `@${(ms - T0) / 1000}s`
  const wide = paneLines({ view, tails: t, samples: {}, width: 60, stamp }).map((l) => l.text)
  const row = wide.find((x) => x.startsWith('Run unit tests'))
  assert.ok(row.endsWith('@0s') && row.length === 60, `right-aligned to the width: "${row}"`)
  const narrow = paneLines({ view, tails: t, samples: {}, width: 30, stamp }).map((l) => l.text)
  assert.ok(narrow.includes('Run unit tests'), 'a narrow pane drops the time, not the action')
})

scenario('step markers: only the exact file and line shape count, cleaned like any other line', () => {
  const at = (content, file_path = '/runs/r1/progress/implement-1-3.txt') => progressOf('Write', { file_path, content })
  assert.deepEqual(at('Step 3 of 7: Add the shortcut listener'), { kind: 'step', step: 3, of: 7, title: 'Add the shortcut listener' })
  assert.deepEqual(at('Fix 1 of 2: Close the dialog on Escape\nextra'), { kind: 'fix', step: 1, of: 2, title: 'Close the dialog on Escape' })
  assert.equal(at('Step 3 of 7: x', '/repo/src/progress.txt'), null, 'any other file is ordinary work')
  assert.equal(at('Step 9 of 7: x'), null)
  assert.equal(at('step 3 of 7: lower case'), null)
  assert.equal(at('Working on it'), null)
  assert.equal(progressOf('Edit', { file_path: '/runs/r1/progress/implement-1-3.txt', content: 'Step 3 of 7: x' }), null)
  assert.ok(!at('Step 1 of 2: a\u202eb').title.includes('\u202e'))
  assert.equal(caption('Write', { file_path: '/runs/r1/progress/implement-1-3.txt', content: 'Step 3 of 7: Add it' }), 'Start step 3 of 7')
})

scenario('pane: the step shows in the headline and under the agent, and not once the run is over', () => {
  const d = run({ agents: [agent({ label: 'implement:1', phaseTitle: 'Implement', agentId: 'eng' })] })
  const progress = { eng: { kind: 'step', step: 3, of: 7, title: 'Add the shortcut listener' } }
  const lines = paneLines({ view: viewFor({ found: { dir: '/s' }, records: [d], now: T0 }), tails: {}, samples: {}, progress, width: 80 }).map((l) => l.text)
  assert.ok(lines[0].startsWith('MasterDevs · Implement · step 3 of 7 · running'), lines[0])
  const header = lines.findIndex((l) => l.startsWith('ENGINEER · implement:1'))
  assert.equal(lines[header + 1], 'Step 3 of 7 · Add the shortcut listener')
  const over = { ...d, status: 'completed', durationMs: 60_000, result: { outcome: 'passed' } }
  const ended = paneLines({ view: viewFor({ found: { dir: '/s' }, records: [over], now: T0 }), tails: {}, samples: {}, progress, width: 80 })
  assert.ok(!ended[0].text.includes('step 3 of 7'))
})

// ── runner ──────────────────────────────────────────────────────────────────
let failed = 0
for (const s of scenarios) {
  try {
    await s.check()
    console.log(`✓ ${s.name}`)
  } catch (e) {
    failed++
    console.log(`✗ ${s.name}\n    ${String(e.message).split('\n').join('\n    ')}`)
  }
}
console.log(`\n${scenarios.length - failed}/${scenarios.length} scenarios passed`)
process.exit(failed ? 1 : 0)
