export const meta = {
  name: 'pipeline-backhalf',
  description: 'Implement each /decompose stage with a fresh agent in order, independently verify its green on the committed state, adversarially review the diff (confirmed majors halt, confirmed minors are fixed and re-verified) before advancing, halting on conflict, then finalize against the PRD',
  phases: [
    { title: 'Implement', detail: 'one fresh agent per stage, in order' },
    { title: 'Verify', detail: "a separate agent re-runs each stage's acceptance commands on the committed state before review" },
    { title: 'Review', detail: 'a third agent adversarially reviews each stage diff; a confirmed major halts, a confirmed minor is fixed and re-verified through the same green gate' },
    { title: 'Finalize', detail: 'verify the whole feature against its PRD' },
  ],
}

// Args (passed by the /implement-all command):
//   args.prd     — the .pmf/{slug}/prd.md to finalize against
//   args.stages  — ORDERED list of .pmf/{slug}/plan-stage-NN.md paths
//   args.startAt — OPTIONAL resume point: the 1-based index (or the path) of a
//                  stage whose halt the orchestrating layer has already resolved
//                  (a delegated/manual fix committed, or a recorded waiver).
//                  Stages before it are skipped (trusted committed); the resolved
//                  stage is re-verified through the shared green gate — NOT
//                  re-implemented or re-reviewed — then the loop advances. Stages
//                  after it run the full implement→verify→review tail. Absent ⇒
//                  a fresh run from stage 1. See resolveStartIndex() below.
//   args.baseRef — OPTIONAL audit field: the pre-run HEAD SHA that the
//                  /implement-all command captured before any branch switch. The
//                  script does NOT act on it (branch management lives entirely in
//                  the interactive command); it only echoes it back in every
//                  return so the rollback anchor lands in the audit trail. Absent
//                  on resume and on older callers.
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

// --- Adversarial review (01) -------------------------------------------------
// After a stage is green, a SEPARATE reviewer (never the implementer) reads the
// stage's commit diff and RAISES findings — it does not get to confirm its own.
// Every finding is a claim until a separate step substantiates both its reality
// and its severity (see confirmMajors / fixMinors below). Findings are validated
// data, mirroring STAGE_RESULT / VERIFICATION_RESULT — not prose.
const REVIEW_RESULT = {
  type: 'object',
  required: ['findings'],
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      description: 'One entry per issue found in THIS stage\'s commit diff. Empty when the diff is clean.',
      items: {
        type: 'object',
        required: ['severity', 'file', 'claim'],
        additionalProperties: false,
        properties: {
          severity: {
            type: 'string',
            enum: ['minor', 'major'],
            description:
              'major = a real correctness/security/data-loss/contract bug that should block shipping and needs human judgment; minor = a localized quality issue safely auto-fixable without judgment (style/conformance, a narrow missing guard, a small perf nit). The raising reviewer\'s label is a claim — a confirmer re-checks every major and may refute or downgrade it.',
          },
          category: {
            type: 'string',
            enum: ['correctness', 'security', 'edge-case', 'error-handling', 'performance', 'conformance', 'other'],
            description: 'Which class of issue, per the reviewer charter.',
          },
          file: { type: 'string', description: 'Path (relative to the repo) of the offending code, within this stage\'s diff.' },
          line: { type: 'string', description: 'file:line or line range within the diff where the issue lives.' },
          claim: { type: 'string', description: 'What is wrong and why it matters — concrete, pointing at the diff.' },
          suggestedFix: { type: 'string', description: 'A concrete suggested fix.' },
        },
      },
    },
    summary: { type: 'string', description: 'One-line summary of the review; say "clean" when there are no findings.' },
  },
}

// The dedicated CONFIRMER for reviewer-`major` findings — a THIRD perspective,
// distinct from both the implementer and the reviewer. A confirmed major is what
// halts the unattended run, so it must be substantiated here, never taken on the
// reviewer's word. One verdict per major finding passed in, echoing its ref.
const CONFIRM_RESULT = {
  type: 'object',
  required: ['verdicts'],
  additionalProperties: false,
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['ref', 'verdict', 'reason'],
        additionalProperties: false,
        properties: {
          ref: { type: 'string', description: 'The ref (e.g. "F2") of the reviewer finding this verdict answers, exactly as passed in.' },
          verdict: {
            type: 'string',
            enum: ['confirmed-major', 'downgraded-minor', 'refuted'],
            description:
              'confirmed-major = independently reproduced AND ship-blocking (halts the run); downgraded-minor = real but not ship-blocking (flows to the fix path, does NOT halt); refuted = not a real problem (dropped). Default to refuted when you cannot concretely reproduce it.',
          },
          reason: { type: 'string', description: 'Concrete evidence for the verdict — the code path / input that breaks it, or why it does not.' },
        },
      },
    },
  },
}

