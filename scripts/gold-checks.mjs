#!/usr/bin/env node
// Does the gold lane actually behave the way the lane's rules claim?
//
// Builds throwaway lanes in a temp dir, shells out to the real `gold.mjs`, and asserts on what it
// prints and what it exits with. No models, no network, milliseconds.
//
//   node scripts/gold-checks.mjs
//
// The cases exist one per rule that would be expensive to discover was wrong later: which scope wins a
// collision, that a malformed entry is refused, that a stale anchor fails in the repository it was
// captured in while a checkout that cannot judge it stays quiet, that the documented seed-merge command
// really cannot clobber a user's edit, and that --reindex cannot write outside the lane it was pointed
// at.
//
// The rot cases come in matched pairs on purpose — a failing case and the negative control that proves
// the gate, not the file system, is what separated them. A validator that reports rot from the wrong
// checkout costs a curated example its life, so each half is asserted against the other.
//
// Fixtures NEVER land in this checkout or in a real $PLAYBOOK_DIR. `.masterdevs/` is not gitignored
// here, so a stray fixture would become a tracked file.
//
// Section two checks the two skill prompts as static text. A skill cannot be executed from a test, but
// the parts of it that are load-bearing contracts — the six-question budget, the throwaway-clone
// mechanism, the mode count — are greppable, and a prompt that quietly loses one of those is exactly
// the failure this repo has already had.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GOLD = path.join(ROOT, 'plugins/masterdevs/scripts/gold.mjs')
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/masterdevs/references/gold-schema.json'), 'utf8'))
const SEEDS = path.join(ROOT, 'plugins/masterdevs/playbook-seeds/gold')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gold-'))
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })

let passed = 0
let failed = 0
const check = (name, fn) => {
  try {
    const bad = fn().filter(([ok]) => !ok)
    if (bad.length) {
      failed++
      console.log(`✗ ${name}`)
      for (const [, msg] of bad) console.log(`    ${msg}`)
    } else { passed++; console.log(`✓ ${name}`) }
  } catch (e) {
    failed++
    console.log(`✗ ${name}\n    threw: ${e.message}`)
  }
}

// ── helpers ────────────────────────────────────────────────────────────────
// One entry template built from the schema, so a schema change breaks here rather than in eight places.
const entry = ({ id, kind = 'code', domain = 'core', language = 'python', patterns = ['Guard Clause'],
  lenses = ['correctness'], scope = 'local', source = 'local', anchors = [{ path: 'src/a.py', symbol: 'thing', sha: 'abc123' }],
  notThis = 'none', body = null }) => {
  const sections = [SCHEMA.firstSection, ...SCHEMA.kinds[kind].sections]
  const rendered = body || sections.map((s) => `## ${s}\n\nplaceholder prose for ${s}.\n`).join('\n')
  return [
    '---',
    `id: ${id}`,
    `title: ${id.replace(/-/g, ' ')}`,
    `domain: ${domain}`,
    `kind: ${kind}`,
    `language: ${language}`,
    `patterns: [${patterns.join(', ')}]`,
    `lenses: [${lenses.join(', ')}]`,
    `scope: ${scope}`,
    `source: ${source}`,
    'anchors:',
    ...anchors.map((a) => `  - {path: ${a.path}, symbol: ${a.symbol}, sha: ${a.sha}}`),
    `not-this: ${notThis}`,
    'provenance: captured by hand on 2026-09-04',
    '---',
    '',
    rendered,
  ].join('\n')
}

const lane = (name) => { const d = path.join(TMP, name); fs.mkdirSync(d, { recursive: true }); return d }
const write = (dir, id, text) => fs.writeFileSync(path.join(dir, `${id}.md`), text)

