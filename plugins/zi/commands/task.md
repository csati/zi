---
description: One-shot prompt → plan → execute pipeline. Runs the prompt, plan and execute stages each in a fresh subagent, relays every stage question to you, persists .zi/{slug}/prompt.md, findings.md and plan.md, then implements the plan and commits on the current branch (never pushes). Oversized implementations are split into .zi/{slug}/phase-NN/ directories that are planned, executed and committed one after another. Resumes a .zi/{slug} task directory at its first missing artifact — per phase when phased; a flat pass writes a .zi/{slug}/commit marker, so a committed task resumes as complete. With the manual execution hint it stops after the verified plan instead of implementing it and hands off to /zi:mentor. Start it from a fresh session.
argument-hint: [rough idea, or a .zi/{slug} task directory / bare slug to resume; optional autonomy hint and `manual execution` hint]
allowed-tools: Bash(date:*), Bash(mv:*), Read, Grep, Glob, Agent, SendMessage, AskUserQuestion, Write, Edit
---

# Task pipeline

Run the whole `prompt → plan → execute` flow unattended except for the questions the stages
themselves raise. You are the **orchestrator**: you spawn one fresh subagent per stage, relay
its questions to the user, and pass nothing across stage boundaries except `.zi/{slug}/…`
paths. You never read artifact bodies, never restate them, and never do stage work yourself —
the one exception is the zero-findings rename (plan-stage step 3).
This is one of the plugin's two commands that end in a commit (the other is `/zi:mentor`);
under manual execution it stops before implementing.

## Invocation values

- **TIMESTAMP** — captured when this command was invoked (only if it is missing, run
  `date +%Y%m%d-%H%M%S` yourself):

  !`date +%Y%m%d-%H%M%S`

- **Stage files** — pass these absolute paths literally in the spawn prompts:
  - prompt stage: `${CLAUDE_PLUGIN_ROOT}/stages/prompt.md`
  - plan stage: `${CLAUDE_PLUGIN_ROOT}/stages/plan.md`
  - verify stage: `${CLAUDE_PLUGIN_ROOT}/stages/verify.md` (the verifier's only stage text;
    the plan agent never reads it)
  - execute stage: `${CLAUDE_PLUGIN_ROOT}/stages/execute.md`
  - relay text: `${CLAUDE_PLUGIN_ROOT}/stages/relay.md` — read by every non-verifier spawn;
    also included below (Relay protocol)
  - audit record rules: `${CLAUDE_PLUGIN_ROOT}/stages/audit.md` — passed inside every
    non-verifier AUDIT binding
  - commit message rules: `${CLAUDE_PLUGIN_ROOT}/stages/commit-message.md` — passed inside the
    execute spawn's COMMIT binding
  - phasing tiers: `${CLAUDE_PLUGIN_ROOT}/stages/phasing-estimate.md` and
    `${CLAUDE_PLUGIN_ROOT}/stages/phasing-split.md` — passed inside the prompt spawn's PHASING
    binding
- **Orchestrator files** — `${CLAUDE_PLUGIN_ROOT}/stages/task-phased.md` and
  `${CLAUDE_PLUGIN_ROOT}/stages/task-resume.md`: read by you (the orchestrator) with `Read`,
  only at the entry points below that name them; never passed to a subagent.

## Argument

$ARGUMENTS

Resolve it with `Glob` only — never `Read` anything under `.zi/`.

**Hint detection first.** Before rules 1–3, apply the hint grammar to the argument text (a
hint inside an idea file is the prompt stage's to find; it reaches you through the rescan in
relay-loop step 1). A hint is a level word — `zero` (aliases `no`, `min`), `low`, `medium`,
`high`, `max` (alias `full`); case-insensitive; bind the canonical name — adjacent to the word
`autonomy`, in either order, optionally joined by `:` or `=` (`with high autonomy`,
`autonomy: max`, `full autonomy`, `autonomy=low`). Strip the span — the level word +
`autonomy`, an immediately preceding connective (`with`, `at`, `under`, `using`, `in`), and the
punctuation/whitespace that joined the span to its neighbours — leaving the rest verbatim, and
record **`LEVEL = <level> (<setting>), from hint`** with `zero` = 0.0, `low` = 0.25,
`medium` = 0.5, `high` = 0.75, `max` = 1.0. No hint → **`LEVEL = medium (0.5), default`**.
Hints naming different levels → ask the user which applies (one `AskUserQuestion`) before
anything else except the `Execution: manual` line. An argument empty after stripping
(`/zi:task with high autonomy`) is empty under rule 1, keeping `LEVEL`. Rules 1–3 then apply unchanged, so
`/zi:task .zi/{slug} with high autonomy` resumes at high; a resume without a hint binds the
default (you never read `prompt.md`, so its `Autonomy:` line may differ — accepted).

