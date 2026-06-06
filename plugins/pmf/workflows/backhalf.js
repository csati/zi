export const meta = {
  name: 'pipeline-backhalf',
  description: 'Implement each /decompose stage with a fresh agent in order, independently verify its green on the committed state before advancing, halting on conflict, then finalize against the PRD',
  phases: [
    { title: 'Implement', detail: 'one fresh agent per stage, in order' },
    { title: 'Verify', detail: "a separate agent re-runs each stage's acceptance commands on the committed state before the next stage starts" },
    { title: 'Finalize', detail: 'verify the whole feature against its PRD' },
  ],
}

// Args (passed by the /implement-all command):
//   args.prd    — the .pmf/{slug}/prd.md to finalize against
//   args.stages — ORDERED list of .pmf/{slug}/plan-stage-NN.md paths
//
// Paths are relative to the repo working directory (the pipeline keeps each
// feature's artifacts together in a .pmf/{slug}/ task directory). The script has
// no filesystem access, so the caller must pass the stage list; it cannot glob
// for it. Stages run strictly sequentially because each one assumes the
// committed repo state the previous one left behind.

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
        required: ['id', 'status', 'verifiedBy'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['met', 'partial', 'missing'] },
          verifiedBy: {
            type: 'string',
            enum: ['test', 'inspection'],
            description: "test = established by EXECUTING the FR's recorded selector; inspection = established by reading code, allowed ONLY for inspection-only or waived FRs",
          },
          testCommand: { type: 'string', description: "For verifiedBy=test: the exact selector that was run (the FR's recorded acceptance command). Empty for inspection." },
          testResult: { type: 'string', enum: ['pass', 'fail', 'n/a'], description: 'Result of running testCommand; n/a when verifiedBy=inspection' },
          evidence: { type: 'string', description: 'For test: the selector output/summary. For inspection: file:line for met, the specific absence for missing.' },
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

// The per-stage green gate. After a stage reports `done`, a SEPARATE agent
// re-establishes the green claim against the COMMITTED repo state before the
// next stage runs — the implementer never advances on its own word. The verifier
// is a bash proxy, NOT a judge: it runs the stage's exact acceptance commands and
// reports raw facts (exit codes, clean-tree, commit-present); the PASS/FAIL
// decision is made mechanically by `verificationPassed()` below, not by the agent.
// This same step is the one shared per-stage gate that 01's review-driven fixes
// re-enter — keep it a single reusable function, not two re-verify mechanisms.
const VERIFICATION_RESULT = {
  type: 'object',
  required: ['cleanTree', 'commitPresent', 'checks'],
  additionalProperties: false,
  properties: {
    cleanTree: {
      type: 'boolean',
      description:
        'BEFORE re-running anything, the working tree had no uncommitted source changes — `git status --porcelain` empty except for `.pmf/` pipeline artifacts. False means the implementer\'s green may reflect uncommitted edits rather than the committed state — the primary failure this gate exists to catch.',
    },
    cleanTreeEvidence: {
      type: 'string',
      description: 'The verbatim `git status --porcelain` output observed before re-running the checks (empty string when clean).',
    },
    commitPresent: { type: 'boolean', description: "The stage's reported commit is present at or near HEAD on the current branch." },
    commit: { type: 'string', description: 'The commit confirmed present (hash + subject from `git log`).' },
    checks: {
      type: 'array',
      description:
        'One entry per acceptance command re-run, in the order the stage file lists them. Empty only if the stage names no runnable acceptance command.',
      items: {
        type: 'object',
        required: ['command', 'exitCode'],
        additionalProperties: false,
        properties: {
          command: { type: 'string', description: "The exact command run, verbatim from the stage's Acceptance criteria." },
          kind: {
            type: 'string',
            enum: ['selector', 'build', 'test', 'lint', 'other'],
            description: 'Which acceptance command this is.',
          },
          exitCode: { type: 'integer', description: 'Process exit code. 0 = passed; any non-zero = failed.' },
          outputTail: { type: 'string', description: 'Last ~20 lines of combined stdout/stderr — the actual output, not a paraphrase.' },
        },
      },
    },
    restoredClean: {
      type: 'boolean',
      description: 'After re-running the checks and restoring, the working tree is back to the committed state (no leftover build artifacts outside gitignored paths or `.pmf/`).',
    },
    detail: { type: 'string', description: 'Brief factual summary of what was run. NOT a judgment of whether the acceptance criteria are met.' },
  },
}

