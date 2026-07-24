export const meta = {
  name: 'masterdevs-feature-plan',
  description: 'Phase 1: scout the affected subsystems, then architect a PLAN.md of model-routed, review-lensed subtasks. Stops for human approval before any code is written.',
  phases: [
    { title: 'Scout', detail: 'read-only map of affected subsystems' },
    { title: 'Architect', detail: 'decompose into subtasks; escalate to Principal if multi-domain' },
    { title: 'Write plan', detail: 'render PLAN.md for human approval' },
  ],
}

// ── args (resolved by the feature skill, which owns ${CLAUDE_PLUGIN_DATA}) ──
// { brief, playbookDir, planPath, tier? }
// Accept args whether passed as a real object (preferred) or a JSON string.
let input = args || {}
if (typeof input === 'string') {
  try { input = JSON.parse(input) } catch (e) {
    throw new Error('feature-plan: args arrived as a non-JSON string — pass it as an object: ' + e.message)
  }
}
const { brief, playbookDir, planPath, tier } = input
if (!brief || !playbookDir || !planPath) {
  throw new Error(
    'feature-plan requires args.brief, args.playbookDir, args.planPath — got keys: [' +
    Object.keys(input).join(', ') + ']'
  )
}

const DOMAINS = ['frontend', 'backend', 'data', 'algo', 'integration']

const SCOUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subsystems', 'keyFiles', 'existingAbstractions', 'risks', 'domains'],
  properties: {
    subsystems: { type: 'array', items: { type: 'string' } },
    keyFiles: { type: 'array', items: { type: 'string' } },
    existingAbstractions: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    domains: { type: 'array', items: { type: 'string', enum: DOMAINS } },
  },
}

const SUBTASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'intent', 'files', 'tier', 'model', 'sensitivity',
    'lenses', 'design', 'refactors', 'dependsOn', 'acceptance'],
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    intent: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    tier: { type: 'string', enum: ['small', 'complex', 'sensitive'] },
    model: { type: 'string', enum: ['sonnet', 'opus', 'fable', 'haiku'] },
    sensitivity: {
      type: 'object', additionalProperties: false,
      required: ['isSensitive', 'rationale'],
      properties: { isSensitive: { type: 'boolean' }, rationale: { type: 'string' } },
    },
    lenses: { type: 'array', items: { type: 'string' } },
    design: {
      type: 'object', additionalProperties: false, required: ['patterns'],
      properties: {
        patterns: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['pattern', 'mode', 'where', 'why'],
            properties: {
              pattern: { type: 'string' },
              mode: { type: 'string', enum: ['author-new', 'refactor-to'] },
              where: { type: 'string' },
              why: { type: 'string' },
            },
          },
        },
      },
    },
    refactors: {
      type: 'object', additionalProperties: false, required: ['inScope', 'flagged'],
      properties: {
        inScope: { type: 'array', items: {
          type: 'object', additionalProperties: false,
          required: ['file', 'change', 'rationale'],
          properties: { file: { type: 'string' }, change: { type: 'string' }, rationale: { type: 'string' } },
        } },
        flagged: { type: 'array', items: {
          type: 'object', additionalProperties: false,
          required: ['file', 'change', 'rationale'],
          properties: { file: { type: 'string' }, change: { type: 'string' }, rationale: { type: 'string' } },
        } },
      },
    },
    dependsOn: { type: 'array', items: { type: 'string' } },
    acceptance: { type: 'array', items: { type: 'string' } },
  },
}

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'domains', 'subtasks'],
  properties: {
    summary: { type: 'string' },
    domains: { type: 'array', items: { type: 'string', enum: DOMAINS } },
    subtasks: { type: 'array', items: SUBTASK_SCHEMA },
  },
}

const playbookNote = `
The Playbook lives at: ${playbookDir}
- Pattern catalogs: ${playbookDir}/patterns/<domain>/catalog.md  (domains: core, concurrency, integration, frontend, backend, data, algo)
- Refactor backlog: ${playbookDir}/refactor-backlog.md
- Lessons lanes:    ${playbookDir}/lessons/<lens>.md
- Candidate staging (write here, never to catalog.md/lessons/<lens>.md):
    ${playbookDir}/patterns/<domain>/candidates.md
- External reviewer memory (defensive read; may be absent): ~/.claude/agent-memory/eng-skills-pr-reviewer/
Catalog rows are detection recipes: match "Reach for when" against real code, honor "Skip when".`