// gold.mjs signals a problem with a non-zero exit, so the runner must capture both halves.
const run = (args) => {
  try {
    return { code: 0, out: execSync(`node ${JSON.stringify(GOLD)} ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (e) {
    return { code: e.status == null ? 1 : e.status, out: `${e.stdout || ''}${e.stderr || ''}` }
  }
}

// A scratch git repo, so anchor resolution and the seeds-are-read-only guard have a real toplevel.
const scratchRepo = (name) => {
  const d = path.join(TMP, name)
  fs.mkdirSync(path.join(d, 'src'), { recursive: true })
  execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: d, stdio: 'ignore' })
  return d
}

// Real commits, real shas. An anchor's sha is what proves an entry belongs to the repository being
// checked, so a fixture with a made-up sha proves nothing about rot — it only proves the validator
// declines to judge a repository it has never seen. Every anchor that expects a verdict is committed.
const commitAll = (repo) => {
  execSync('git add -A && git commit -q -m fixture', { cwd: repo, stdio: 'ignore' })
  return execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf8' }).trim()
}

// ── 1. three-scope precedence ──────────────────────────────────────────────
check('scope precedence — repo beats local beats seeds on the same id', () => {
  const repo = scratchRepo('prec-repo')
  const repoGold = path.join(repo, '.masterdevs', 'gold')
  fs.mkdirSync(repoGold, { recursive: true })
  const pb = lane('prec-playbook')
  const localGold = path.join(pb, 'gold')
  fs.mkdirSync(localGold)
  const seeds = lane('prec-seeds')

  write(repoGold, 'shared', entry({ id: 'shared', domain: 'from-repo', scope: 'repo', source: 'repo' }))
  write(localGold, 'shared', entry({ id: 'shared', domain: 'from-local' }))
  write(seeds, 'shared', entry({ id: 'shared', domain: 'from-seeds', scope: 'seeds', source: 'seed' }))
  write(seeds, 'seeds-only', entry({ id: 'seeds-only', domain: 'from-seeds', scope: 'seeds', source: 'seed' }))

  const flags = `--repo-root ${JSON.stringify(repo)} --playbook-dir ${JSON.stringify(pb)} --seeds-dir ${JSON.stringify(seeds)}`
  const first = run(`--list ${flags}`)
  const afterRepoGone = (() => {
    fs.rmSync(path.join(repoGold, 'shared.md'))
    return run(`--list ${flags}`)
  })()

  return [
    [first.code === 0, `--list exited ${first.code}`],
    [/from-repo/.test(first.out), 'the repo copy must win the id collision'],
    [!/from-local/.test(first.out), 'the shadowed local copy must not be listed'],
    [(first.out.match(/^\s+shared\s/gm) || []).length === 1, 'the id must resolve to exactly one row'],
    [/2 entries shadowed by a higher scope/.test(first.out),
      `two shadowed copies must be reported — got: ${first.out.split('\n').find((l) => /shadow/.test(l)) || '(no line)'}`],
    [/from-local/.test(afterRepoGone.out), 'with the repo copy gone, local must win over seeds'],
    [/seeds-only/.test(first.out), 'a seed id with no override must still resolve'],
  ]
})

// ── 2. malformed entry ─────────────────────────────────────────────────────
check('malformed entry — a missing required field fails validation by name', () => {
  const d = lane('malformed')
  write(d, 'no-kind', entry({ id: 'no-kind' }).replace(/^kind: code\n/m, ''))
  const r = run(`--validate --gold-dir ${JSON.stringify(d)}`)
  return [
    [r.code !== 0, 'a malformed entry must exit non-zero'],
    [/no-kind\.md/.test(r.out), 'the failing filename must be named'],
    [/kind/.test(r.out), "the missing field 'kind' must be named"],
  ]
})

// ── 3. rotted anchor ───────────────────────────────────────────────────────
check('rotted anchor — the file is here but the symbol is gone', () => {
  const repo = scratchRepo('rot')
  fs.writeFileSync(path.join(repo, 'src/a.py'), 'def original_name():\n    return 1\n')
  const sha = commitAll(repo)                  // capture happened here, at this commit
  fs.writeFileSync(path.join(repo, 'src/a.py'), 'def renamed_away():\n    return 1\n')
  const d = lane('rot-gold')
  write(d, 'rotted', entry({ id: 'rotted', anchors: [{ path: 'src/a.py', symbol: 'original_name', sha }] }))
  const r = run(`--validate --gold-dir ${JSON.stringify(d)} --repo-root ${JSON.stringify(repo)}`)
  return [
    [r.code !== 0, 'a rotted anchor must exit non-zero'],
    [/rotted — src\/a\.py#original_name/.test(r.out), `the entry id and path#symbol must be named — got:\n${r.out}`],
  ]
})

// ── 3b. the same entry, checked from somewhere else, is not rot ─────────────
// The false alarm this gate exists to stop: a lane on this machine is shared by every repository the
// shell visits, and common paths (`src/a.py`, `README.md`) exist in many of them. Judged blindly, an
// entry is reported rotted the moment the check runs from a different checkout — and mode 5 then
// offers that entry up for deletion. So this case is the negative control for case 3: the SAME entry
// that legitimately fails in its own repository must pass, as a note, from a stranger's.
check('cross-repo — an entry is only judged in the repository it was captured in', () => {
  const home = scratchRepo('xrepo-home')
  fs.writeFileSync(path.join(home, 'src/a.py'), 'def original_name():\n    return 1\n')
  const sha = commitAll(home)

  // A different project that happens to have a file at the same relative path.
  const stranger = scratchRepo('xrepo-stranger')
  fs.writeFileSync(path.join(stranger, 'src/a.py'), 'def something_entirely_different():\n    return 2\n')
  commitAll(stranger)

  const d = lane('xrepo-gold')
  write(d, 'captured-elsewhere', entry({
    id: 'captured-elsewhere', anchors: [{ path: 'src/a.py', symbol: 'original_name', sha }],
  }))
  const args = `--validate --gold-dir ${JSON.stringify(d)} --repo-root`
  const fromStranger = run(`${args} ${JSON.stringify(stranger)}`)
  const fromHome = run(`${args} ${JSON.stringify(home)}`)

  // Same entry, same anchor, still live in its own repository — so the difference between these two
  // results is the gate and nothing else.
  fs.writeFileSync(path.join(home, 'src/a.py'), 'def original_name_renamed():\n    return 1\n')
  const fromHomeAfterRename = run(`${args} ${JSON.stringify(home)}`)

  return [
    [fromStranger.code === 0,
      `an entry captured in another repository must not fail here (exit ${fromStranger.code})\n${fromStranger.out}`],
    [!/captured-elsewhere — src\/a\.py#/.test(fromStranger.out),
      'and it must not be reported as rotted either — that is what gets it retired'],
    [/anchor commit is not in this history/.test(fromStranger.out),
      `the note must say why it was skipped — got:\n${fromStranger.out}`],
    [fromHome.code === 0, `in its own repository the live anchor must pass (exit ${fromHome.code})\n${fromHome.out}`],
    [!/unreachable/.test(fromHome.out), 'in its own repository the anchor must be judged, not skipped'],
    [fromHomeAfterRename.code !== 0, 'real rot in the capturing repository must still fail'],
    [/captured-elsewhere — src\/a\.py#original_name/.test(fromHomeAfterRename.out),
      `real rot must still be named — got:\n${fromHomeAfterRename.out}`],
  ]
})

// ── 4. a deleted or renamed file, in the capturing repository, IS rot ──────
// The commonest way a curated example actually goes stale is that someone moved or deleted the file.
// Past the reach gate this checkout is the capturing repository, standing at or after the commit the
// excerpt was taken at, so there is no innocent reading of an absent file left — reporting it as
// not-checkable would hide the single failure the lane most needs to catch.
check('deleted file — rot in the capturing repository, named and failing', () => {
  const repo = scratchRepo('gone')
  fs.writeFileSync(path.join(repo, 'src/a.py'), 'def thing():\n    return 1\n')
  const sha = commitAll(repo)
  fs.rmSync(path.join(repo, 'src/a.py'))       // moved or deleted since capture
  commitAll(repo)
  const d = lane('gone-gold')
  write(d, 'deleted', entry({ id: 'deleted', anchors: [{ path: 'src/a.py', symbol: 'thing', sha }] }))
  const r = run(`--validate --gold-dir ${JSON.stringify(d)} --repo-root ${JSON.stringify(repo)}`)
  return [
    [r.code !== 0, `a file gone from the capturing repository must fail (exit ${r.code})\n${r.out}`],
    [/deleted — src\/a\.py#thing/.test(r.out), `the entry and path must be named — got:\n${r.out}`],
    [/FILE_GONE/.test(r.out), `the reason code must say which case fired — got:\n${r.out}`],
  ]
})

// ── 4b. …but only from a checkout that can see that commit ─────────────────
// The negative control for case 4, and the reason the gate asks two questions instead of one. A
// feature branch cut BEFORE the capture commit has the file at a different state — or not at all —
// through no fault of the entry. Judged on "is the commit in the object store" alone, every such
// worktree reports rot on every entry captured after it was branched.
check('older checkout — a branch cut before the capture commit judges nothing', () => {
  const repo = scratchRepo('behind')
  fs.writeFileSync(path.join(repo, 'src/kept.py'), 'def kept():\n    return 1\n')
  const base = commitAll(repo)
  fs.writeFileSync(path.join(repo, 'src/a.py'), 'def thing():\n    return 1\n')
  const sha = commitAll(repo)                  // the entry was captured here

  const d = lane('behind-gold')
  write(d, 'newer', entry({ id: 'newer', anchors: [{ path: 'src/a.py', symbol: 'thing', sha }] }))
  const args = `--validate --gold-dir ${JSON.stringify(d)} --repo-root ${JSON.stringify(repo)}`
  const atCapture = run(args)

  // Same repository, same object store — only HEAD moves back. So the difference between these two
  // results is the ancestry half of the gate and nothing else.
  execSync(`git checkout -q ${base}`, { cwd: repo, stdio: 'ignore' })
  const beforeCapture = run(args)

  return [
    [atCapture.code === 0, `the live anchor must pass at the capture commit (exit ${atCapture.code})\n${atCapture.out}`],
    [beforeCapture.code === 0,
      `a checkout older than the entry must not fail (exit ${beforeCapture.code})\n${beforeCapture.out}`],
    [!/newer — src\/a\.py#/.test(beforeCapture.out),
      `and it must not be reported as rotted — that is what gets it retired — got:\n${beforeCapture.out}`],
    [/BEHIND_ANCHOR/.test(beforeCapture.out),
      `the note must name the ancestry reason, not the wrong-repository one — got:\n${beforeCapture.out}`],
  ]
})

// ── 4c. a symbol that is mostly punctuation still matches ──────────────────
// `\b` asserts a boundary between a word and a non-word character, so it can never hold on the
// punctuated side of a symbol. Applied blindly to `@pytest.fixture` it matched nothing, and a decorator
// named as an anchor was reported rotted against a file containing it literally.
check('punctuated symbol — a decorator or sigil anchor is matched, not falsely rotted', () => {
  const repo = scratchRepo('punct')
  fs.writeFileSync(path.join(repo, 'src/a.py'),
    '@pytest.fixture\ndef gas_contract():\n    return 1\n')
  const sha = commitAll(repo)
  const d = lane('punct-gold')
  write(d, 'decorated', entry({
    id: 'decorated',
    anchors: [{ path: 'src/a.py', symbol: '@pytest.fixture', sha }],
  }))
  const live = run(`--validate --gold-dir ${JSON.stringify(d)} --repo-root ${JSON.stringify(repo)}`)

  // And it must still be capable of failing: the same anchor against a file without the decorator.
  fs.writeFileSync(path.join(repo, 'src/a.py'), 'def gas_contract():\n    return 1\n')
  const removed = run(`--validate --gold-dir ${JSON.stringify(d)} --repo-root ${JSON.stringify(repo)}`)

  return [
    [live.code === 0, `a decorator present in the file must not be rot (exit ${live.code})\n${live.out}`],
    [removed.code !== 0, 'and the check must still fail once the decorator is gone'],
    [/SYMBOL_GONE/.test(removed.out), `the reason code must say the symbol went — got:\n${removed.out}`],
  ]
})

// ── 4d. a blank field is an empty field ────────────────────────────────────
// `title:` with nothing after it parses to the same empty list as a list key with no items, so a
// naive present-and-not-null test passed it straight through into the index as an entry with no name.
// `patterns` legitimately can be empty, so the two cases have to be told apart rather than merged.
check('blank field — an empty title fails, an empty patterns list does not', () => {
  const d = lane('blank-gold')
  write(d, 'no-title', entry({ id: 'no-title' }).replace(/^title: .*$/m, 'title:'))
  write(d, 'no-patterns', entry({ id: 'no-patterns' }).replace(/^patterns: .*$/m, 'patterns: []'))
  const blank = run(`--validate --gold-dir ${JSON.stringify(d)} --repo-root ${JSON.stringify(lane('blank-norepo'))}`)

  const ok = lane('blank-ok')
  write(ok, 'no-patterns', entry({ id: 'no-patterns' }).replace(/^patterns: .*$/m, 'patterns: []'))
  const patternsOnly = run(`--validate --gold-dir ${JSON.stringify(ok)}`)

  return [
    [blank.code !== 0, 'a blank title must fail validation'],
    [/no-title.*frontmatter field: title/s.test(blank.out),
      `the blank field must be named — got:\n${blank.out}`],
    [patternsOnly.code === 0,
      `an entry demonstrating no catalog pattern is legitimate (exit ${patternsOnly.code})\n${patternsOnly.out}`],
  ]
})

// ── 4e. an anchor path that escapes the repository is not followed ─────────
// Entry bodies and anchor paths are untrusted content — an entry can arrive by pull request. The
// validator reads whatever path an anchor names, so the path has to be proven inside the repository
// being judged before it is opened, not after.
check('escaping anchor path — refused rather than read', () => {
  const repo = scratchRepo('escape')
  fs.writeFileSync(path.join(repo, 'src/a.py'), 'def thing():\n    return 1\n')
  const sha = commitAll(repo)
  const outside = path.join(TMP, 'not-in-the-repo.txt')
  fs.writeFileSync(outside, 'thing\n')       // would match the symbol if it were ever read

  const d = lane('escape-gold')
  write(d, 'escaper', entry({
    id: 'escaper',
    anchors: [{ path: path.relative(repo, outside), symbol: 'thing', sha }],
  }))
  const r = run(`--validate --gold-dir ${JSON.stringify(d)} --repo-root ${JSON.stringify(repo)}`)
  return [
    [/OUTSIDE_REPO/.test(r.out), `the escape must be named as such — got:\n${r.out}`],
    [r.code === 0, 'and reported, not failed — the entry is wrong, but nothing rotted'],
  ]
})

// ── 4f. anything that is not a readable file is "gone", not a crash ────────
// `existsSync` is also true of a directory, and reading one throws EISDIR — which aborted the run and
// left every later entry unvalidated behind a stack trace. A validator that dies partway through is
// worse than one that reports nothing, because its exit code still looks like a verdict.
check('directory as an anchor path — reported as gone, and the run continues', () => {
  const repo = scratchRepo('eisdir')
  fs.mkdirSync(path.join(repo, 'src/pkg'), { recursive: true })
  fs.writeFileSync(path.join(repo, 'src/pkg/mod.py'), 'def kept():\n    return 1\n')
  fs.writeFileSync(path.join(repo, 'src/later.py'), 'def later_symbol():\n    return 1\n')
  const sha = commitAll(repo)

  const d = lane('eisdir-gold')
  write(d, 'a-directory', entry({ id: 'a-directory', anchors: [{ path: 'src/pkg', symbol: 'kept', sha }] }))
  // Sorts after the broken one, so it is only reported if the run survived it.
  write(d, 'z-later', entry({ id: 'z-later', anchors: [{ path: 'src/later.py', symbol: 'nope', sha }] }))
  const r = run(`--validate --gold-dir ${JSON.stringify(d)} --repo-root ${JSON.stringify(repo)}`)

  return [
    [!/EISDIR|at Object\.|Error:/.test(r.out), `the run must not throw — got:\n${r.out}`],
    [/a-directory.*FILE_GONE/.test(r.out), `a non-file must read as gone — got:\n${r.out}`],
    [/z-later/.test(r.out), 'the entry after the broken one must still be validated'],
  ]
})

// ── 4g. containment survives a symlink ─────────────────────────────────────
// Lexical containment passes any path that merely starts with the repository root, so a symlink
// committed inside the repository can point anywhere and the validator becomes a read oracle for the
// rest of the disk. The check has to resolve both sides.
check('symlinked anchor path — refused, not followed out of the repository', () => {
  const repo = scratchRepo('symlink')
  fs.writeFileSync(path.join(repo, 'src/a.py'), 'def thing():\n    return 1\n')
  const secretDir = path.join(TMP, 'symlink-outside')
  fs.mkdirSync(secretDir, { recursive: true })
  fs.writeFileSync(path.join(secretDir, 'secret.txt'), 'thing\n')   // would match if ever read
  fs.symlinkSync(secretDir, path.join(repo, 'src/escape'))
  const sha = commitAll(repo)

  const d = lane('symlink-gold')
  write(d, 'through-a-link', entry({
    id: 'through-a-link', anchors: [{ path: 'src/escape/secret.txt', symbol: 'thing', sha }],
  }))
  const r = run(`--validate --gold-dir ${JSON.stringify(d)} --repo-root ${JSON.stringify(repo)}`)
  return [
    [/OUTSIDE_REPO/.test(r.out), `the escape must be refused — got:\n${r.out}`],
    [!/through-a-link — src\/escape\/secret\.txt#thing \[/.test(r.out) || !/ok\b/.test(r.out),
      'and it must never be reported as a resolving anchor'],
  ]
})

// ── 4h. a flag with no value is a typo, and its failure was silent ─────────
// `--validate --gold-dir` with nothing after it fell back to the ambient scope chain and reported rot
// on entries the caller never named — arriving at the exact false positive the reach gate exists to
// prevent, by way of a typo.
check('malformed arguments — refused rather than silently reinterpreted', () => {
  const d = lane('args-gold')
  const missingValue = run('--validate --gold-dir')
  const swallowedFlag = run(`--gold-dir --validate`)
  const noSuchDir = run(`--validate --gold-dir ${JSON.stringify(path.join(TMP, 'not-a-lane'))}`)
  return [
    [missingValue.code !== 0 && /needs a value/.test(missingValue.out),
      `a flag with no value must be refused — got:\n${missingValue.out}`],
    [swallowedFlag.code !== 0 && /needs a value/.test(swallowedFlag.out),
      `a flag must not swallow the next flag as its value — got:\n${swallowedFlag.out}`],
    [noSuchDir.code !== 0 && /not a directory/.test(noSuchDir.out),
      `a missing lane must be a clean error, not a stack trace — got:\n${noSuchDir.out}`],
    [!/at Object\.|ENOENT/.test(noSuchDir.out), 'and it must not surface a raw node error'],
    [fs.existsSync(d), 'fixture lane exists'],
  ]
})

// ── 5. empty lanes ─────────────────────────────────────────────────────────
check('empty lane — validating nothing is success, including the shipped seeds', () => {
  const d = lane('empty')
  const scratch = run(`--validate --gold-dir ${JSON.stringify(d)}`)
  const shipped = run(`--validate --gold-dir ${JSON.stringify(SEEDS)}`)
  return [
    [scratch.code === 0, `an empty scratch lane must pass (exit ${scratch.code})`],
    [shipped.code === 0, `the shipped seed lane must pass (exit ${shipped.code})\n${shipped.out}`],
  ]
})

// ── 6. seed merge cannot clobber, and works on a Playbook with no gold lane ─
// Two skills used to carry this as a documented `cp -Rn`, in prose, and the two copies drifted. Both
// also assumed `$PLAYBOOK_DIR/gold/` already existed — on a Playbook seeded before this lane shipped it
// does not, so the first bootstrap command failed and the lane never appeared for that user at all.
// That is why the merge is code now, and why the absent-destination case is asserted first.
check('seed merge — creates the lane if absent, adds what is new, edits nothing present', () => {
  const seeds = lane('merge-seeds')
  write(seeds, 'shared', entry({ id: 'shared', domain: 'shipped-version' }))
  write(seeds, 'brand-new', entry({ id: 'brand-new', domain: 'shipped-version' }))

  // A Playbook that predates the gold lane: the root exists, `gold/` does not.
  const pb = lane('merge-playbook')
  const fresh = run(`--merge-seeds --playbook-dir ${JSON.stringify(pb)} --seeds-dir ${JSON.stringify(seeds)}`)
  const laneNow = path.join(pb, 'gold')

  // Second machine, same seeds, but one entry has been edited locally under a shipped id.
  const pb2 = lane('merge-playbook-2')
  const mine = entry({ id: 'shared', domain: 'my-edited-version' })
  fs.mkdirSync(path.join(pb2, 'gold'), { recursive: true })
  write(path.join(pb2, 'gold'), 'shared', mine)
  const again = run(`--merge-seeds --playbook-dir ${JSON.stringify(pb2)} --seeds-dir ${JSON.stringify(seeds)}`)

  return [
    [fresh.code === 0, `merging into a Playbook with no gold lane must succeed (exit ${fresh.code})\n${fresh.out}`],
    [fs.existsSync(path.join(laneNow, 'brand-new.md')), 'the lane must be created and the seeds copied in'],
    [fs.existsSync(path.join(laneNow, 'INDEX.md')),
      'and indexed — entries no index lists are entries no agent finds'],
    [again.code === 0, `merging over an existing lane must succeed (exit ${again.code})\n${again.out}`],
    [fs.readFileSync(path.join(pb2, 'gold/shared.md'), 'utf8') === mine,
      'a locally edited entry sharing a seed id must be left byte-identical'],
    [fs.existsSync(path.join(pb2, 'gold/brand-new.md')), 'while a net-new seed id is still added'],
    [/left 1 existing entry untouched/.test(again.out),
      `the report must say what it declined to overwrite — got:\n${again.out}`],
  ]
})

// ── 6b. the index is written from untrusted fields ─────────────────────────
// An entry can arrive by pull request, and `--reindex` copies its frontmatter into INDEX.md — the one
// file every agent loads. Keeping the BODY out of the index is not enough if a FIELD can carry markup,
// a link, or a line break into it, or choose the name of the file a spilled section is written to.
check('hostile frontmatter — cannot inject into the index or name a file', () => {
  const d = lane('inject-gold')
  const hostile = entry({ id: 'hostile', domain: '../../escaped' })
    .replace(/^title: .*$/m, 'title: real [click](http://example.com) `code` | col | <b>tag</b>')
  write(d, 'hostile', hostile)
  const r = run(`--reindex --scope local --playbook-dir ${JSON.stringify(path.join(TMP, 'inject-pb'))} ` +
    `--gold-dir ${JSON.stringify(d)}`)
  const index = fs.readFileSync(path.join(d, 'INDEX.md'), 'utf8')
  const line = index.split('\n').find((l) => l.includes('hostile')) || ''
  const strays = fs.readdirSync(path.dirname(d)).filter((f) => /escaped/.test(f))

  return [
    [r.code === 0, `reindex must succeed (exit ${r.code})\n${r.out}`],
    [!/\[click\]|<b>/.test(line), `markup must not survive into the index — got:\n${line}`],
    [(line.match(/`/g) || []).length === 2, `only the id keeps its backticks — got:\n${line}`],
    [!strays.length, `no file may be written outside the lane — found ${strays.join(', ')}`],
    [/real/.test(line), 'and the readable part of the title is still shown'],
  ]
})

// ── 7. the four shapes the lane was built for ──────────────────────────────
// One synthetic entry per acceptance example, proving each kind/domain combination validates with its
// own section template. The excerpts are placeholders; the point is the shape, not the content.
check('all four capture shapes validate — design/testing, abstraction/backend, code/frontend, design/infra', () => {
  const repo = scratchRepo('shapes')
  const files = {
    'src/helpers/build.ts': 'export function buildFixture() {}\n',
    'src/helpers/reset.ts': 'export function resetFixture() {}\n',
    'src/helpers/index.ts': 'export * from "./build"\n',
    'src/repo/orders.py': 'class OrderRepository:\n    def get(self, id):\n        return None\n',
    'src/ui/panel.tsx': 'export const Panel = () => null\nexport function usePanelState() {}\n',
    'infra/network.tf': 'variable "subnets" {}\nresource "aws_subnet" "this" {\n  for_each = var.subnets\n}\n',
  }
  for (const [p, text] of Object.entries(files)) {
    fs.mkdirSync(path.join(repo, path.dirname(p)), { recursive: true })
    fs.writeFileSync(path.join(repo, p), text)
  }
  // One real commit, and every anchor below carries its sha — otherwise these four would validate for
  // the wrong reason (an unjudgeable anchor also exits 0) and the section templates would be all this
  // case proves.
  const sha = commitAll(repo)
  const d = lane('shapes-gold')
  write(d, 'test-helper-package', entry({
    id: 'test-helper-package', kind: 'design', domain: 'testing', language: 'typescript',
    patterns: ['Object Mother'], lenses: ['correctness'],
    anchors: [
      { path: 'src/helpers/build.ts', symbol: 'buildFixture', sha },
      { path: 'src/helpers/reset.ts', symbol: 'resetFixture', sha },
      { path: 'src/helpers/index.ts', symbol: 'L1-L1', sha },
    ],
  }))
  write(d, 'order-repository', entry({
    id: 'order-repository', kind: 'abstraction', domain: 'backend', language: 'python',
    patterns: ['Repository'], anchors: [{ path: 'src/repo/orders.py', symbol: 'OrderRepository', sha }],
  }))
  write(d, 'panel-state-hook', entry({
    id: 'panel-state-hook', kind: 'code', domain: 'frontend', language: 'typescript',
    patterns: ['Guard Clause'], notThis: 'the same state duplicated into a second component',
    anchors: [{ path: 'src/ui/panel.tsx', symbol: 'usePanelState', sha }],
  }))
  write(d, 'subnet-for-each-table', entry({
    id: 'subnet-for-each-table', kind: 'design', domain: 'infra', language: 'terraform',
    patterns: ['Table-Driven Construction'],
    anchors: [{ path: 'infra/network.tf', symbol: 'aws_subnet', sha }],
  }))

  const r = run(`--validate --gold-dir ${JSON.stringify(d)} --repo-root ${JSON.stringify(repo)}`)
  const listed = run(`--list --gold-dir ${JSON.stringify(d)}`)
  const byDomain = run(`--list --gold-dir ${JSON.stringify(d)} --domain infra`)
  const byPattern = run(`--for-pattern repository --gold-dir ${JSON.stringify(d)}`)
  const byLanguage = run(`--list --gold-dir ${JSON.stringify(d)} --language terraform`)
  return [
    [r.code === 0, `all four shapes must validate clean — got:\n${r.out}`],
    [/4 entries/.test(listed.out), 'all four must resolve'],
    [/subnet-for-each-table/.test(byDomain.out) && !/order-repository/.test(byDomain.out),
      '--domain must filter'],
    [/order-repository/.test(byPattern.out) && !/panel-state-hook/.test(byPattern.out),
      '--for-pattern must filter, case-insensitively'],
    [/subnet-for-each-table/.test(byLanguage.out) && !/order-repository/.test(byLanguage.out),
      '--language must filter'],
  ]
})

// ── 8. reindex containment ─────────────────────────────────────────────────
check('reindex — refuses without --scope, writes only inside the named lane, groups by frontmatter domain', () => {
  const pb = lane('reindex-playbook')
  const localGold = path.join(pb, 'gold')
  fs.mkdirSync(localGold)
  write(localGold, 'a-backend-one', entry({ id: 'a-backend-one', domain: 'backend' }))
  write(localGold, 'b-frontend-one', entry({ id: 'b-frontend-one', domain: 'frontend' }))
  const sibling = lane('reindex-sibling')

  const noScope = run(`--reindex --playbook-dir ${JSON.stringify(pb)}`)
  const ok = run(`--reindex --scope local --playbook-dir ${JSON.stringify(pb)}`)
  const index = fs.readFileSync(path.join(localGold, 'INDEX.md'), 'utf8')
  const seedsRefused = run(`--reindex --scope seeds --seeds-dir ${JSON.stringify(sibling)}`)

  return [
    [noScope.code !== 0, '--reindex with no --scope must refuse'],
    [/--scope/.test(noScope.out), 'the refusal must say what is missing'],
    [ok.code === 0, `--reindex --scope local must succeed — got:\n${ok.out}`],
    [/^## backend$/m.test(index) && /^## frontend$/m.test(index),
      'the index must group by the frontmatter domain'],
    [/do not hand-edit/.test(index), 'the index must say it is generated'],
    [fs.readdirSync(localGold).sort().join(',') === 'INDEX.md,a-backend-one.md,b-frontend-one.md',
      'reindex must write nothing but the index, and nothing outside the lane'],
    [fs.readdirSync(sibling).length === 0, 'nothing may be written into an unrelated directory'],
    [seedsRefused.code !== 0, 'a seed lane outside the current checkout must be refused'],
    [/read-only/.test(seedsRefused.out), 'the seeds refusal must say why'],
  ]
})

// ── 9. index split ─────────────────────────────────────────────────────────
// One domain past the schema's line threshold spills into its own file and leaves a pointer behind.
// Unproven, this branch stays dormant until someone's lane grows — and then writes an index nobody
// reviewed.
check('index split — a domain past the line threshold spills to its own file', () => {
  const pb = lane('split-playbook')
  const gold = path.join(pb, 'gold')
  fs.mkdirSync(gold)
  const many = SCHEMA.indexSplitLines + 10
  for (let n = 0; n < many; n++) {
    const id = `e${String(n).padStart(3, '0')}`
    write(gold, id, entry({ id, domain: 'backend' }))
  }
  write(gold, 'lonely', entry({ id: 'lonely', domain: 'frontend' }))

  const r = run(`--reindex --scope local --playbook-dir ${JSON.stringify(pb)}`)
  const index = fs.readFileSync(path.join(gold, 'INDEX.md'), 'utf8')
  const spill = path.join(gold, 'INDEX.backend.md')
  return [
    [r.code === 0, `--reindex must succeed — got:\n${r.out}`],
    [fs.existsSync(spill), 'the oversized domain must get its own index file'],
    [/INDEX\.backend\.md/.test(index), 'the main index must point at the spill file'],
    [!index.includes('`e000`'), 'the main index must not also carry the spilled entries'],
    [/`lonely`/.test(index), 'a domain under the threshold must stay inline'],
    [!fs.existsSync(path.join(gold, 'INDEX.frontend.md')), 'a small domain must not be split'],
  ]
})

// ── Section two: the two skill prompts as static text ──────────────────────
// A skill cannot be executed from a test, but the parts of these two that are load-bearing contracts
// are greppable — and a prompt that quietly loses one is exactly the failure mode this repo has had
// before (three shipped versions of skill-side work sat dormant for a day while everything looked
// healthy). So the contract is asserted where it can be: in the text.
const skill = (rel) => fs.readFileSync(path.join(ROOT, 'plugins/masterdevs/skills', rel), 'utf8')
const reference = (rel) => fs.readFileSync(path.join(ROOT, 'plugins/masterdevs/references', rel), 'utf8')

check('gold/SKILL.md — six questions, each with a recommendation the user accepts with y', () => {
  const text = skill('gold/SKILL.md')
  const marked = text.split('\n').filter((l) => l.includes('[recommend:'))
  return [
    [marked.length === 6, `the question budget is six — found ${marked.length} '[recommend:' markers`],
    // Capture and contribution are one command because the decision is one decision. If the
    // destination stops being asked FIRST, the flow silently becomes capture-only again: the answer
    // routes the frontmatter, the scrub, and whether anything leaves the machine at all.
    [/\[recommend: <public\|team\|local>\]/.test(marked[0] || ''),
      `question 1 must be the destination, offering public/team/local — got: ${marked[0] || '(none)'}`],
    [/references\/upstream-submit\.md/.test(text),
      'the public answer must delegate to the shared upstream mechanism, not restate it'],
    [/six-question budget/.test(text),
      "the upstream path's own approval gates must be excluded from the question budget"],
    // The standalone contribute command was the only way an already-captured entry could leave the
    // machine. Consolidating it away without this path would strand every entry captured as local.
    [/skip questions 2 through 6/i.test(text),
      'an entry that already exists must reach the destination question without being re-captured'],
    [/duplicate/.test(text),
      'and the prompt must say why re-capturing is wrong — a second id for one example never expires'],
    [marked.every((l) => l.includes('y to accept')),
      'every recommendation must be acceptable with a bare y, or the budget is six interviews'],
    [/never asked/.test(text), 'the derived-never-asked list must be stated'],
    [/--reindex --scope[\s\S]{0,400}--validate/.test(text),
      'capture must close with --reindex --scope then --validate, in that order'],
  ]
})

// The destination answer decides two frontmatter fields, and the public answer decides them twice —
// once for the copy the user keeps and once for the copy that is submitted. A table that names only
// one of each pair leaves capture to guess, and the validator only sees the guess after it is written.
// Moving an entry between lanes runs the same two commands capture ends with, and needs the same two
// explicit flags for the same reason: without them the reindex writes one lane while the validation
// reads another, and the move reports success over an entry nobody checked.
check('gold/SKILL.md — the destination table and the lane moves both name their lane explicitly', () => {
  const text = skill('gold/SKILL.md')
  const table = text.slice(text.indexOf('### 1.'), text.indexOf('### 2.'))
  const move = table.slice(table.indexOf('| From \u2192 to |'))
  const publicRow = table.split('\n').find((l) => l.includes('**public**')) || ''
  const localToTeam = move.split('\n').find((l) => l.includes('local \u2192 team')) || ''
  return [
    // Anchored on which copy carries which pair. Asserting only that both pairs appear lets them be
    // swapped — kept copy `seeds`/`contributed`, submitted copy `local`/`local` — which passes while
    // meaning the opposite, and ships an entry into the public lane claiming to be someone's laptop.
    [/kept copy[\s\S]{0,60}scope: local[\s\S]{0,30}source: local/.test(publicRow),
      'the copy the user keeps must be named, and must carry local/local'],
    [/submitted copy[\s\S]{0,60}scope: seeds[\s\S]{0,30}source: contributed/.test(publicRow),
      'the copy that is submitted must be named, and must carry seeds/contributed'],
    // `scope: seeds` is only real if the step that rewrites the staged copy sets it. The skill is told
    // to follow the reference and not restate it, so a value promised here and absent there is a value
    // nothing ever writes — and `--validate` accepts `local`, so nothing downstream catches it either.
    [/scope: seeds/.test(reference('upstream-submit.md')),
      'and the reference step that rewrites the staged copy must actually set scope: seeds'],
    // `--playbook-dir` is inert for `--scope repo` (gold.mjs resolves that lane from repoRoot), and
    // `--gold-dir` without `--repo-root` skips every anchor and exits 0 — so a check that demands only
    // those two flags locks in a move that cannot detect a deleted anchor file.
    [/--reindex --scope repo --repo-root/.test(localToTeam),
      'the repo lane is pinned by --repo-root, not --playbook-dir'],
    [/--validate --gold-dir[\s\S]{0,60}--repo-root/.test(localToTeam),
      'and the validation needs --repo-root, or every anchor is skipped and rot passes'],
  ]
})

check('upstream-submit.md — throwaway clone, no inline leak regex, main named as forbidden', () => {
  const text = reference('upstream-submit.md')
  return [
    [!/AKIA/.test(text), 'no key-shaped regex inline — the pattern classes live in scrub-patterns.txt'],
    [/references\/scrub-patterns\.txt/.test(text), 'the shipped pattern file must be named as a source'],
    [/scrub-patterns\.local\.txt/.test(text), 'the data-dir local extension must be named as a source'],
    [/mktemp -d/.test(text), 'the temp clone location must be named'],
    [/git clone --depth 1/.test(text), 'the clone mechanism must be named'],
    [/git switch -c/.test(text), 'the branch mechanism must be named'],
    [/git switch main/.test(text) && /git checkout main/.test(text),
      'both ways of checking out main must be listed as forbidden'],
    [/push to a default branch/.test(text), 'pushing a default branch must be listed as forbidden'],
  ]
})

// Two callers, two subject shapes. A gold entry is a whole file; a pattern or lesson is one row inside a
// shared catalog. Staging the catalog would submit every other row with it, so the staging step has to
// say where each kind lives and that a row is extracted rather than copied — otherwise mode 6 has no
// executable path and the flow reads as gold-only.
check('upstream-submit.md — staging covers rows, not just whole files', () => {
  const text = reference('upstream-submit.md')
  const stage = text.slice(text.indexOf('## 2.'), text.indexOf('## 3.'))
  return [
    // Anchored on the source path in the user's own Playbook, not the destination inside the clone —
    // the destination is named a few lines later, and matching that would let this pass while the
    // staging step still said nothing about where a pattern is read FROM.
    [/\$PLAYBOOK_DIR\/patterns\/<domain>\/catalog\.md/.test(stage),
      'the pattern subject location in the user\'s Playbook must be named'],
    [/\$PLAYBOOK_DIR\/lessons\/<lens>\.md/.test(stage), 'and the lesson subject location'],
    [/rows, not files/.test(stage),
      'and it must say so plainly — staging the whole catalog submits rows nobody chose to share'],
  ]
})

// The confirmation has to live where the push does. It used to sit only in the preamble, above step 1 —
// and gold enters this reference "from step 2 onward", so the one caller that reaches a public push was
// the one caller that never read it. A default that silently resolves to the production repository is
// exactly the outward-facing action that needs a yes.
check('upstream-submit.md — step 6 confirms before it pushes, and places a row without clobbering', () => {
  const text = reference('upstream-submit.md')
  const push = text.slice(text.indexOf('## 6.'), text.indexOf('## 7.'))
  // ORDER, not mere presence. The push lives in a fenced block an agent may run as one call, so a
  // confirmation printed after it has already been skipped — the same miss as the preamble, one step
  // lower. The only assertion that catches that is position.
  const confirmAt = push.search(/[Cc]onfirm the resolved/)
  const pushAt = push.indexOf('git push -u origin')
  return [
    [pushAt !== -1, 'the push belongs in this step'],
    [confirmAt !== -1,
      'the target must be confirmed here, where the push is — the preamble is skipped by gold'],
    [confirmAt !== -1 && pushAt !== -1 && confirmAt < pushAt,
      'and it must come BEFORE the push command, not after it'],
    [/MasterDevs\/masterclaude/.test(push),
      'and it must name the default, since that is what a run silently resolves to'],
    // Step 2 stages a pattern as a one-row fragment. If step 6 only knows `cp`, following both
    // literally replaces the shipped catalog with that single row and commits the deletion — so
    // mode 6's every run would open a destructive pull request.
    [/append/i.test(push), 'a row-shaped subject must be appended, never copied over its destination'],
    [/catalog\.md/.test(push) && /lessons\/<lens>\.md/.test(push),
      'and both row destinations must be named here, not only in the staging step'],
    [/no deletions/i.test(push),
      'and the diff must be checked for deletions before the commit — that is where a clobber shows'],
  ]
})

// The scrub header describes the flow, and describing it wrong inverts the guarantee: rewriting inside
// the pushable clone means unscrubbed content is already there. The rewrite happens on the staged copy,
// before any clone exists.
check('scrub-patterns.txt — the header names the staged copy, not the clone', () => {
  const text = reference('scrub-patterns.txt')
  const head = text.slice(0, text.indexOf('\n\n'))
  return [
    [/\$WORK\/submit/.test(head), 'the rewrite target must be the staged copy'],
    // Widened past the one phrase that was there before: any wording that puts the rewrite inside the
    // clone inverts the guarantee, and excluding a single sentence would not notice a reworded one.
    [!/clone's copy/.test(head), 'and must not read as rewriting inside the pushable clone'],
    // Scoped to the header. Left running over the whole file, this sentence could migrate into some
    // later comment block and the check would stay green while the header itself said nothing.
    [/BEFORE the throwaway clone/i.test(head), 'the ordering must be stated in the header, not implied'],
  ]
})

// The scrub gate is the only thing standing between a private lane and a public pull request, and its
// failure mode is silence: inspect nothing, match nothing, report clean. So the prompt must carry the
// three things that make a clean result mean something — a non-empty pattern list, a non-empty file
// list, and a positive control proving the patterns can fire — plus the exit-code reading that keeps a
// grep ERROR from being mistaken for a grep MISS.
check('upstream-submit.md — the scrub gate cannot pass by inspecting nothing', () => {
  const text = reference('upstream-submit.md')
  const gate = text.slice(text.indexOf('## 4.'), text.indexOf('## 5.'))
  return [
    [/test -s "\$PATTERNS"/.test(gate), 'the gate must refuse an empty pattern list'],
    [/test -s "\$WORK\/submit\.txt"/.test(gate), 'the gate must refuse an empty file list'],
    [/positive control/i.test(gate), 'the gate must prove it can fire before it may report clean'],
    [/negative control/i.test(gate),
      'and prove it does not fire on ordinary prose — an over-broad pattern blocks every contribution'],
    [/grep -rInE -f "\$PATTERNS"/.test(gate), 'the gate must read the files themselves'],
    [/`2` or more[\s\S]{0,120}refuse/.test(gate),
      'a grep error must be a refusal — treating any non-zero as clean is the vacuous pass again'],
    [/git grep/.test(gate) && /tracked/.test(gate),
      'the prompt must say why git grep is the wrong tool here, or someone will put it back'],
  ]
})

// The upstream mechanism was lifted out of a second skill so it exists once. Both callers have to
// actually reach it, and neither may grow its own copy of the parts that matter.
check('one upstream mechanism — both callers delegate, neither restates it', () => {
  const gold = skill('gold/SKILL.md')
  const playbook = skill('playbook/SKILL.md')
  const ref = 'references/upstream-submit.md'
  const restates = (t) => /mktemp -d/.test(t) || /git clone --depth 1/.test(t) || /\$PATTERNS/.test(t)
  return [
    [gold.includes(ref), 'the gold skill must point at the shared mechanism'],
    [playbook.includes(ref), 'the playbook skill must point at the shared mechanism'],
    [!restates(gold), 'and the gold skill must not carry its own copy of the clone or gate commands'],
    [!restates(playbook), 'nor the playbook skill'],
    [!fs.existsSync(path.join(ROOT, 'plugins/masterdevs/skills/contribute')),
      'the standalone contribute skill is consolidated away — a second entry point would drift'],
  ]
})

// The shipped patterns run against real strings, in both directions. A leak that slips the list is the
// obvious risk; the quieter one is a pattern so broad that the gate refuses everything, because the gate
// has no override and that failure is indistinguishable from a real leak. `[A-Z]{2,6}-[0-9]+` did
// exactly that — it matched `SHA-256` and `ISO-8601` in a lane whose entries are prose about code.
check('scrub patterns — real leaks match, ordinary technical prose does not', () => {
  const active = path.join(TMP, 'scrub-active.txt')
  const src = path.join(ROOT, 'plugins/masterdevs/references/scrub-patterns.txt')
  // Comments and blanks stripped exactly the way contribute/SKILL.md strips them — a blank line in a
  // `grep -f` list matches every line, so this step is load-bearing, not cosmetic.
  execSync(`grep -hvE '^[[:space:]]*(#|$)' ${JSON.stringify(src)} > ${JSON.stringify(active)}`)

  const hits = (line) => {
    const f = path.join(TMP, 'scrub-sample.txt')
    fs.writeFileSync(f, `${line}\n`)
    try {
      execSync(`grep -qE -f ${JSON.stringify(active)} ${JSON.stringify(f)}`, { stdio: 'ignore' })
      return true
    } catch { return false }
  }

  const mustMatch = [
    'connecting to db-01.internal',
    'host is analytics.corp',
    // Assembled rather than written out: this repository's own CI greps for a literal home path, and a
    // fixture that spells one is indistinguishable from a leak. Same self-exclusion problem
    // scrub-patterns.txt solves by bracketing a letter in the vendor key prefixes.
    `see /${'Users'}/someone/src/thing.py`,
    'redis://cache-7.example:6379/0',
    'reach me at someone@example.com',
    'bound to 10.0.0.4',
  ]
  const mustNotMatch = [
    'decoded as UTF-8 before hashing with SHA-256',
    'timestamps are ISO-8601 throughout',
    'overrides live in settings.local.json',
    'the store is state.local.ts',
    'follows RFC-7231 and PEP-8',
    'AES-256 at rest',
  ]

  return [
    ...mustMatch.map((l) => [hits(l), `a real leak must be caught: ${l}`]),
    ...mustNotMatch.map((l) => [!hits(l), `ordinary prose must not be blocked: ${l}`]),
  ]
})

check('playbook/SKILL.md — six modes, the gold lane fifth and upstream sixth', () => {
  const text = skill('playbook/SKILL.md')
  const modes = text.split('\n').filter((l) => l.startsWith('### '))
  return [
    [modes.length === 6, `expected six mode headings — found ${modes.length}`],
    [/gold/i.test(modes[4] || ''), `the fifth mode must be the gold lane — got '${modes[4] || '(none)'}'`],
    [/upstream/i.test(modes[5] || ''),
      `the sixth must send a promoted row upstream — got '${modes[5] || '(none)'}'`],
    [/gold\.mjs --validate/.test(text), 'mode 5 must shell out to the one detector'],
    // The advice inverts between a stale entry and one this checkout simply cannot judge, so mode 5
    // has to name every code the validator can print. A code it never mentions is a case where it
    // guesses — and guessing towards retirement is how a curated example is lost.
    ...['FILE_GONE', 'SYMBOL_GONE', 'RANGE_SHORT', 'NOT_THIS_REPO', 'BEHIND_ANCHOR', 'OUTSIDE_REPO']
      .map((code) => [text.includes(code), `mode 5 must say what to do about ${code}`]),
    [/[Nn]ever offer a skipped entry for retirement/.test(text),
      'mode 5 must forbid retiring an entry this checkout could not judge'],
    [/Re-anchor/.test(text) && /Retire/.test(text) && /Leave it/.test(text),
      'mode 5 must offer re-anchor / retire / leave'],
  ]
})

console.log(`\n${passed}/${passed + failed} checks passed`)
process.exit(failed ? 1 : 0)