const verifierPrompt = (file, expectedCommit) =>
  `You are an INDEPENDENT VERIFIER for ONE stage of a decomposed feature, running with a fresh context. ` +
  `You did NOT implement this stage and you are NOT a judge. Your only job is to mechanically re-establish — against the COMMITTED repo state — that the stage's green claim is real, then report raw facts. ` +
  `You are a bash proxy: run the exact commands the stage names and record their exit codes and output. ` +
  `Do NOT interpret whether the acceptance criteria are "met", do NOT edit, fix, stage, commit, or re-implement anything, and do NOT run any command the stage does not name (beyond the git status/log and tree-restore commands described below).\n\n` +
  `The stage just reported done with commit subject: "${expectedCommit || '(none reported)'}".\n\n` +
  `STEP 1 — extract the acceptance commands. Read the stage file at \`${file}\` (a path relative to the repo working directory). From its "## Acceptance criteria" section, collect VERBATIM every runnable command it names:\n` +
  `  - each per-FR selector ("FR-N proven: \`<selector>\` passes"),\n` +
  `  - the build command ("Build is green: \`<cmd>\`"),\n` +
  `  - the test command ("Tests pass: \`<cmd>\`"),\n` +
  `  - the lint/format command, if one is listed.\n` +
  `Use each command exactly as written — never re-derive, substitute, broaden, or "improve" it. If the section names no runnable command (e.g. tests were waived and no build/lint is listed), record an empty checks list and say so in detail — do NOT invent one.\n\n` +
  `STEP 2 — confirm a clean COMMITTED state. Before running any acceptance command, run \`git status --porcelain\`. Treat the tree as clean ONLY if it shows nothing outside the \`.pmf/\` pipeline-artifact directory: untracked \`.pmf/...\` planning files are expected and do NOT count as dirty, but ANY tracked modification, or any untracked file outside \`.pmf/\`, DOES. A dirty tree means the implementer's green may reflect uncommitted edits rather than the commit — set cleanTree=false, put the verbatim \`git status --porcelain\` output in cleanTreeEvidence, and treat the verification as failed (you may skip STEP 3). If clean, set cleanTree=true and record the (empty) output in cleanTreeEvidence. Then confirm the commit: run \`git log -1 --format='%h %s'\` (and \`git log --oneline -5\` for context); set commitPresent=true and record it in \`commit\` only if a commit matching the reported subject is at or near HEAD.\n\n` +
  `STEP 3 — re-run the acceptance commands (only if the tree was clean). Run each command from STEP 1, in the order listed. For each, capture its real exit code and the last ~20 lines of combined stdout/stderr, and add one checks[] entry with the verbatim command, its kind, the exit code, and the output tail. Report exit codes faithfully — NEVER report 0 for a command you did not actually run to completion, and never paper over a non-zero exit.\n\n` +
  `STEP 4 — leave the working tree exactly as you found it. Re-running build/test can emit artifacts, and both the next stage and the next verifier assume a clean tree. Restore the committed state WITHOUT deleting gitignored caches or the \`.pmf/\` artifacts: revert tracked changes with \`git checkout -- .\`, then remove only build artifacts that newly appeared outside \`.pmf/\` and are not gitignored (e.g. \`git clean -fd -e .pmf\` — no \`-x\`, so gitignored caches stay). Run \`git status --porcelain\` once more and set restoredClean=true if the tree is back to the committed state (ignoring \`.pmf/\`), else false with the residue noted in detail.\n\n` +
  `Return the structured result — raw facts only. Whether the stage PASSES is decided mechanically by the workflow from your cleanTree, commitPresent, and per-command exit codes, NOT by you. Do not soften, omit, or pre-judge a non-zero exit code or a dirty tree.`

// Spawn the verifier for one stage. A reusable step so 01's review-driven fixes
// re-enter the identical gate (same commands, clean-tree + commit check).
async function verifyStage(file, n, expectedCommit) {
  return await agent(verifierPrompt(file, expectedCommit), {
    label: `verify-${n}`,
    phase: 'Verify',
    schema: VERIFICATION_RESULT,
  })
}

// The gate is mechanical: clean tree (pre-checks) + commit present + at least one
// acceptance command, all returning exit code 0. No discretion lives here either.
function verificationPassed(ver) {
  return !!(
    ver &&
    ver.cleanTree === true &&
    ver.commitPresent === true &&
    Array.isArray(ver.checks) &&
    ver.checks.length > 0 &&
    ver.checks.every((c) => c && c.exitCode === 0)
  )
}