// The FIX agent for `minor` findings is ALSO their confirmer: reality and fix
// land in one step because the run proceeds either way. Per finding it either
// fixes (confirmed real) or drops it (false positive / over-stated) with a
// reason. It then commits so the tree is clean for the next stage; commitMode
// records whether it amended the stage commit or added a follow-up, so the
// green gate's commit-present check stays accurate.
const FIX_RESULT = {
  type: 'object',
  required: ['outcomes', 'commitMode'],
  additionalProperties: false,
  properties: {
    outcomes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['ref', 'action', 'reason'],
        additionalProperties: false,
        properties: {
          ref: { type: 'string', description: 'The ref (e.g. "F3") of the minor finding this outcome answers, exactly as passed in.' },
          action: {
            type: 'string',
            enum: ['fixed', 'dropped'],
            description: 'fixed = confirmed real and a minimal fix was made; dropped = false positive / over-stated, nothing changed for it.',
          },
          reason: { type: 'string', description: 'Why it was fixed (what the fix does) or dropped (why it is not a real minor issue).' },
        },
      },
    },
    commitMode: {
      type: 'string',
      enum: ['amended', 'follow-up', 'none'],
      description: 'amended = amended the stage commit; follow-up = added a new commit; none = nothing was fixed so no commit was made.',
    },
    commit: { type: 'string', description: 'Resulting commit (hash + subject) after the fixes; empty when commitMode=none.' },
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
// reports raw facts (exit codes, clean-tree, commit-present); the pass/warn/fail
// decision is made mechanically by `gateStatus()` below, not by the agent.
// This same step is the one shared per-stage gate that 01's review-driven fixes
// re-enter — keep it a single reusable function, not two re-verify mechanisms.
const VERIFICATION_RESULT = {
  type: 'object',
  required: ['cleanTree', 'commitPresent', 'checks', 'noRunnableCommands'],
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
    noRunnableCommands: {
      type: 'boolean',
      description:
        "TRUE only when STEP 1 actually read the stage's Acceptance criteria and it names NO runnable command at all (tests waived in /decompose, and no build/lint listed) — an affirmative declaration that there is nothing to run, paired with an empty checks list. NEVER true merely because you skipped extraction, could not read the file, ran out of time, or the tree was dirty: those keep an empty checks list WITHOUT this flag and stay a failure. Whenever you extracted one or more commands, set false.",
    },
    restoredClean: {
      type: 'boolean',
      description: 'After re-running the checks and restoring, the working tree is back to the committed state (no leftover build artifacts outside gitignored paths or `.pmf/`).',
    },
    ownershipExtras: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Paths the stage\'s commit changed that are ABSENT from its declared "## Files this stage owns" list (`.pmf/` artifacts excluded). OPTIONAL — defaults to [] when omitted; left empty on the resume re-verify, which has no fresh stage commit to scope. You only REPORT these; the workflow, not you, decides what to do with them.',
    },
    detail: { type: 'string', description: 'Brief factual summary of what was run. NOT a judgment of whether the acceptance criteria are met.' },
  },
}