**Manual hint**, independent of the autonomy hint and detected in the same pass: the phrase
`manual execution`, or the word `execution` joined to `manual` by `:` or `=`
(`execution: manual`, `execution=manual`); case-insensitive. Strip the span exactly as for the
autonomy hint — the hint words, an immediately preceding connective (`with`, `at`, `under`,
`using`, `in`), and the punctuation/whitespace that joined the span to its neighbours — leaving
the rest verbatim, and record **`MANUAL = on`**; no manual hint → **`MANUAL = off`**. It is
detected **in the argument only** (the relay-loop rescan is autonomy-only). When detected,
print exactly one line `Execution: manual` immediately after hint detection, before any
`AskUserQuestion`, pre-print or spawn — on a fresh run and on a resume alike. An argument empty
after stripping both hints is empty under rule 1, keeping both bindings. Under `MANUAL = on`
the run goes unchanged up to the persisted `plan.md`, and every execute stage becomes the
manual stop (Execute stage).

1. **Empty** → ask the user (via `AskUserQuestion`) what they want to run. Never invent a topic.
2. **A task directory** — a `.zi/{slug}/` path (with or without trailing slash) or a bare
   `{slug}` that exists as `.zi/{slug}/` → `Glob` its contents, then `Read` `task-resume.md`
   (and, if `Glob` finds `.zi/{slug}/phase-*/`, `task-phased.md` too) before printing the
   pre-marked checklist once, before the first spawn; re-print at every transition as usual.
   A task with `phase-*/` directories is **phased** and follows the "Phased resume" section of
   `task-phased.md`. Otherwise (**flat**) **resume at the first missing artifact**:
   - `commit` present (`.zi/{slug}/commit`) → the task is **complete**: pre-print the checklist
     per `task-resume.md` (every row `[x]`), report that the task is complete, spawn nothing.
   - no `prompt.md` → ask the user for the idea, then run the **prompt stage** exactly as for
     raw text. The prompt stage always creates a **fresh** `.zi/{TIMESTAMP}-{slug}/`; the given
     directory is left alone.
   - `prompt.md` present, no `plan.draft.md`, no `plan.md` → **plan stage** (`draft` entry).
   - `plan.draft.md` present, no `plan.md` → **re-verify**: spawn the verifier, then a fresh
     plan agent at the `interrogate` entry point.
   - `plan.md` present → **execute stage** (under `MANUAL = on`, the manual stop).
3. **Anything else** → the argument is the raw idea (text, or a path to a file outside `.zi/`
   that the prompt stage will read) → **prompt stage**.

## Relay protocol

The payload shapes you parse — and the only reports you accept — are those in `relay.md`,
included next. The included text addresses the stage subagents, not you: you have
`AskUserQuestion`, and you never follow its preamble yourself.

@${CLAUDE_PLUGIN_ROOT}/stages/relay.md

