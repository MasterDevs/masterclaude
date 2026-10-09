// Per-agent rolling activity: what each workflow agent actually did, newest at the bottom, at most
// six lines. Pure — the pane feeds it observations and stores what it returns.
//
// Two sources, never mixed in one agent's history:
//   - observed: the host's tool.call event for that agent's own loop (matched by exact agent id),
//     seen once as it starts and once as it finishes. Every action shows, even several between polls.
//   - sampled: the workflow record's "last tool" field, read every few seconds. It misses whatever
//     happened between reads, so a sampled history is labeled as such.
//
// Captions are built from the tool's NAME, a safe file basename, and the short description the agent
// gave the call — never the command, the code, a prompt, or a raw result.

import { base, clean, doing, short } from './run-status.mjs'

export const TAIL = 6
export const MAX_AGENTS = 24

const fileOf = (input) => base(input?.file_path || input?.notebook_path || input?.path)
const said = (input, n = 72) => short(input?.description, n)
const hostOf = (url) => {
  // Host only: never the path, the query, or any user:password@ in front of the host.
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#@\s]*@)?([^/?#:@\s]+)/i.exec(String(url || ''))
  return m ? clean(m[1]) : null
}

// When a shell call has no description of its own, say what it is doing in plain words — "Read files
// and search the code", "Run tests" — from the shape of the command alone (no model call). Only these
// fixed phrases are ever shown: never a program name, argument, path, flag or value.
//
// Each simple command (split on ; && || | and newlines, quoted text and heredoc bodies removed) is
// matched to one intent; the line names the two that matter most, in this order — at most 10 words.
// A reader fed by a pipe (`… | tail`, `… | grep x`) only trims what the command before it printed,
// so it adds nothing.
const INTENTS = [
  ['test', 'run tests'],
  ['check', 'check the code'],
  ['build', 'build the app'],
  ['install', 'install packages'],
  ['remove', 'delete files'],
  ['write', 'change files'],
  ['commit', 'save changes in git'],
  ['history', 'look at past changes'],
  ['diff', 'compare changes'],
  ['status', 'check what changed'],
  ['db', 'query the database'],
  ['github', 'query GitHub'],
  ['fetch', 'fetch a web page'],
  ['container', 'work with containers'],
  ['app', 'start the app'],
  ['script', 'run a script'],
  ['search', 'search the code'],
  ['read', 'read files'],
  ['list', 'look through folders'],
]
const INTENT_RANK = new Map(INTENTS.map(([k], i) => [k, i]))
const PHRASE = new Map(INTENTS)

const BY_PROGRAM = {
  read: ['cat', 'head', 'tail', 'less', 'more', 'bat', 'nl', 'wc', 'jq', 'yq', 'sed', 'awk', 'cut', 'sort', 'uniq', 'column', 'xxd', 'od', 'strings'],
  list: ['ls', 'find', 'fd', 'tree', 'du', 'stat', 'file', 'realpath', 'pwd', 'which', 'basename', 'dirname'],
  search: ['grep', 'rg', 'ag', 'ack', 'egrep', 'fgrep'],
  write: ['mkdir', 'touch', 'cp', 'mv', 'tee', 'ln', 'chmod', 'patch', 'install'],
  remove: ['rm', 'rmdir', 'unlink'],
  test: ['pytest', 'jest', 'vitest', 'mocha', 'playwright', 'cypress', 'tox', 'rspec', 'phpunit'],
  check: ['eslint', 'tsc', 'ruff', 'mypy', 'pyright', 'flake8', 'pylint', 'prettier', 'biome', 'black', 'isort', 'shellcheck', 'stylelint'],
  fetch: ['curl', 'wget', 'http'],
  github: ['gh'],
  db: ['psql', 'sqlite3', 'mysql', 'redis-cli', 'mongosh'],
  container: ['docker', 'kubectl', 'podman', 'helm'],
  script: ['node', 'python', 'python3', 'ruby', 'bash', 'sh', 'zsh', 'deno', 'tsx', 'ts-node', 'perl'],
}
const PROGRAM_INTENT = new Map(Object.entries(BY_PROGRAM).flatMap(([k, ps]) => ps.map((p) => [p, k])))
const RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'npx', 'pnpx', 'bunx', 'make', 'just', 'go', 'cargo', 'uv', 'poetry', 'pipenv', 'gradle', 'mvn', 'dotnet'])
const GIT = { log: 'history', show: 'history', blame: 'history', reflog: 'history', diff: 'diff', status: 'status',
  grep: 'search', 'ls-files': 'list', add: 'commit', commit: 'commit', push: 'commit', stash: 'commit', checkout: 'write',
  switch: 'write', restore: 'write', 'rev-parse': 'status', branch: 'status', fetch: 'fetch', pull: 'fetch', 'write-tree': 'status' }