const verifierPrompt = (file, expectedCommit, opts = {}) => {
  const { checkOwnership = true, fixCommitMode = null } = opts
  // STEP 2b — the commit-ownership axis (04). Reported by the verifier, classified
  // by the workflow. Skipped on the resume re-verify (a deliberate human/delegated
  // fix may legitimately touch non-owned files), where it leaves the list empty.
  const ownershipStep = checkOwnership
    ? `STEP 2b — check the commit's file ownership (report only — the workflow, not you, decides what to do with the result). ` +
      `Read the "## Files this stage owns" section of the stage file \`${file}\` (the same file you read in STEP 1). Each entry is a markdown list item whose first backtick-quoted token is the path (e.g. \`- \`src/foo.js\` — modified — …\`); extract that backtick-quoted path from every bullet under that section. That set is the stage's declared ownership allow-list. ` +
      `Then list the files the stage's commit ACTUALLY changed: ` +
      (fixCommitMode === 'follow-up'
        ? `the stage's work here spans TWO commits — the stage commit at HEAD~1 and a follow-up fix commit at HEAD — so take the UNION of the names from \`git show --name-only --format= HEAD~1\` and \`git show --name-only --format= HEAD\`. `
        : `run \`git show --name-only --format= HEAD\` (the stage's single commit, which you confirmed at HEAD in STEP 2). `) +
      `Compute ownershipExtras = every changed path that matches NONE of the ownership entries, applying these rules to repo-relative paths (strip any leading \`./\`):\n` +
      `  - EXCLUDE every path under \`.pmf/\`: pipeline artifacts are always exempt and are never an extra.\n` +
      `  - An ownership entry that names a file matches that EXACT path only.\n` +
      `  - An ownership entry that names a directory (it ends with \`/\`, or clearly denotes a directory rather than a file) matches any changed path UNDER it (prefix match at the \`/\` boundary).\n` +
      `  - If an entry contains a \`*\` glob, match it by the literal prefix up to the first \`*\` only; do not otherwise expand or interpret globs.\n` +
      `  - When you are UNSURE whether a changed path is covered, do NOT list it as an extra — a false positive here is worse than a miss, since the implementer was already instructed to scope its own commit and this is only a backstop.\n` +
      `Put the resulting (possibly empty) list in ownershipExtras. Do NOT judge, halt, fix, or react to it — only report; the workflow classifies it.\n\n`
    : `STEP 2b — SKIP the file-ownership check on this resume re-verify: set ownershipExtras to an empty list ([]). HEAD may legitimately carry a deliberate human or delegated fix that touches files outside the stage's original ownership, so no ownership comparison is performed here.\n\n`
  return (
    `You are an INDEPENDENT VERIFIER for ONE stage of a decomposed feature, running with a fresh context. ` +
    `You did NOT implement this stage and you are NOT a judge. Your only job is to mechanically re-establish — against the COMMITTED repo state — that the stage's green claim is real, then report raw facts. ` +
    `You are a bash proxy: run the exact commands the stage names and record their exit codes and output. ` +
    `Do NOT interpret whether the acceptance criteria are "met", do NOT edit, fix, stage, commit, or re-implement anything, and do NOT run any command the stage does not name (beyond the git status/log/show and tree-restore commands described below).\n\n` +
    `The stage just reported done with commit subject: "${expectedCommit || '(none reported)'}".\n\n` +
    `STEP 1 — extract the acceptance commands. Read the stage file at \`${file}\` (a path relative to the repo working directory). From its "## Acceptance criteria" section, collect VERBATIM every runnable command it names:\n` +
    `  - each per-FR selector ("FR-N proven: \`<selector>\` passes"),\n` +
    `  - the build command ("Build is green: \`<cmd>\`"),\n` +
    `  - the test command ("Tests pass: \`<cmd>\`"),\n` +
    `  - the lint/format command, if one is listed.\n` +
    `Use each command exactly as written — never re-derive, substitute, broaden, or "improve" it. If — and ONLY if — you read the Acceptance criteria and it genuinely names no runnable command (e.g. tests were waived in /decompose and no build/lint is listed), record an empty checks list AND set noRunnableCommands=true as a deliberate, affirmative declaration that there is nothing to run, and say so in detail — do NOT invent one. Set noRunnableCommands=true ONLY in that case: NEVER because you skipped extraction, could not read the stage file, ran out of time, or the tree was dirty — those keep checks empty but leave noRunnableCommands=false (and stay a failure). Whenever you extract one or more commands, set noRunnableCommands=false.\n\n` +
    `STEP 2 — confirm a clean COMMITTED state. Before running any acceptance command, run \`git status --porcelain\`. Treat the tree as clean ONLY if it shows nothing outside the \`.pmf/\` pipeline-artifact directory: untracked \`.pmf/...\` planning files are expected and do NOT count as dirty, but ANY tracked modification, or any untracked file outside \`.pmf/\`, DOES. A dirty tree means the implementer's green may reflect uncommitted edits rather than the commit — set cleanTree=false, put the verbatim \`git status --porcelain\` output in cleanTreeEvidence, and treat the verification as failed (you may skip STEP 3). If clean, set cleanTree=true and record the (empty) output in cleanTreeEvidence. Then confirm the commit: run \`git log -1 --format='%h %s'\` (and \`git log --oneline -5\` for context). ${expectedCommit ? 'Set commitPresent=true and record it in `commit` only if a commit matching the reported subject is at or near HEAD.' : "No specific commit subject was reported (this is a RESUME re-verify of a stage whose halt was already resolved, so the work may have been amended or followed up by a separate fix). Set commitPresent=true if HEAD is a real commit on the current branch and the tree is clean — i.e. the stage's work IS committed — and record HEAD's hash+subject in `commit`."}\n\n` +
    ownershipStep +
    `STEP 3 — re-run the acceptance commands (only if the tree was clean). Run each command from STEP 1, in the order listed. For each, capture its real exit code and the last ~20 lines of combined stdout/stderr, and add one checks[] entry with the verbatim command, its kind, the exit code, and the output tail. Report exit codes faithfully — NEVER report 0 for a command you did not actually run to completion, and never paper over a non-zero exit.\n\n` +
    `STEP 4 — leave the working tree exactly as you found it. Re-running build/test can emit artifacts, and both the next stage and the next verifier assume a clean tree. Restore the committed state WITHOUT deleting gitignored caches or the \`.pmf/\` artifacts: revert tracked changes with \`git checkout -- .\`, then remove only build artifacts that newly appeared outside \`.pmf/\` and are not gitignored (e.g. \`git clean -fd -e .pmf\` — no \`-x\`, so gitignored caches stay). Run \`git status --porcelain\` once more and set restoredClean=true if the tree is back to the committed state (ignoring \`.pmf/\`), else false with the residue noted in detail.\n\n` +
    `Return the structured result — raw facts only. Whether the stage PASSES is decided mechanically by the workflow from your cleanTree, commitPresent, and per-command exit codes, NOT by you. Do not soften, omit, or pre-judge a non-zero exit code or a dirty tree.`
  )
}

// Spawn the verifier for one stage. A reusable step so 01's review-driven fixes
// re-enter the identical gate (same commands, clean-tree + commit check).
async function verifyStage(file, n, expectedCommit, opts = {}) {
  return await agent(verifierPrompt(file, expectedCommit, opts), {
    label: `verify-${n}`,
    phase: 'Verify',
    schema: VERIFICATION_RESULT,
  })
}

// The single mechanical gate. Returns one of three statuses from the verifier's
// raw facts — no discretion lives here either:
//   'fail' — dirty tree, missing commit, any present check with a non-zero exit,
//            OR an empty checks list WITHOUT the verifier's affirmative
//            noRunnableCommands flag (the sloppy / failed-extraction case, kept
//            fail-closed so a verifier that simply didn't look never advances).
//   'warn' — clean tree + commit present + the verifier AFFIRMATIVELY declared no
//            runnable command (noRunnableCommands===true) and so ran none. The one
//            path that advances UNVERIFIED-BY-TEST: a deliberately command-less
//            stage (tests waived, docs-only, or a build-less/interpreted project).
//   'pass' — clean tree + commit present + at least one check, all exit 0.
// Both anti-cheat axes are guarded here: warn still requires a clean tree + commit
// present (a waived stage must really have committed), and requires the verifier's
// deliberate flag (empty checks ALONE never warns). All three call sites consume
// THIS one function (via gateOutcome) so the gate stays a single reusable decision,
// not a boolean plus per-site sibling predicates one forgotten `|| vacuous` from
// silently reinstating the halt on a single path.
function gateStatus(ver) {
  if (!ver || ver.cleanTree !== true || ver.commitPresent !== true) return 'fail'
  const checks = Array.isArray(ver.checks) ? ver.checks : []
  if (checks.length === 0) {
    // Empty checks is ambiguous — a genuine waiver vs a verifier that failed to
    // extract a real command. Only the verifier's affirmative flag makes it a
    // warn; without it, stay fail-closed.
    return ver.noRunnableCommands === true ? 'warn' : 'fail'
  }
  return checks.every((c) => c && c.exitCode === 0) ? 'pass' : 'fail'
}

