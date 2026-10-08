#!/usr/bin/env node
// One or two lines saying what the run is ACTUALLY doing right now.
//
//   node run-status.mjs                 # newest running masterdevs workflow, any session
//   node run-status.mjs <runId>         # a specific run
//
// A status line exists so you can intervene when something looks wrong. "Verify (iteration 2/3) · 3
// agents · 11 min" cannot support that: it says the machine is busy, not what it is busy doing. This
// reads the per-agent state Claude Code already writes (the final record, or the live journal while
// the run is going) — which agent is live, what tool it last reached for, and what the previously
// finished agent actually returned — and reports the one or two things worth knowing.
//
// The interpretation lives in hooks/lib/run-status.mjs, shared with the live status pane, so the two
// never disagree. This file only finds the records and prints. Without a run id it searches every
// session — fine for a person at a shell; the pane uses hooks/lib/run-source.mjs, which is scoped to
// one session. It never throws and never blocks: no signal prints as "starting up", which is itself
// information.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { selectRun, statusLines } from '../hooks/lib/run-status.mjs'
import { readSessionRuns } from '../hooks/lib/run-source.mjs'

const wanted = process.argv.slice(2).find((a) => !a.startsWith('-')) || null
const PROJECTS = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects')

// The same reader the pane uses, over plain node:fs: finished runs from workflows/wf_*.json, runs
// still going from their live journal (Claude writes the full record only when a run ends).
const fsx = {
  list: async (dir) => fs.readdirSync(dir, { withFileTypes: true }).map((e) => {
    const kind = e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other'
    let st = null
    if (kind === 'file') try { st = fs.statSync(path.join(dir, e.name)) } catch { /* vanished */ }
    return { name: e.name, kind, size: st?.size ?? 0, mtimeMs: st?.mtimeMs ?? 0 }
  }),
  read: async (file) => fs.readFileSync(file, 'utf8'),
  exists: async (p) => fs.existsSync(p),
}

const dirs = (dir) => {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name)) } catch { return [] }
}

const records = []
for (const project of dirs(PROJECTS)) {
  for (const session of dirs(project)) {
    if (!fs.existsSync(path.join(session, 'workflows')) && !fs.existsSync(path.join(session, 'subagents', 'workflows'))) continue
    records.push(...(await readSessionRuns(fsx, session)).records)
  }
}
const d = selectRun(records, { runId: wanted })

if (!d) {
  console.log(wanted ? `No masterdevs run found with id ${wanted}.` : 'No masterdevs runs recorded.')
  process.exit(0)
}

const clock = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
for (const line of statusLines(d, Date.now(), clock)) console.log(line)