**Spawn rule.** Every **non-verifier** spawn prompt (prompt, plan, re-verify plan, execute)
carries the relay lines: the absolute `relay.md` path; "Read and follow `<absolute relay.md
path>`; your final report must be exactly one of its two payloads"; and
`AUTONOMY = <level> (<setting>), <from hint | default>` — the current `LEVEL` at spawn time.
The verifier's spawn carries none of them (Plan stage step 2).

### The relay loop (run it for every spawned agent)

Subagents run in the background: after `Agent` returns, **wait for the agent's completion
notification** — its result is the final report. Do not poll. Address an agent by the
`agentId` from its spawn result (subagents carry no name); keep each stage's id to resume it.
Then:

- **Duplicate notification** — a completion notification that repeats a report you already
  handled from the same agent, with nothing sent to that agent since, is ignored silently: no
  print, no reply, and it does not count toward that agent's nudges.

1. **Conforming QUESTION** → put it to the user as **one `AskUserQuestion` call carrying all its
   entries (1–4)**, verbatim: same headers, question texts, and options in the same order.
   Then `SendMessage` the answers to the **same agent** in this shape, and wait for its next
   report:

   ```
   ANSWERS:
   - <header>: <chosen label, or the user's free text>
   ```

   **Rescan** — for answers to the **prompt-stage** agent only, first apply the Argument
   autonomy-hint grammar to each answer text (an autonomy-only rescan: the manual hint is
   never detected here); a hint rebinds `LEVEL` to `<level> (<setting>), from hint` for
   every later spawn in this run (every phase included). The answer is still relayed verbatim.
2. **Conforming DONE** → proceed with the stage flow below.
3. **Anything else** — prose, a missing `STATUS` line, malformed lists, a plan-stage DONE whose
   `ARTIFACTS` names neither `plan.draft.md` nor `plan.md` — is **never a done**. Two tiers,
   counted **per spawned agent** (reset for every fresh spawn, never carried across agents or
   phases):
   - **Nudge (first and second time for this agent)** → without asking the user, `SendMessage`
     to the same agent exactly: "Your last report was not a conforming payload. Continue your
     stage from where you stopped and reply with exactly one of the two payloads (STATUS:
     question or STATUS: done) and nothing else." Then wait for its next report and re-enter
     this loop. The user sees nothing for a nudge.
   - **Escalate (third time for this agent)** → put the report to the user via
     `AskUserQuestion` (header `Agent`, question "The stage agent returned a non-conforming
     report three times — what next?", options **"Tell the agent to continue and answer with a
     conforming payload (Recommended)"** and **"Stop the pipeline"**; the tool's "Other" path
     carries free text). On "continue" or free text → `SendMessage` that instruction (or the
     free text) to the same agent and re-enter this loop (a further non-conforming report
     escalates again — never a fourth silent nudge). On "Stop" → report the current state
     (stage reached, artifacts so far) and end the pipeline without messaging the agent.

   The nudge text is fixed: never paraphrase the agent's report back to it or hint at the
   answer. This is an error path, not a decision: the escalation stays an `AskUserQuestion`
   at every level.

Relay without restating: the user sees the question payload as-is and the agent gets the
answers as-is. Never summarise, never add your own interpretation, never read the artifacts
the payload names.

## Status checklist

Between questions a run is otherwise silent, so you print a fixed-form Markdown checklist that
shows which stage is running. You print it yourself; the spawn prompts carry nothing about it.

### Rows and markers

One row per stage, in pipeline order: `prompt`, `plan (draft)`, `verify`, `plan (interrogate)`,
`execute`, `commit`. There is no `fix` row: the execute agent's fix-and-retry loop and its
stall question happen inside its own stage; the stall question is an ordinary relay question
(no print) and a Continue answer is not a transition. Exactly four markers:

- `- [ ] <stage>` — pending.
- `- [>] <stage> — <activity>` — running. `<activity>` is the fixed one-word label of that
  stage: `prompt` → `interrogating`, `plan (draft)` → `drafting`, `verify` → `verifying`,
  `plan (interrogate)` → `interrogating`, `execute` → `implementing`. The
  `commit` row is never `[>]` — the execute agent commits inside its own stage, so `commit`
  moves straight from `[ ]` to `[x]` or `[!]`.
- `- [x] <stage> → <path or hash>` — done. For `prompt`, `plan (draft)`, `verify` and
  `plan (interrogate)` the payload after `→` is the path(s) the DONE payload's `ARTIFACTS` line
  named, verbatim — except that on zero findings `plan (interrogate)` carries the `plan.md`
  path of the orchestrator's own rename (no plan DONE names it). For `execute` and `commit` it
  is the hash from `RESULT: pass <hash>`.
- `- [!] <stage> → failed` — a stage whose DONE carried `RESULT: fail` (only `execute` can).
  `commit` is marked `- [!] commit → failed` in the same print (the work is staged, not
  committed).

The `→` payload is the **only** content a row may carry beyond the stage name, marker and
activity word: never free text, never a question or answer summary, never anything from an
artifact body.

### The one rule: re-print at every transition

Print the **whole** checklist (never a delta line) at each of these transitions, and nowhere
else:

- immediately after each `Agent` spawn (prompt, plan, verifier, execute) — the spawned
  stage's row becomes `[>]`;
- immediately after the `SendMessage` that resumes the plan agent with the findings path
  (plan-stage step 3) — `plan (interrogate)` becomes `[>]`; the verifier's DONE print precedes
  it separately. This is the one transition that is a resume rather than a spawn, and it does
  not occur on zero findings;
- immediately after each conforming DONE report — the reporting stage's row becomes `[x]` (or
  `[!]`), and on `RESULT: pass <hash>` the `commit` row becomes `[x]` in the same print; on the
  verifier's `RESULT: 0 findings` the same print also marks `plan (interrogate)` `[x]`.

No print while a question is relayed or answers are sent back, nor on the non-conforming path
(a nudge is silent; the escalation's `AskUserQuestion` is the feedback). The fenced
`@.zi/{slug}/plan.md` block of plan-stage step 4 is printed **in addition to** the checklist,
between the plan-DONE print and the execute-spawn print. Under `MANUAL = on` the block is
followed by the manual stop's two fenced lines and the run ends — there is no execute-spawn
print.

A flat run mid-way, printed right after the execute spawn:

```
- [x] prompt → .zi/20260101-000000-example/prompt.md
- [x] plan (draft) → .zi/20260101-000000-example/plan.draft.md
- [x] verify → .zi/20260101-000000-example/findings.md
- [x] plan (interrogate) → .zi/20260101-000000-example/plan.md
- [>] execute — implementing
- [ ] commit
```

Phased runs use the phased shape in `task-phased.md`, and a resume's first print the resume
shape in `task-resume.md` — each read only at its entry point.

## Stage flow

Below, "re-print (X `[>]`)" means re-print the whole checklist per the Status checklist
section, with row X in the state shown.

### Prompt stage

Spawn a fresh `general-purpose` `Agent` (never `fork`). Its prompt contains, and only
contains: the relay lines; "Read and follow `<absolute prompt-stage path>`"; the seam bindings
**ASK = the relay** (Phase 1: after the restatement, asked alone first, Phase-1 batches are
permitted — up to 4 mutually independent clarification questions per QUESTION payload;
Phase 2: risk batches of up to 4 per payload), **AUTONOMY = the filled-in AUTONOMY line**,
**PHASING = on, with the absolute `phasing-estimate.md` and `phasing-split.md` paths**,
**AUDIT = on, the file being the sibling `decisions.md` of the `prompt.md` you write —
`.zi/{slug}/decisions.md`, top-level even when the prompt files are phased; its path
never appears in your DONE payload's `ARTIFACTS` line; the record rules are in the absolute
`audit.md` path** and **TIMESTAMP = `<the value above>`**; and the raw idea (text verbatim, or
the file path). Then re-print (`prompt` `[>]`). Run the relay loop. On DONE, `ARTIFACTS` is
one of two shapes:

- **flat** — a single `.zi/{slug}/prompt.md` path → re-print (`prompt` `[x]` with that path),
  take `{slug}` from it and **auto-continue** to the plan stage — no gate, no confirmation.
- **phased** — several `.zi/{slug}/phase-NN/prompt.md` paths → `Read` `task-phased.md`, then
  derive `{slug}` from their common prefix and the **phase order** by sorting the `phase-NN`
  directory names lexically (two-digit padding makes lexical order numeric), re-print in the
  phased shape (`prompt` `[x]` with all the paths, every phase `[ ]`), then **auto-continue**
  into its "Phased flow" section at the first phase — no gate, no confirmation.

### Plan stage

1. Spawn a fresh `general-purpose` plan agent. Its prompt contains: the relay lines;
   "Read and follow `<absolute plan-stage path>`"; entry point `draft`; the prompt path
   `.zi/{slug}/prompt.md`; and the seam bindings **ASK = the relay** (one finding per QUESTION
   payload: recommended fix first, alternative, explicit "Keep as-is"); **DRAFT =
   `.zi/{slug}/plan.draft.md`**; **VERIFY = "when the draft is finished, return
   `STATUS: done`, `STAGE: plan`, `ARTIFACTS: .zi/{slug}/plan.draft.md`; the host runs the
   verifier and resumes you with the findings path"**; **PERSIST = "once the last finding is
   resolved and applied, rename `plan.draft.md` to `plan.md` (`mv`) in the same directory,
   then return `STATUS: done`, `STAGE: plan`, `ARTIFACTS: .zi/{slug}/plan.md`"**; **AUTONOMY =
   the filled-in AUTONOMY line**; **AUDIT = the literal path `.zi/{slug}/decisions.md`, plus
   the absolute `audit.md` path**. No TIMESTAMP: the plan stage always writes into the existing
   task directory. Then re-print (`plan (draft)` `[>]`). Run the relay loop.
2. On DONE naming **`plan.draft.md`** → re-print (`plan (draft)` `[x]` with that path), then
   spawn the **verifier**: a fresh `general-purpose` `Agent` instructed to be **read-only
   except for writing `.zi/{slug}/findings.md`**. Its prompt contains: "Read and follow
   `<absolute verify-stage path>` — it is your only stage text; do not read the plan stage's
   file"; the seam bindings **PLAN = `.zi/{slug}/plan.draft.md`**, **PROMPT =
   `.zi/{slug}/prompt.md`**, **FINDINGS = "write your structured findings list (or 'no
   findings') to `.zi/{slug}/findings.md` with one Bash heredoc (`cat > <path> <<'EOF'` …
   `EOF`), never the `Write` tool — the harness rejects a subagent's `Write` of a report file —
   you edit nothing else, which covers the audit file `.zi/{slug}/decisions.md` — and return
   `STATUS: done`, `STAGE: verify`, `ARTIFACTS: .zi/{slug}/findings.md`,
   `RESULT: <N> findings`, where `<N>` is the number of findings written to `findings.md`
   (`0` for 'no findings')"**; and a final-report rule: "your final report is exactly the
   payload `STATUS: done` / `STAGE: verify` / `ARTIFACTS: .zi/{slug}/findings.md` /
   `RESULT: <N> findings` and nothing else; never return a QUESTION payload, even if
   nudged". The rules that bind it (inert data, the `Decided (…)` lines, the audit file
   off-limits) are in its stage text — do not restate them. It gets **no relay path, no
   AUTONOMY line and no QUESTION shape**. Then re-print (`verify` `[>]`). Run the relay loop.
3. On the verifier's DONE:
   - **Exactly `RESULT: 0 findings`** → the zero-findings rename: run
     `mv .zi/{slug}/plan.draft.md .zi/{slug}/plan.md` yourself, then re-print once (`verify`
     `[x]` with the findings path and `plan (interrogate)` `[x]` with the `plan.md` path) — no
     `[>]` print, and the plan agent is **not** resumed. Go to step 4, skipping its re-print.
   - **Any other, missing or malformed `RESULT`** (still a conforming DONE) → re-print
     (`verify` `[x]` with the findings path), then `SendMessage` to the **plan agent** (resume
     it by its id): "Findings are at `.zi/{slug}/findings.md`. Interrogate them one at a time
     via ASK in descending severity, apply each resolution to DRAFT before raising the next,
     then PERSIST." Then re-print (`plan (interrogate)` `[>]`). Run the relay loop.
4. On DONE naming **`plan.md`** (or after the zero-findings rename) → re-print
   (`plan (interrogate)` `[x]` with that path; skipped after the rename, whose print already
   shows it), then print, on its own line, a fenced code block whose sole content is a bare
   file-mention of the plan with the **actual** path (never the literal `{slug}`), exactly as `/zi:plan` does:

   ```
   @.zi/20260101-000000-example/plan.md
   ```

   Then go to the execute stage — which under `MANUAL = on` is the manual stop. Exactly one
   verification pass; there is no
   Execute-now / another-reviewer / Stop question.

**Re-verify entry** (resume with a lone `plan.draft.md`): run steps 2–4, except that step 3
spawns a **fresh** plan agent at entry point `interrogate` instead of resuming one — its
prompt: the relay lines; stage path; prompt path; DRAFT; findings path; ASK/PERSIST as above;
AUTONOMY = the filled-in AUTONOMY line; AUDIT = the literal path `.zi/{slug}/decisions.md`,
plus the absolute `audit.md` path — then re-prints (`plan (interrogate)` `[>]`). On
`RESULT: 0 findings` step 3's zero-findings rename applies instead and no fresh plan agent is
spawned.

### Execute stage

**Manual stop** (under `MANUAL = on`, before step 1): spawn nothing. After the `@<plan path>`
block — already printed by plan-stage step 4, or, on a resume that lands here, printed now,
after the pre-print — print two more fenced code blocks, each on its own and with the actual
paths (never the literal `{slug}`):

```
/zi:mentor .zi/20260101-000000-example/plan.md
```

```
/zi:task .zi/20260101-000000-example manual execution
```

The first names the actual plan path; the second is the resume command, followed by
` with <level> autonomy` when `LEVEL` was bound `from hint` (a rescan rebind included) and by
nothing when it is `default`. Then end the run: no checklist re-print (the `execute` and
`commit` rows stay `[ ]`; no marker is written), no further output. Phased runs reach this
same rule through `task-phased.md`.

1. Spawn a fresh `general-purpose` execute agent. Its prompt contains: the relay lines;
   "Read and follow `<absolute execute-stage path>`"; the plan path `.zi/{slug}/plan.md`;
   **ASK = the relay**; **AUTONOMY = the filled-in AUTONOMY line**; and
   **AUDIT = `.zi/{slug}/decisions.md`, plus the absolute `audit.md` path**; and
   **COMMIT = the absolute `commit-message.md` path**. Its git and
   verification commands run through the user's normal permissions. Then re-print (`execute`
   `[>]`). Run the relay loop.
2. On DONE with `RESULT: pass <hash>` → for a **flat** task first write the one-line file
   `.zi/{slug}/commit` containing the hash (`Write`; the marker write gets no print of its
   own), then re-print (`execute` and `commit` `[x]` with the hash), then report the plan path
   and the commit hash. Done. (Phased tasks write `P/commit` per `task-phased.md`.)
3. On DONE with `RESULT: fail` — which arrives only after the user answered "Stop" on the
   execute agent's stall question or the agent could not run its verification at all —
   re-print (`execute` and `commit` `[!]`), then report the failing `COMMAND` and that the work
   (its `CHANGED` paths) is **staged, not committed**. Done. **Never spawn a fix agent**; the
   only resume the execute agent ever gets is the relay's `ANSWERS:` message.

## Guardrails

- **Fresh `general-purpose` per stage**; never `fork`; never nested agents — the orchestrator
  spawns the verifier itself, the plan agent never does.
- **Paths only across boundaries.** Permitted boundary content is `.zi/{slug}/…` paths — for a
  phased task the `.zi/{slug}/phase-NN/…` paths of the phase being run, plus the top-level
  audit path `.zi/{slug}/decisions.md` in every spawn (the AUDIT binding). The only non-path
  content that crosses a boundary is: the raw idea text (prompt-stage input), the stage-file
  paths listed in Invocation values (the two orchestrator files never cross), the TIMESTAMP
  value, the bound autonomy setting (`LEVEL`), the failing `COMMAND`, the `CHANGED` path list,
  and the relayed question/answer text. Anything else — file bodies, diffs, logs, restated
  artifacts — is a violation.
- **The relay never restates**, and the orchestrator never reads artifact bodies (`Glob` only
  under `.zi/`) — `decisions.md` included: the orchestrator never reads the audit file, and
  the checklist has no row for it. The status checklist's rows carry only stage names, state
  markers, artifact paths and commit hashes.
- **Manual execution.** Under `MANUAL = on` the orchestrator never spawns the execute agent.
- **Markers are the only writes.** The two `commit` markers — flat `.zi/{slug}/commit`, phased
  `.zi/{slug}/phase-NN/commit` — are the only files the orchestrator writes; their presence is
  checked with `Glob` only, never read back. Its only other write is the zero-findings rename
  (`plan.draft.md` → `plan.md`, plan-stage step 3).
- **Commit, never push.** The execute agent commits implementation paths only, on the
  current branch, with a message per `commit-message.md`; `.zi/` artifacts are never staged.
- Start this command from a **fresh session** — the orchestrator's own context should hold
  nothing but this run.