// Apply the single gate uniformly at every call site. Returns the status; on
// 'warn' it stamps unverifiedByTest on the verification object — so the report,
// /implement-all, and finalize can flag a stage that had no executable gate (no
// silent caps: the user must see which stages advanced without a test) — and logs
// the UNVERIFIED-BY-TEST advance line. The caller halts on 'fail', advances on
// 'pass'/'warn'.
function gateOutcome(ver, n) {
  const status = gateStatus(ver)
  if (status === 'warn') {
    if (ver) ver.unverifiedByTest = true
    log(
      `Stage ${n} verified: clean tree + commit present, but the stage names NO runnable acceptance command — advancing UNVERIFIED-BY-TEST.`,
    )
  }
  return status
}

// A concise human-readable reason the gate did not cleanly pass, for the halt log.
// cleanTree / commitPresent are checked first so a dirty tree with zero checks
// still reports the dirty-tree message, not the zero-checks one.
function verificationSummary(ver) {
  if (!ver) return 'verifier returned no result'
  if (ver.cleanTree !== true) return `working tree not clean before checks: ${ver.cleanTreeEvidence || '(no evidence)'}`
  if (ver.commitPresent !== true) return 'stage commit not found at/near HEAD'
  if (!Array.isArray(ver.checks) || ver.checks.length === 0) {
    return ver.noRunnableCommands === true
      ? 'stage names no runnable acceptance command (verifier affirmed it) — advanced UNVERIFIED-BY-TEST'
      : 'no acceptance commands found to re-run, and the verifier did not affirm the stage is command-less — treated as a failed/skipped extraction'
  }
  const failed = ver.checks.filter((c) => !c || c.exitCode !== 0)
  if (failed.length) return failed.map((c) => `\`${c.command}\` exited ${c ? c.exitCode : '?'}`).join('; ')
  return ver.detail || 'unknown verification failure'
}

// --- Commit-ownership axis (04) ---------------------------------------------
// The implementer is told to scope its commit to the stage's declared "Files
// this stage owns" list (STEP 4 of the implementer prompt). The verifier reports
// any committed file absent from that list as `ownershipExtras` (STEP 2b). This
// axis classifies those extras. It is DELIBERATELY a separate function from
// gateStatus — never folded into its `warn` — so 03's UNVERIFIED-BY-TEST message
// and `unverifiedByTest` flag stay untouched on a fully-tested stage that merely
// drifted; the call site combines the two orthogonal axes and neither mutates the
// other. Part A (scoping the implementer's commit) is the real guard; this is
// after-the-fact detection — by the time we see a committed secret it is already
// in branch history, so a 'secret' halts loudly and routes to a human rewrite.

// Secret-shaped paths, mirrored from the bundled /pmf:stage command: a basename
// starting with `.env`, any path containing "credentials", or a `.key`/`.pem`
// extension. A file of this shape must never be auto-committed unless the stage
// explicitly owns it.
const SECRET_SHAPE = [/(^|\/)\.env[^/]*$/, /credentials/i, /\.key$/, /\.pem$/]
const isSecretPath = (p) => typeof p === 'string' && SECRET_SHAPE.some((re) => re.test(p))

// Classify the verifier's ownershipExtras into the ownership axis:
//   'secret' — ≥1 extra is secret-shaped (already in branch history → HALT).
//   'drift'  — extras exist, none secret-shaped (advance, but log + surface them).
//   'ok'     — no extras: the commit stayed within its declared ownership, OR the
//              axis was skipped (the resume re-verify leaves the list empty).
function ownershipStatus(ver) {
  const extras = ver && Array.isArray(ver.ownershipExtras) ? ver.ownershipExtras : []
  if (!extras.length) return 'ok'
  return extras.some(isSecretPath) ? 'secret' : 'drift'
}

// Apply the ownership axis at a call site: return 'halt' | 'advance', logging
// either way. Mirrors gateOutcome's split — this decides + logs, the caller does
// the actual halt `return` so `results`/`baseRef` stay local to the loop. `what`
// names the commit under scrutiny ("stage commit" / "minor-fix commit").
function ownershipOutcome(ver, n, file, what) {
  const status = ownershipStatus(ver)
  if (status === 'ok') return 'advance'
  const extras = ver && Array.isArray(ver.ownershipExtras) ? ver.ownershipExtras : []
  if (status === 'secret') {
    const secrets = extras.filter(isSecretPath)
    const others = extras.filter((p) => !isSecretPath(p))
    log(
      `Halting at ${file}: stage ${n}'s ${what} added secret-shaped file(s) OUTSIDE its declared ownership — ${secrets.join(', ')}. ` +
        `These are already committed to branch history; a human must rewrite the commit, then resume.` +
        (others.length ? ` Other non-owned files in the same commit: ${others.join(', ')}.` : ''),
    )
    return 'halt'
  }
  log(
    `Stage ${n}: ${what} touched file(s) outside its declared ownership — ${extras.join(', ')}. ` +
      `Advancing; the scope drift is surfaced in the verification record.`,
  )
  return 'advance'
}