// What a package runner or build tool is being asked to do, from the words after it.
function runnerIntent(words) {
  const rest = words.filter((w) => !w.startsWith('-')).join(' ')
  if (/\b(test|tests|spec|vitest|jest|pytest|playwright|cypress|mocha)\b/.test(rest)) return 'test'
  if (/\b(lint|eslint|tsc|typecheck|type-check|check|clippy|vet|fmt|format|prettier|ruff|mypy)\b/.test(rest)) return 'check'
  if (/\b(build|compile|bundle)\b/.test(rest)) return 'build'
  if (/\b(install|add|ci|i|sync|get)\b/.test(rest)) return 'install'
  if (/\b(dev|start|serve|preview)\b/.test(rest)) return 'app'
  return 'script'
}

const LEAD = new Set(['sudo', 'env', 'time', 'nohup', 'exec', 'command', 'then', 'do', 'else', 'if', 'while', 'until', '!', 'timeout'])
const BUILTIN = new Set(['cd', 'echo', 'printf', 'true', 'false', 'export', 'set', 'unset', 'local', 'for', 'case', 'done', 'fi', 'esac', 'read', 'test', '[', 'source', '.', 'sleep', 'wait', 'exit', 'return'])

// Every intent a shell command shows, as INTENTS keys.
function shellIntents(command) {
  const found = new Set()
  let text = String(command || '')
  // A heredoc feeds a file or a program; its body is content, never commands.
  if (/<<-?\s*['"]?[A-Za-z_]+/.test(text)) {
    text = text.replace(/<<-?\s*['"]?([A-Za-z_]+)['"]?[^\n]*\n[\s\S]*?\n\s*\1\b/g, ' HEREDOC ')
  }
  // Quoted text is an argument and may hold anything (a pattern with | in it).
  text = text.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, ' Q ')
  // Output sent to a file (not to /dev/null, not one stream into another) changes files.
  if (/(^|[^0-9&<>])>>?\s*(?!&|\/dev\/null)[^\s|;&]/.test(text)) found.add('write')
  const pieces = text.split(/(&&|\|\||[;|\n()`])/)
  for (let p = 0; p < pieces.length; p += 2) {
    const piped = pieces[p - 1] === '|'
    const words = pieces[p].trim().split(/\s+/).filter(Boolean)
    let i = 0
    while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || LEAD.has(words[i]))) i++
    const prog = (words[i] || '').split('/').pop()
    if (!prog || BUILTIN.has(prog) || prog === 'Q' || prog === 'HEREDOC') continue
    const rest = words.slice(i + 1)
    if (prog === 'git') {
      const sub = rest.find((w) => !w.startsWith('-'))
      found.add(GIT[sub] || 'status')
    } else if (RUNNERS.has(prog)) {
      found.add(runnerIntent(rest))
    } else if (/^python3?$/.test(prog) && rest[0] === '-m') {
      found.add(PROGRAM_INTENT.get(rest[1]) || runnerIntent(rest.slice(1)))
    } else if (prog === 'sed' && rest.some((w) => /^-i/.test(w))) {
      found.add('write')
    } else if (PROGRAM_INTENT.has(prog)) {
      const intent = PROGRAM_INTENT.get(prog)
      if (!(piped && (intent === 'read' || intent === 'search'))) found.add(intent)
    }
  }
  return found
}

export function shellIntent(command) {
  const found = shellIntents(command)
  const top = [...found].sort((a, b) => INTENT_RANK.get(a) - INTENT_RANK.get(b)).slice(0, 2).map((k) => PHRASE.get(k))
  if (!top.length) return null
  const said = top.join(' and ')
  return said.charAt(0).toUpperCase() + said.slice(1)
}

// A build agent marks each plan step as it begins by creating <runDir>/progress/<label>-<k>.txt holding
// one line, "Step 3 of 7: Add the shortcut listener" (feature-loop.js `progressRule`). Only that exact
// shape is accepted; the title is cleaned and cut like any other line.
const PROGRESS_FILE = /\/progress\/[A-Za-z0-9-]{1,64}-\d{1,3}\.txt$/
export function progressOf(tool, input = {}) {
  if (clean(tool) !== 'Write' || !PROGRESS_FILE.test(String(input?.file_path || ''))) return null
  const m = /^(Step|Fix) (\d{1,3}) of (\d{1,3}): (.+)$/.exec(String(input?.content || '').trim().split('\n')[0])
  if (!m) return null
  const step = Number(m[2])
  const of = Number(m[3])
  const title = short(m[4], 80)
  if (step < 1 || step > of || !title) return null
  return { kind: m[1].toLowerCase(), step, of, title }
}

// An MCP tool is named mcp__<server>__<tool>. The line names both in plain words —
// "Chrome DevTools: navigate page", "Linear: list issues" — so it is clear what is being driven.
const CASING = { devtools: 'DevTools', github: 'GitHub', gitlab: 'GitLab', ai: 'AI', api: 'API', mcp: 'MCP', db: 'DB', sql: 'SQL', ui: 'UI', url: 'URL' }
const words = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_-]+/).filter(Boolean)
export function mcpCaption(name) {
  const m = /^mcp__(.+?)__(.+)$/.exec(name)
  if (!m) return null
  const server = words(m[1].replace(/^claude_ai_/, ''))
    .map((w) => CASING[w.toLowerCase()] || w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  const tool = words(m[2]).map((w) => CASING[w.toLowerCase()] || w.toLowerCase()).join(' ')
  return short(`${server}: ${tool}`, 60)
}

// One line describing a tool call, from what the call itself says.
export function caption(tool, input = {}) {
  const t = clean(tool)
  const progress = progressOf(tool, input)
  if (progress) return `Start ${progress.kind} ${progress.step} of ${progress.of}`
  const file = fileOf(input)
  switch (t) {
    case 'Read': return file ? `Read ${file}` : 'Read a file'
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return file ? `Edit ${file}` : 'Edit a file'
    case 'Write': return file ? `Write ${file}` : 'Write a file'
    case 'Bash': case 'PowerShell': return said(input) || shellIntent(input?.command) || 'Run a command'
    case 'Grep': return 'Search the codebase'
    case 'Glob': return 'Find files'
    case 'WebFetch': return hostOf(input.url) ? `Fetch docs from ${hostOf(input.url)}` : 'Fetch a web page'
    case 'WebSearch': return 'Search the web'
    case 'Agent': case 'Task': return said(input, 60) ? `Delegate: ${said(input, 60)}` : 'Delegate to a subagent'
    case 'StructuredOutput': return 'Write up the result'
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': return 'Update its task list'
    case 'ToolSearch': return 'Load more tools'
    case 'LSP': return 'Look up code symbols'
    case 'Skill': return input?.skill ? `Load skill ${short(input.skill, 40)}` : 'Load a skill'
    default: {
      return mcpCaption(t) || `Use ${short(t, 40) || 'a tool'}`
    }
  }
}

// The outcome a finished call reports. A call is never shown as done before its result arrived.
//
// A shell command's error is shown only when the command runs tests, checks the code or builds it:
// there a failure tells the person something. A command that looks around ends with an error just
// because the last thing it looked for is not there yet, and "— failed" on it is noise.
const FAILURE_MATTERS = new Set(['test', 'check', 'build'])
export function stateOf(result, tool = null, input = {}) {
  if (!result || typeof result !== 'object') return 'done'
  if ('deny' in result && result.deny !== undefined) return 'denied'
  if (!result.isError) return 'done'
  if (clean(tool) !== 'Bash') return 'failed'
  const intents = shellIntents(input?.command)
  return [...intents].some((k) => FAILURE_MATTERS.has(k)) ? 'failed' : 'done'
}

const RANK = { started: 0, sampled: 1, done: 2, failed: 2, denied: 2 }

// Adds or updates one observation in one agent's history and returns a new `tails` object.
//   obs: { id, seq, text, state, at }  — `id` is the call's own id, so its start and its completion are
//   one line whose state moves forward, while two distinct calls with the same caption stay two lines.
//   `at` is when the line first appeared (epoch ms); a later update keeps it.
export function observe(tails, agent, obs, cap = TAIL) {
  if (!agent || !obs || !obs.id) return tails
  const list = Array.isArray(tails?.[agent]) ? tails[agent] : []
  const at = list.findIndex((x) => x.id === obs.id)
  let next
  if (at >= 0) {
    const cur = list[at]
    if ((RANK[obs.state] ?? 0) < (RANK[cur.state] ?? 0)) return tails
    next = list.slice()
    next[at] = { ...cur, state: obs.state }
  } else {
    // An update for a call already evicted would only re-enter at the top and leave again.
    if (list.length >= cap && obs.seq < list[0].seq) return tails
    next = [...list, { id: obs.id, seq: obs.seq, text: obs.text, state: obs.state, ...(Number.isFinite(obs.at) ? { at: obs.at } : {}) }]
      .sort((a, b) => a.seq - b.seq)
      .slice(-cap)
  }
  return prune({ ...tails, [agent]: next })
}

// Bounds how many agents' histories are kept: the ones touched most recently win.
function prune(tails, max = MAX_AGENTS) {
  const keys = Object.keys(tails)
  if (keys.length <= max) return tails
  const newest = (k) => tails[k].reduce((m, x) => Math.max(m, x.seq), -Infinity)
  const keep = new Set(keys.sort((a, b) => newest(b) - newest(a)).slice(0, max))
  return Object.fromEntries(Object.entries(tails).filter(([k]) => keep.has(k)))
}

// Folds a batch of observations, in arrival order, into the tails.
export const observeAll = (tails, batch, cap = TAIL) =>
  batch.reduce((acc, { agent, obs }) => observe(acc, agent, obs, cap), tails || {})

// The sampled fallback: one line per change in the agent's recorded tool count. Re-reading the same
// record adds nothing, so a quiet agent's history stays still instead of filling with repeats.
// `at`: when this read happened — for a sampled line, the earliest it can be known to have happened.
export function sample(samples, live, seq, cap = TAIL, at = null) {
  let out = samples || {}
  for (const a of live) {
    if (!a.lastToolName || a.toolCalls == null) continue
    const id = `${a.key}#${a.toolCalls}`
    const text = doing(a.lastToolName)
    out = observe(out, a.key, { id, seq, at, text: text.charAt(0).toUpperCase() + text.slice(1), state: 'sampled' }, cap)
  }
  return out
}

// One line as drawn: an unfinished call is marked unfinished; a failure says so.
export const entryText = (x) =>
  x.state === 'started' ? `${x.text} …`
    : x.state === 'failed' ? `${x.text} — failed`
      : x.state === 'denied' ? `${x.text} — not allowed`
        : x.text