// A concise human-readable reason the gate failed, for the halt log.
function verificationSummary(ver) {
  if (!ver) return 'verifier returned no result'
  if (ver.cleanTree !== true) return `working tree not clean before checks: ${ver.cleanTreeEvidence || '(no evidence)'}`
  if (ver.commitPresent !== true) return 'stage commit not found at/near HEAD'
  if (!Array.isArray(ver.checks) || ver.checks.length === 0) return 'no acceptance commands found to re-run'
  const failed = ver.checks.filter((c) => !c || c.exitCode !== 0)
  if (failed.length) return failed.map((c) => `\`${c.command}\` exited ${c ? c.exitCode : '?'}`).join('; ')
  return ver.detail || 'unknown verification failure'
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
      `Read the plan file at \`${file}\` (a path relative to the repo working directory) and follow it exactly.\n\n` +
      `STEP 1 — verify reality. Read the files the plan lists under "Context to load" and confirm EVERY precondition in the plan actually holds in the current repo. ` +
      `If any precondition is false, or the plan contradicts what the code now shows, DO NOT work around it: return status "conflict" with a precise explanation of the mismatch, and STOP without editing anything.\n\n` +
      `STEP 2 — implement. Otherwise carry out the plan's Tasks. Describe-to-code yourself against the real repo; the plan states intent, not literal source.\n\n` +
      `STEP 3 — make it green. Satisfy the stage's Acceptance criteria: the exact build, test, and lint commands named in the plan must pass. If you cannot get them green, return status "failed" with the failing output.\n\n` +
      `STEP 4 — commit and report. On success, commit as the plan's Handoff instructs, then return status "done" with the commit subject and your approximate token usage.`,
    { label: `stage-${n}`, phase: 'Implement', schema: STAGE_RESULT },
  )

  const entry = { file, result: res }
  results.push(entry)

  if (!res || res.status !== 'done') {
    const status = res ? res.status : 'null'
    const detail = res ? res.detail : 'agent returned no result'
    log(`Halting at ${file}: status="${status}" — ${detail}`)
    return { halted: true, reason: status, atStage: file, results }
  }

  log(`Stage ${n} implemented: ${res.commit || '(no commit subject reported)'} — verifying`)

  // Independent green gate, between stage N and N+1 (strictly sequential; never
  // overlapping either). A second agent re-runs this stage's exact acceptance
  // commands on the committed state and reports raw facts; the workflow — not the
  // agent — decides pass/fail. No stage advances on the implementer's word alone.
  const ver = await verifyStage(file, n, res.commit)
  entry.verification = ver

  if (!verificationPassed(ver)) {
    log(`Halting at ${file}: independent verification failed — ${verificationSummary(ver)}`)
    return { halted: true, reason: 'verification-failed', atStage: file, results }
  }

  log(`Stage ${n} verified green on the committed state.`)
}

phase('Finalize')

const stageList = stages.map((s) => `\`${s}\``).join(', ')

const report = await agent(
  `All decomposition stages are implemented and committed. Verify the WHOLE feature against its PRD \`${prd}\`, end to end.\n\n` +
    `The PRD classifies each FR as \`test-coverable\` or \`inspection-only\`. The stage files (${stageList || 'none passed'}) record, for each \`test-coverable\` FR, a **test selector** — the exact command that runs that FR's acceptance test — and may record a **test waiver**. Read the PRD for the classifications and the stage files for the selectors and any waiver.\n\n` +
    `For every FR, establish whether it is met and record HOW in the schema's per-FR fields:\n` +
    `- \`test-coverable\` FR → set verifiedBy="test": RUN its recorded selector, set testCommand to that selector and testResult to pass/fail, and base met/partial/missing on the actual result (a selector that resolves to no test is "missing"). EXECUTE it — do not substitute reading the code.\n` +
    `- \`inspection-only\` FR, or any FR under a recorded waiver → set verifiedBy="inspection", testCommand empty, testResult="n/a": judge it by reading the code/artifact with file:line evidence. Use inspection ONLY for these — never to stand in for a selector that should have been run.\n\n` +
    `Check non-goals were respected and technical constraints honoured.\n\n` +
    `Then run the project's FULL build, test, and lint commands (discover them from AGENTS.md / CLAUDE.md) and capture the results.\n\n` +
    `Return the structured gap report. Do NOT fix anything — report only.`,
  { label: 'finalize', phase: 'Finalize', schema: FINALIZE_REPORT },
)

return { halted: false, results, report }