// --- Adversarial review agents (01) -----------------------------------------
// All three read ONLY this stage's commit diff (`git show`/`git diff`), not the
// whole repo, and NONE re-run the build/test/lint suite — that already passed
// the green gate; review and confirmation are cheap diff-reading. Only the
// post-fix re-verify (verifyStage) re-runs the suite, and only when a minor was
// actually fixed.

const diffScope = (expectedCommit) =>
  `Scope yourself to THIS stage's commit diff — do NOT read or judge unrelated code. ` +
  `The stage reported commit "${expectedCommit || '(none reported)'}". ` +
  `Identify it (\`git log -1 --format='%h %s'\`, \`git log --oneline -5\` for context) and read its diff with \`git show <hash>\` (or \`git diff <hash>^ <hash>\`). ` +
  `You MAY open surrounding files for context — to judge conformance and spot broken assumptions — but review only what this diff changes. ` +
  `Do NOT re-run the build/test/lint suite: it already passed an independent green gate, and this is a cheap diff read. Do NOT stage or push.`

// Render a finding list for a prompt, each line tagged with its stable ref so the
// confirmer / fix agent can echo the ref back and we can match verdicts to findings.
const findingsList = (findings) =>
  findings
    .map(
      (f) =>
        `- [${f.ref}] (${f.severity}/${f.category || 'other'}) ${f.file}${f.line ? ':' + f.line : ''} — ${f.claim}` +
        (f.suggestedFix ? `\n    suggested fix: ${f.suggestedFix}` : ''),
    )
    .join('\n')

// The reviewer RAISES findings; it never confirms its own. It works off the
// stage's commit DIFF, not the plan file — hence no stage-file path here.
async function reviewStage(n, expectedCommit) {
  return await agent(
    `You are an INDEPENDENT ADVERSARIAL CODE REVIEWER for ONE stage of a decomposed feature, with a fresh context. ` +
      `You did NOT implement this stage, and you are NOT checking whether it works — it is already implemented, committed, and independently verified green. ` +
      `Your job is whether it is GOOD: real correctness/logic bugs, security issues, unhandled edge cases and error paths, resource/performance foot-guns, and places it violates the surrounding code's established patterns or the repo's lint/format configuration. Review the diff against the LIVE repo, not the plan.\n\n` +
      diffScope(expectedCommit) +
      `\n\nYou only RAISE findings — you do NOT confirm, fix, edit, or commit anything; a separate step substantiates every finding before it counts. Each finding is a claim, not a verdict.\n\n` +
      `For each real issue, emit one finding: severity ("major" = a real correctness/security/data-loss/contract bug that should block shipping and needs human judgment; "minor" = a localized quality issue safely auto-fixable without judgment — style/conformance, a narrow missing guard, a small perf nit), plus category, file, line (file:line), claim (what's wrong and why it matters), and a concrete suggestedFix. ` +
      `Be precise and conservative: raise only what you can point to in the diff, and do NOT inflate severity — a confirmer re-checks every major and will refute over-statements. If the diff is clean, return an empty findings list and summary "clean".`,
    { label: `review-${n}`, phase: 'Review', schema: REVIEW_RESULT },
  )
}

// The dedicated confirmer — a third perspective — substantiates each MAJOR.
async function confirmMajors(n, expectedCommit, majors) {
  return await agent(
    `You are a DEDICATED FINDINGS CONFIRMER — a THIRD, independent perspective, distinct from BOTH the implementer and the reviewer — for ONE stage, with a fresh context. ` +
      `A reviewer raised the MAJOR findings below against this stage's commit diff. A confirmed major HALTS the unattended run, so for EACH finding you must independently reproduce-or-refute both that it is REAL and that "major" is the RIGHT severity, before the run is allowed to halt on it. Do NOT trust the reviewer's word.\n\n` +
      diffScope(expectedCommit) +
      `\n\nDo NOT edit, fix, or commit anything — you only return verdicts.\n\n` +
      `For EACH finding (echo its ref) return one verdict: "confirmed-major" (you independently reproduced it AND it is a real, ship-blocking major — give the concrete code path / input that breaks it); "downgraded-minor" (real but NOT ship-blocking — a localized quality issue; say why it's minor); or "refuted" (not a real problem — say why, e.g. the guard exists elsewhere, the input can't occur, you misread). ` +
      `Default to "refuted" when you cannot concretely reproduce it: a major halts the run, so it must be substantiated, not assumed.\n\n` +
      `Findings to confirm:\n${findingsList(majors)}`,
    { label: `confirm-${n}`, phase: 'Review', schema: CONFIRM_RESULT },
  )
}