// ── Phase: Scout ──────────────────────────────────────────────────────────
phase('Scout')
let scout = null
if (tier !== 'small') {
  scout = await agent(
    `You are a read-only Scout. Map the subsystems this feature will touch. DO NOT modify any files.\n\n` +
    `Feature brief:\n${brief}\n\n` +
    `Return: the subsystems involved, the key files, existing abstractions worth reusing/extending, ` +
    `risks (security, reliability, coupling), and which domains (${DOMAINS.join(', ')}) the brief spans.`,
    { label: 'scout', phase: 'Scout', schema: SCOUT_SCHEMA, effort: 'medium' }
  )
} else {
  log('small tier → skipping Scout')
}

const scoutBlock = scout
  ? `Scout map:\n${JSON.stringify(scout, null, 2)}`
  : `No Scout map (small tier). Read the brief and the immediately relevant files yourself.`

// ── Phase: Architect ──────────────────────────────────────────────────────
phase('Architect')

// Generalist architect first. It declares which domains the feature spans.
const generalist = await agent(
  `You are the generalist Architect (lens: "generalist"). Decompose this feature into subtasks ` +
  `following the masterdevs PLAN schema. Route each subtask's tier/model, choose design patterns from the ` +
  `catalogs (detection recipes — match the smell, honor Skip-when), bin refactors as in-scope vs. flagged, ` +
  `pull in relevant refactor-backlog items, apply the spine-subtask rule for shared helpers, and stage any ` +
  `newly-discovered patterns as candidates (never write to a promoted catalog).\n\n` +
  `Classification is fail-upward; sensitivity tripwires (auth, crypto/secrets, payments, PII, access control, ` +
  `trust boundaries) force tier=sensitive, model=fable.\n\n` +
  `Feature brief:\n${brief}\n\n${scoutBlock}\n${playbookNote}\n\n` +
  `In "domains", list every domain this feature genuinely spans.`,
  { label: 'architect:generalist', phase: 'Architect', schema: PLAN_SCHEMA,
    agentType: 'masterdevs:architect', model: 'opus' }
)

let plan = generalist
// Escalate to the Principal when the brief spans more than one domain.
if (generalist && generalist.domains && generalist.domains.length > 1) {
  log(`multi-domain (${generalist.domains.join(', ')}) → escalating to Principal`)
  const principal = await agent(
    `You are the Principal coordinating a multi-domain feature spanning: ${generalist.domains.join(', ')}.\n` +
    `1) Slice the brief per domain. 2) Design the cross-domain seams YOURSELF (API shapes, shared data ` +
    `models, event contracts) — do not delegate them. 3) Dispatch one specialist architect per slice with ` +
    `the seam contracts fixed. 4) Reconcile into ONE coherent PLAN — dependency spine by default ` +
    `(data → backend → frontend), dependsOn edges crossing every seam, shared helpers promoted to a ` +
    `spine subtask that lands first.\n\n` +
    `Feature brief:\n${brief}\n\n${scoutBlock}\n` +
    `A generalist first-pass plan (revise/reconcile, don't just accept it):\n` +
    `${JSON.stringify(generalist, null, 2)}\n${playbookNote}`,
    { label: 'principal', phase: 'Architect', schema: PLAN_SCHEMA,
      agentType: 'masterdevs:principal', model: 'opus' }
  )
  if (principal) plan = principal
}

if (!plan || !plan.subtasks || plan.subtasks.length === 0) {
  throw new Error('Architect produced no subtasks — brief may be too vague; report back to the user.')
}

// ── Phase: Write plan ─────────────────────────────────────────────────────
phase('Write plan')
await agent(
  `Write a human-readable PLAN.md to the absolute path: ${planPath}\n\n` +
  `Render this plan object as Markdown: a summary section, then one clearly-headed section per subtask ` +
  `showing every field (id, title, intent, files, tier, model, sensitivity, lenses, design.patterns with ` +
  `mode/where/why, refactors inScope + flagged, dependsOn, acceptance). Keep the raw JSON in a fenced ` +
  `\`\`\`json block at the end so the build phase can parse it exactly. Do not change any values.\n\n` +
  `Plan object:\n${JSON.stringify(plan, null, 2)}`,
  { label: 'write-plan', phase: 'Write plan', agentType: 'general-purpose', model: 'sonnet' }
)

const needsApproval = tier !== 'small'
log(needsApproval ? 'PLAN.md written — awaiting human approval' : 'PLAN.md written (small tier — no approval gate)')

return {
  summary: plan.summary,
  domains: plan.domains,
  subtaskCount: plan.subtasks.length,
  planPath,
  needsApproval,
}
