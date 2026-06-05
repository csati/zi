export const meta = {
  name: 'pipeline-backhalf',
  description: 'Implement each /decompose stage with a fresh agent in order, halting on conflict, then finalize against the PRD',
  phases: [
    { title: 'Implement', detail: 'one fresh agent per stage, in order' },
    { title: 'Finalize', detail: 'verify the whole feature against its PRD' },
  ],
}

// Args (passed by the /implement-all command):
//   args.prd    — the prd-{slug}.md to finalize against
//   args.stages — ORDERED list of plan-{slug}-stage-NN.md filenames
//
// The script has no filesystem access, so the caller must pass the stage list;
// it cannot glob for it. Stages run strictly sequentially because each one
// assumes the committed repo state the previous one left behind.

const STAGE_RESULT = {
  type: 'object',
  required: ['status', 'detail'],
  additionalProperties: false,
  properties: {
    status: {
      type: 'string',
      enum: ['done', 'conflict', 'failed'],
      description: 'done = implemented and acceptance criteria pass; conflict = a precondition was false / plan contradicts reality; failed = could not get the build or tests green',
    },
    detail: { type: 'string', description: 'What was implemented, or precisely why it conflicted/failed' },
    commit: { type: 'string', description: 'Commit subject if a commit was made, else empty' },
    tokens: { type: 'string', description: 'Approximate token usage for this stage, if known' },
  },
}

const FINALIZE_REPORT = {
  type: 'object',
  required: ['satisfied', 'frs', 'gaps'],
  additionalProperties: false,
  properties: {
    satisfied: { type: 'boolean', description: 'Is the PRD fully satisfied' },
    frs: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'status'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['met', 'partial', 'missing'] },
          evidence: { type: 'string', description: 'file:line for met; the specific absence for missing' },
        },
      },
    },
    build: {
      type: 'object',
      additionalProperties: false,
      properties: {
        build: { type: 'string' },
        test: { type: 'string' },
        lint: { type: 'string' },
      },
    },
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['fr', 'issue'],
        additionalProperties: false,
        properties: {
          fr: { type: 'string' },
          issue: { type: 'string' },
          file: { type: 'string' },
        },
      },
    },
  },
}

const stages = Array.isArray(args && args.stages) ? args.stages : []
const prd = args && args.prd

if (!stages.length) {
  log('No stage files passed in args.stages — nothing to implement. Run /decompose first.')
  return { halted: true, reason: 'no-stages', results: [] }
}

phase('Implement')

const results = []
for (let i = 0; i < stages.length; i++) {
  const file = stages[i]
  const n = String(i + 1).padStart(2, '0')

  const res = await agent(
    `You are implementing ONE stage of a decomposed feature, with a fresh context. ` +
      `Read the plan file \`${file}\` in the working directory and follow it exactly.\n\n` +
      `STEP 1 — verify reality. Read the files the plan lists under "Context to load" and confirm EVERY precondition in the plan actually holds in the current repo. ` +
      `If any precondition is false, or the plan contradicts what the code now shows, DO NOT work around it: return status "conflict" with a precise explanation of the mismatch, and STOP without editing anything.\n\n` +
      `STEP 2 — implement. Otherwise carry out the plan's Tasks. Describe-to-code yourself against the real repo; the plan states intent, not literal source.\n\n` +
      `STEP 3 — make it green. Satisfy the stage's Acceptance criteria: the exact build, test, and lint commands named in the plan must pass. If you cannot get them green, return status "failed" with the failing output.\n\n` +
      `STEP 4 — commit and report. On success, commit as the plan's Handoff instructs, then return status "done" with the commit subject and your approximate token usage.`,
    { label: `stage-${n}`, phase: 'Implement', schema: STAGE_RESULT },
  )

  results.push({ file, result: res })

  if (!res || res.status !== 'done') {
    const status = res ? res.status : 'null'
    const detail = res ? res.detail : 'agent returned no result'
    log(`Halting at ${file}: status="${status}" — ${detail}`)
    return { halted: true, reason: status, atStage: file, results }
  }

  log(`Stage ${n} done: ${res.commit || '(no commit subject reported)'}`)
}

phase('Finalize')

const report = await agent(
  `All decomposition stages are implemented and committed. Verify the WHOLE feature against its PRD \`${prd}\`, end to end.\n\n` +
    `For every FR in the PRD, find the code that satisfies it and judge whether its acceptance criteria are actually met — mark each met / partial / missing with file:line evidence (or the specific absence). ` +
    `Check non-goals were respected and technical constraints honoured.\n\n` +
    `Then run the project's FULL build, test, and lint commands (discover them from AGENTS.md / CLAUDE.md) and capture the results.\n\n` +
    `Return the structured gap report. Do NOT fix anything — report only.`,
  { label: 'finalize', phase: 'Finalize', schema: FINALIZE_REPORT },
)

return { halted: false, results, report }