// The fix agent confirms-and-fixes each MINOR (it is the confirmer for minors).
async function fixMinors(n, expectedCommit, minors) {
  return await agent(
    `You are the FIX AGENT and the CONFIRMER for the MINOR review findings of ONE stage, with a fresh context. ` +
      `For each minor finding below you are BOTH the confirmer and (if it is real) the fixer — reality and fix land in one step because the run proceeds either way (a minor never halts the run).\n\n` +
      diffScope(expectedCommit) +
      `\n\nFor EACH finding (echo its ref) decide:\n` +
      `  - If it is a REAL, genuinely-minor issue: FIX it in the working tree with a minimal, surgical change that matches the surrounding code's patterns and the repo's lint/format config. Record action "fixed" with a reason describing the fix.\n` +
      `  - If it is a false positive or over-stated (not actually worth a change): change nothing for it and record action "dropped" with the reason.\n\n` +
      `After fixing everything you intend to fix, make the working tree green and COMMIT the fixes so the tree is clean for the next stage and the next green gate. PREFER amending the stage's existing commit (\`git commit --amend --no-edit\`) so its acceptance gate still finds the stage's commit (set commitMode="amended"); if amending is unsafe, add ONE follow-up commit (commitMode="follow-up"). If you fixed nothing, make no commit (commitMode="none"). Put the resulting commit (hash + subject) in \`commit\`.\n\n` +
      `Do NOT introduce unrelated changes and do NOT touch findings not listed here. A separate green gate re-runs the stage's exact acceptance commands after you, so you need not re-run the full suite — but you MUST leave the tree committed and green.\n\n` +
      `Findings to confirm-and-fix:\n${findingsList(minors)}`,
    { label: `fix-${n}`, phase: 'Review', schema: FIX_RESULT },
  )
}

// Resolve the optional resume point (args.startAt) to a 0-based stage index.
// Accepts a 1-based integer index, a numeric string, or a stage path present in
// `stages`. Anything unrecognized falls back to a fresh run from stage 1.
function resolveStartIndex(stages, startAt) {
  if (startAt == null || startAt === '') return 0
  if (typeof startAt === 'number' && Number.isInteger(startAt)) {
    const idx = startAt - 1
    return idx >= 0 && idx < stages.length ? idx : 0
  }
  if (typeof startAt === 'string') {
    const byPath = stages.indexOf(startAt)
    if (byPath >= 0) return byPath
    const asNum = parseInt(startAt, 10)
    if (!Number.isNaN(asNum)) {
      const idx = asNum - 1
      if (idx >= 0 && idx < stages.length) return idx
    }
  }
  return 0
}

const stages = Array.isArray(args && args.stages) ? args.stages : []
const prd = args && args.prd
// Rollback anchor captured by the command before any branch switch. Echoed back
// in every return for the audit trail; the script never acts on it. Absent ⇒
// the key is simply omitted from the serialized result.
const baseRef = (args && args.baseRef) || undefined

if (!stages.length) {
  log('No stage files passed in args.stages — nothing to implement. Run /decompose first.')
  return { halted: true, reason: 'no-stages', results: [], baseRef }
}

phase('Implement')

// Optional resume point. On a halt the workflow returns and stops; the
// orchestrating layer resolves the halting stage (a delegated/manual fix
// committed, or a recorded waiver) and re-launches with args.startAt. Stages
// before it are trusted committed and skipped; the resolved stage is re-verified
// through the SHARED green gate (not re-implemented, not re-reviewed); stages
// after it run the full implement→verify→review tail.
const startIndex = resolveStartIndex(stages, args && args.startAt)
const resuming = startIndex > 0
if (resuming) {
  log(`Resuming from stage ${String(startIndex + 1).padStart(2, '0')} (\`${stages[startIndex]}\`); stages before it are trusted as already committed.`)
}

const results = []
for (let i = 0; i < stages.length; i++) {
  const file = stages[i]
  const n = String(i + 1).padStart(2, '0')

  // Resume: skip stages already committed before the resolved one.
  if (i < startIndex) {
    results.push({ file, skipped: true, reason: 'committed-before-resume' })
    continue
  }

  // Resume: the resolved stage was already implemented and committed; the halt's
  // resolution (delegated/manual fix, or a waiver) has been applied by the
  // orchestrating layer. Re-enter the shared green gate to confirm it is still
  // green on the committed state, then advance — do NOT re-implement or re-review
  // (a fix is never re-reviewed; a waiver changed no code and stays green).
  if (resuming && i === startIndex) {
    log(`Re-verifying resolved stage ${n} on the committed state before advancing.`)
    // Skip the ownership axis (04) on resume: HEAD may carry a deliberate
    // human/delegated fix that legitimately touches non-owned files, so an
    // ownership check here would manufacture a false halt.
    const rever = await verifyStage(file, n, '', { checkOwnership: false })
    const resumedEntry = { file, result: { status: 'resumed', detail: 'halt resolved by the orchestrating layer; re-verified only on resume' }, verification: rever }
    results.push(resumedEntry)
    const resumeStatus = gateOutcome(rever, n)
    if (resumeStatus === 'fail') {
      log(`Halting at ${file}: resume re-verification failed — ${verificationSummary(rever)}`)
      return { halted: true, reason: 'verification-failed', atStage: file, atStageIndex: i + 1, results, baseRef }
    }
    if (resumeStatus === 'pass') log(`Stage ${n} re-verified green on resume — advancing.`)
    continue
  }

  const res = await agent(
    `You are implementing ONE stage of a decomposed feature, with a fresh context. ` +
      `Read the plan file at \`${file}\` (a path relative to the repo working directory) and follow it exactly.\n\n` +
      `STEP 1 — verify reality. Read the files the plan lists under "Context to load" and confirm EVERY precondition in the plan actually holds in the current repo. ` +
      `If any precondition is false, or the plan contradicts what the code now shows, DO NOT work around it: return status "conflict" with a precise explanation of the mismatch, and STOP without editing anything.\n\n` +
      `STEP 2 — implement. Otherwise carry out the plan's Tasks. Describe-to-code yourself against the real repo; the plan states intent, not literal source.\n\n` +
      `STEP 3 — make it green. Satisfy the stage's Acceptance criteria: the exact build, test, and lint commands named in the plan must pass. If you cannot get them green, return status "failed" with the failing output.\n\n` +
      `STEP 4 — commit and report. On success, commit as the plan's Handoff instructs, but SCOPE WHAT YOU STAGE. ` +
      `Read the plan's "## Files this stage owns" section (STEP 1 surfaced only "Context to load" + preconditions, not this list — go read it now) and stage ONLY the files listed there. ` +
      `Stage by explicit path; NEVER \`git add -A\` / \`git add .\`, which can sweep in unrelated or secret files and still pass the clean-tree gate. ` +
      `Do NOT stage obvious-secret paths (\`.env*\`, \`*credentials*\`, \`*.key\`, \`*.pem\`) unless the ownership list explicitly names them. ` +
      `If carrying out the plan genuinely forced you to change a file NOT in the ownership list, you must still COMMIT it — do NOT leave it uncommitted, because an unstaged change leaves the tree dirty and trips the next stage's clean-tree gate — but NAME that out-of-ownership file in your \`detail\` so review and verification can see the scope drift. The rule is "scope the commit and disclose the overflow," never "drop the overflow."\n\n` +
      `Then return status "done" with the commit subject and your approximate token usage.`,
    { label: `stage-${n}`, phase: 'Implement', schema: STAGE_RESULT },
  )

  const entry = { file, result: res }
  results.push(entry)

  if (!res || res.status !== 'done') {
    const status = res ? res.status : 'null'
    const detail = res ? res.detail : 'agent returned no result'
    log(`Halting at ${file}: status="${status}" — ${detail}`)
    return { halted: true, reason: status, atStage: file, atStageIndex: i + 1, results, baseRef }
  }

  log(`Stage ${n} implemented: ${res.commit || '(no commit subject reported)'} — verifying`)

  // Independent green gate, between stage N and N+1 (strictly sequential; never
  // overlapping either). A second agent re-runs this stage's exact acceptance
  // commands on the committed state and reports raw facts; the workflow — not the
  // agent — decides pass/fail. No stage advances on the implementer's word alone.
  const ver = await verifyStage(file, n, res.commit)
  entry.verification = ver

  const verStatus = gateOutcome(ver, n)
  if (verStatus === 'fail') {
    log(`Halting at ${file}: independent verification failed — ${verificationSummary(ver)}`)
    return { halted: true, reason: 'verification-failed', atStage: file, atStageIndex: i + 1, results, baseRef }
  }

  // Ownership axis (04), combined with — never folded into — the green gate above.
  // A secret-shaped non-owned file halts; ordinary scope drift advances but is
  // logged and surfaced in results[i].verification (ver.ownershipExtras).
  if (ownershipOutcome(ver, n, file, 'stage commit') === 'halt') {
    return { halted: true, reason: 'ownership-secret', atStage: file, atStageIndex: i + 1, results, baseRef }
  }

  if (verStatus === 'pass') log(`Stage ${n} verified green on the committed state.`)

  // --- Adversarial review (01): is it GOOD, not just green ------------------
  // Runs fully synchronously AFTER verification and BEFORE the next stage, so no
  // review-driven fix ever changes a repo state the next stage is already building
  // on. Order is fixed: verify (is it green) → review (is it good). The reviewer
  // RAISES findings; it never confirms its own — a separate step substantiates
  // each one for both reality and severity before it gates.
  const review = await reviewStage(n, res.commit)
  const rawFindings = review && Array.isArray(review.findings) ? review.findings : []
  // Stable per-finding ref so confirmer / fix verdicts match back to findings.
  rawFindings.forEach((f, idx) => {
    f.ref = 'F' + (idx + 1)
  })

  // The audit record: one entry per finding, enriched as it is confirmed/resolved.
  // resolution ∈ fixed | waived-with-reason | halted | dropped | unresolved.
  // The WORKFLOW only ever emits `fixed` (a confirmed minor) or `halted` (a
  // confirmed major) or `dropped` (an unconfirmed claim); `waived-with-reason`
  // and a *delegated* `fixed` are stamped by the orchestrating layer on resume —
  // so the trail records who decided (resolvedBy).
  const audit = rawFindings.map((f) => ({
    ref: f.ref,
    severity: f.severity,
    reviewerSeverity: f.severity,
    category: f.category || '',
    file: f.file,
    line: f.line || '',
    claim: f.claim,
    suggestedFix: f.suggestedFix || '',
    confirmed: false,
    confirmedBy: '',
    resolution: 'unresolved',
    resolutionReason: '',
    resolvedBy: '',
    commit: '',
  }))
  entry.review = { summary: review ? review.summary || '' : '', findings: audit }
  const byRef = {}
  audit.forEach((a) => {
    byRef[a.ref] = a
  })

  if (!rawFindings.length) {
    // A clean stage pays for no second green gate — only a real fix re-verifies.
    log(`Stage ${n} reviewed: clean — no findings. Advancing.`)
    continue
  }

  log(`Stage ${n} reviewed: ${rawFindings.length} finding(s) — confirming before any gates.`)

  // 1) Confirm reviewer-`major` findings with the dedicated third-perspective
  //    confirmer. Only a confirmed major gates (halts); a refuted one is dropped;
  //    a downgraded one joins the minor pool to be fixed like any other minor.
  const reviewerMajors = rawFindings.filter((f) => f.severity === 'major')
  const minorPool = rawFindings.filter((f) => f.severity === 'minor')
  const confirmedMajors = []

  if (reviewerMajors.length) {
    const conf = await confirmMajors(n, res.commit, reviewerMajors)
    const verdicts = conf && Array.isArray(conf.verdicts) ? conf.verdicts : []
    const vByRef = {}
    verdicts.forEach((v) => {
      if (v && v.ref) vByRef[v.ref] = v
    })
    for (const f of reviewerMajors) {
      const v = vByRef[f.ref]
      const a = byRef[f.ref]
      a.confirmedBy = 'confirmer-agent'
      if (v && v.verdict === 'confirmed-major') {
        a.confirmed = true
        a.severity = 'major'
        a.resolutionReason = v.reason || ''
        confirmedMajors.push(a)
      } else if (v && v.verdict === 'downgraded-minor') {
        // Real but not ship-blocking: re-class as minor and fix it like the rest.
        a.confirmed = true
        a.severity = 'minor'
        a.resolutionReason = v.reason || ''
        f.severity = 'minor'
        minorPool.push(f)
      } else {
        // Refuted, or no verdict returned — a major must be substantiated to gate.
        a.confirmed = false
        a.resolution = 'dropped'
        a.resolvedBy = 'workflow'
        a.resolutionReason = (v && v.reason) || 'no verdict returned; a major must be substantiated to gate'
      }
    }
  }

  // 2) A confirmed major halts — same halted/atStage/structured-findings
  //    semantics as a conflict/failed/verification-failed halt. Serious issues are
  //    never silently auto-fixed or auto-waived in the one unattended phase. The
  //    other (minor) findings stay surfaced for the human to resolve on resume; we
  //    do NOT auto-fix into a tree that is about to be hand-edited.
  if (confirmedMajors.length) {
    confirmedMajors.forEach((a) => {
      a.resolution = 'halted'
      a.resolvedBy = 'workflow'
    })
    const titles = confirmedMajors.map((a) => `${a.file}${a.line ? ':' + a.line : ''} — ${a.claim}`).join('; ')
    log(`Halting at ${file}: ${confirmedMajors.length} confirmed major review finding(s) — ${titles}`)
    return { halted: true, reason: 'review-major', atStage: file, atStageIndex: i + 1, results, baseRef }
  }

  // 3) No confirmed major: confirm-and-fix the minor pool (reviewer minors plus
  //    any downgraded majors). The fix agent is the confirmer here — it fixes the
  //    real ones and drops the false positives; the run proceeds either way.
  if (minorPool.length) {
    const fix = await fixMinors(n, res.commit, minorPool)
    const outcomes = fix && Array.isArray(fix.outcomes) ? fix.outcomes : []
    const oByRef = {}
    outcomes.forEach((o) => {
      if (o && o.ref) oByRef[o.ref] = o
    })
    let anyFixed = false
    for (const f of minorPool) {
      const o = oByRef[f.ref]
      const a = byRef[f.ref]
      if (!a.confirmedBy) a.confirmedBy = 'fix-agent'
      if (o && o.action === 'fixed') {
        a.confirmed = true
        a.resolution = 'fixed'
        a.resolvedBy = 'workflow'
        a.resolutionReason = o.reason || ''
        a.commit = (fix && fix.commit) || ''
        anyFixed = true
      } else {
        a.confirmed = false
        a.resolution = 'dropped'
        a.resolvedBy = 'workflow'
        a.resolutionReason = (o && o.reason) || 'fix agent returned no outcome; treated as dropped'
      }
    }
    entry.review.fixCommitMode = (fix && fix.commitMode) || 'none'

    // 4) Re-enter the SHARED green gate — but only when a minor was actually
    //    fixed. The re-verify is the green gate, NOT a second review pass: a minor
    //    fix is run green but not re-reviewed, a deliberate bound that keeps the
    //    per-stage tail from looping review→fix→review.
    if (anyFixed) {
      log(`Stage ${n}: minor finding(s) fixed (${entry.review.fixCommitMode}) — re-verifying through the green gate.`)
      const fixCommit = (fix && fix.commit) || res.commit
      // Pass the fix's commit mode so the ownership check (04) scopes its
      // --name-only to the right commit(s): an AMENDED stage commit is one commit
      // at HEAD (stage + fix folded in); a FOLLOW-UP is two (the stage commit plus
      // the fix), and checking only HEAD would drop the stage's own files and
      // spuriously flag them. The green gate itself is unchanged.
      const rever = await verifyStage(file, n, fixCommit, { fixCommitMode: entry.review.fixCommitMode })
      entry.reverification = rever
      const reStatus = gateOutcome(rever, n)
      if (reStatus === 'fail') {
        log(`Halting at ${file}: re-verification after the minor fix failed — ${verificationSummary(rever)}`)
        return { halted: true, reason: 'verification-failed', atStage: file, atStageIndex: i + 1, results, baseRef }
      }
      if (ownershipOutcome(rever, n, file, 'minor-fix commit') === 'halt') {
        return { halted: true, reason: 'ownership-secret', atStage: file, atStageIndex: i + 1, results, baseRef }
      }
      if (reStatus === 'pass') log(`Stage ${n}: minor fix re-verified green — advancing.`)
    } else {
      log(`Stage ${n}: all minor findings dropped as false positives — no fix, no second green gate. Advancing.`)
    }
  } else {
    log(`Stage ${n}: no findings survived confirmation — advancing.`)
  }
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

return { halted: false, results, report, baseRef }
