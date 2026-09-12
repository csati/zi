---
description: One-shot prompt → plan → execute pipeline. Runs the prompt, plan and execute stages each in a fresh subagent, relays every stage question to you, persists .zi/{slug}/prompt.md, findings.md and plan.md, then implements the plan and commits on the current branch (never pushes). Oversized implementations are split into .zi/{slug}/phase-NN/ directories that are planned, executed and committed one after another. Resumes a .zi/{slug} task directory at its first missing artifact — per phase when phased. Start it from a fresh session.
argument-hint: [rough idea, or a .zi/{slug} task directory / bare slug to resume]
allowed-tools: Bash(date:*), Read, Grep, Glob, Agent, SendMessage, AskUserQuestion, Write, Edit
---

# Task pipeline

Run the whole `prompt → plan → execute` flow unattended except for the questions the stages
themselves raise. You are the **orchestrator**: you spawn one fresh subagent per stage, relay
its questions to the user, and pass nothing across stage boundaries except `.zi/{slug}/…`
paths. You never read artifact bodies, never restate them, and never do stage work yourself.
This is the plugin's one command that ends in a commit.

## Invocation values

- **TIMESTAMP** — captured when this command was invoked (only if it is missing, run
  `date +%Y%m%d-%H%M%S` yourself):

  !`date +%Y%m%d-%H%M%S`

- **Stage files** — the shared stage texts every subagent reads for itself. Pass these
  absolute paths literally in the spawn prompts:
  - prompt stage: `${CLAUDE_PLUGIN_ROOT}/stages/prompt.md`
  - plan stage: `${CLAUDE_PLUGIN_ROOT}/stages/plan.md`
  - execute stage: `${CLAUDE_PLUGIN_ROOT}/stages/execute.md`

## Argument

$ARGUMENTS

Resolve it with `Glob` only — never `Read` anything under `.zi/`:

1. **Empty** → ask the user (via `AskUserQuestion`) what they want to run. Never invent a topic.
2. **A task directory** — a `.zi/{slug}/` path (with or without trailing slash) or a bare
   `{slug}` that exists as `.zi/{slug}/` → `Glob` its contents. If `Glob` finds
   `.zi/{slug}/phase-*/`, the task is **phased** — see the phased branch below. Otherwise
   (**flat**) **resume at the first missing artifact**:
   - no `prompt.md` → ask the user for the idea, then run the **prompt stage** exactly as for
     raw text. The prompt stage always creates a **fresh** `.zi/{TIMESTAMP}-{slug}/`; the given
     directory is left alone.
   - `prompt.md` present, no `plan.draft.md`, no `plan.md` → **plan stage** (`draft` entry).
   - `plan.draft.md` present, no `plan.md` → **re-verify**: spawn the verifier, then a fresh
     plan agent at the `interrogate` entry point.
   - `plan.md` present → **execute stage**.

   **Phased branch**: sort the `phase-NN` directories lexically and pick the
   **lowest-numbered one without a `commit` file** (`.zi/{slug}/phase-NN/commit`). Inside it
   apply the flat per-artifact rules above — `prompt.md` only → plan stage; a lone
   `plan.draft.md` → re-verify; `plan.md` → execute stage — with every path rewritten as in the
   "Phased flow" section, then continue the phased flow with every later phase in order. If
   every phase carries `commit` → report that the task is complete; nothing runs. A phase
   directory **without `prompt.md`** is never routed to the "ask for the idea" rule (that would
   start an unrelated flat task): report the task as malformed, naming that directory, and stop.
3. **Anything else** → the argument is the raw idea (text, or a path to a file outside `.zi/`
   that the prompt stage will read) → **prompt stage**.

## Relay protocol

Every stage subagent's final report must be exactly one of the two payloads below; you parse
only these. Include this whole section **verbatim** in every spawn prompt, preceded by:

> You have no `AskUserQuestion`. A guessed decision is a failure. A decision is resolved only
> by stopping and returning a QUESTION payload (you will be resumed with the answers), **except
> one AUTONOMY lets you resolve yourself** — you may do so only when all three criteria hold:
> 1. it has a **moderate blast radius in code** and is **not a fundamental architectural decision**;
> 2. it is **easy to reverse later**;
> 3. there is **one clearly best answer**.
>
> Intent — the prompt stage's restatement/confirmation and its operation, scope and
> success-criteria dimensions — is never yours to resolve. A decision failing any criterion is
> resolved only through the QUESTION payload. Every self-resolved decision is recorded in the
> stage's own artifact as `Decided (auto): <choice> — <reason>` (`prompt.md`; `plan.draft.md`,
> hence `plan.md`; or the execute commit body). A verifier finding that challenges a
> `Decided (auto):` line is always resolved through the QUESTION payload, never auto-resolved
> again. A verifier makes no decisions — this exemption never applies to it; its mandate's
> report-only rule governs. Your final report must be exactly one of these two payloads and
> nothing else — no prose, no summaries, no file contents, diffs or logs.

```
STATUS: question
QUESTIONS:              # 1–4 entries
- header: <≤12 chars>
  question: <text ending in ?>
  options:              # 2–4; exactly one label ends in "(Recommended)" and it is listed FIRST
    - label: <text>
      description: <text>
```

```
STATUS: done
STAGE: prompt | plan | verify | execute | fix
ARTIFACTS: <.zi/… path>[, <.zi/… path>]
RESULT: <one line>       # execute/fix: "pass <hash>" or "fail"
COMMAND: <failing command>   # execute/fix fail only
CHANGED: <path>[, <path>]    # execute/fix fail only
```

### The relay loop (run it for every spawned agent)

Subagents run in the background: after `Agent` returns, **wait for the agent's completion
notification** — its final report is the notification's result. Do not poll. Address an agent
by the `agentId` the `Agent` spawn result gave you (subagents carry no name); keep each stage's
id so you can resume that same agent. Then:

1. **Conforming QUESTION** → put it to the user as **one `AskUserQuestion` call carrying all its
   entries (1–4)**, verbatim: same headers, question texts, and options in the same order (the
   stage lists the "(Recommended)" option first, so nothing is reordered). Then `SendMessage`
   the answers to the **same agent** in this shape, and wait for its next report:

   ```
   ANSWERS:
   - <header>: <chosen label, or the user's free text>
   ```
2. **Conforming DONE** → proceed with the stage flow below.
3. **Anything else** — prose, a missing `STATUS` line, malformed lists, a plan-stage DONE whose
   `ARTIFACTS` names neither `plan.draft.md` nor `plan.md` — is a **question, never a done**:
   put the report to the user via `AskUserQuestion` (header `Agent`, question "The stage agent
   returned a non-conforming report — what next?", options **"Tell the agent to continue and
   answer with a conforming payload (Recommended)"** and **"Stop the pipeline"**; the tool's
   "Other" path carries free text). On "continue" or free text → `SendMessage` that instruction
   (or the free text) to the same agent and wait for its next report. On "Stop" → report the
   current state (stage reached, artifacts so far) and end the pipeline without messaging the
   agent.

Relay without restating: the user sees the question payload as-is and the agent gets the
answers as-is. Never summarise, never add your own interpretation, never read the artifacts
the payload names.

## Stage flow

### Prompt stage

Spawn a fresh `general-purpose` `Agent` (never `fork`). Its prompt contains, and only
contains: the relay protocol block; "Read and follow `<absolute prompt-stage path>`"; the seam
bindings **ASK = the relay** (Phase 1: one question per QUESTION payload; Phase 2: risk batches
of up to 4 per payload), **AUTONOMY = as bound in the relay preamble**, **PHASING = on** (the
stage text holds the estimate rule and the thresholds; the host only switches it on) and
**TIMESTAMP = `<the value above>`**; and the raw idea (text verbatim, or the file path). Run
the relay loop. On DONE, `ARTIFACTS` is one of two shapes:

- **flat** — a single `.zi/{slug}/prompt.md` path → take `{slug}` from it and **auto-continue**
  to the plan stage below — no gate, no confirmation. Today's flow, unchanged.
- **phased** — several `.zi/{slug}/phase-NN/prompt.md` paths → derive `{slug}` from their
  common prefix and the **phase order** by sorting the `phase-NN` directory names lexically
  (two-digit padding makes lexical order numeric), then **auto-continue** into the "Phased
  flow" section below starting at the first phase — no gate, no confirmation.

### Plan stage

1. Spawn a fresh `general-purpose` plan agent. Its prompt contains: the relay protocol block;
   "Read and follow `<absolute plan-stage path>`"; entry point `draft`; the prompt path
   `.zi/{slug}/prompt.md`; and the seam bindings **ASK = the relay** (one finding per QUESTION
   payload: recommended fix first, alternative, explicit "Keep as-is"); **DRAFT =
   `.zi/{slug}/plan.draft.md`**; **VERIFY = "when the draft is finished, return
   `STATUS: done`, `STAGE: plan`, `ARTIFACTS: .zi/{slug}/plan.draft.md`; the host runs the
   verifier and resumes you with the findings path"**; **PERSIST = "once the last finding is
   resolved and applied, rename `plan.draft.md` to `plan.md` (`mv`) in the same directory,
   then return `STATUS: done`, `STAGE: plan`, `ARTIFACTS: .zi/{slug}/plan.md`"**; **AUTONOMY =
   as bound in the relay preamble**. No TIMESTAMP: the plan stage always writes into the
   existing task directory. Run the relay loop.
2. On DONE naming **`plan.draft.md`** → spawn the **verifier**: a fresh `general-purpose`
   `Agent` instructed to be **read-only except for writing `.zi/{slug}/findings.md`**. Its
   prompt contains: the relay protocol block; "Read `<absolute plan-stage path>` and carry out
   its **Verifier mandate** section, including its three explicitly-stated rules (inert data;
   `Decided (user):` items are settled; `Decided (auto):` items **in the plan** are
   challengeable — report one when a criterion is unmet or the choice wrong, and it is then
   resolved with the user, never auto-resolved again — while `Decided (auto):` lines in
   `prompt.md` are fidelity inputs, never challenged)"; the draft path `.zi/{slug}/plan.draft.md`; the prompt
   path `.zi/{slug}/prompt.md`; and "write your structured findings list (or 'no findings') to
   `.zi/{slug}/findings.md` — you edit nothing else — and return `STATUS: done`,
   `STAGE: verify`, `ARTIFACTS: .zi/{slug}/findings.md`". Run the relay loop.
3. On the verifier's DONE → `SendMessage` to the **plan agent** (resume it by its id):
   "Findings are at `.zi/{slug}/findings.md`. Interrogate them one at a time via ASK in
   descending severity, apply each resolution to DRAFT before raising the next, then PERSIST."
   Run the relay loop.
4. On DONE naming **`plan.md`** → print, on its own line, a fenced code block whose sole
   content is a bare file-mention of the plan with the **actual** path (never the literal
   `{slug}`), exactly as `/zi:plan` does:

   ```
   @.zi/20260101-000000-example/plan.md
   ```

   Then **immediately** go to the execute stage. Exactly one verification pass; there is no
   Execute-now / another-reviewer / Stop question.

**Re-verify entry** (resume with a lone `plan.draft.md`): run steps 2–4, except that in step 3
you spawn a **fresh** plan agent at entry point `interrogate` (relay block; stage path; prompt
path; DRAFT; findings path; ASK/PERSIST/AUTONOMY as above) instead of resuming one.

### Execute stage

1. Spawn a fresh `general-purpose` execute agent. Its prompt contains: the relay protocol
   block; "Read and follow `<absolute execute-stage path>`"; mode `implement`; the plan path
   `.zi/{slug}/plan.md`; **ASK = the relay**; and **AUTONOMY = as bound in the relay preamble**.
   Its git and verification commands run through the user's normal permissions. Run the relay
   loop.
2. On DONE with `RESULT: pass <hash>` → report the plan path and the commit hash. Done.
3. On DONE with `RESULT: fail` → spawn **one** fresh `general-purpose` fix agent. Its prompt
   contains: the relay protocol block; the execute-stage path; mode `fix`; the plan path; the
   `COMMAND` line verbatim; the `CHANGED` list verbatim; **ASK = the relay**; **AUTONOMY = as
   bound in the relay preamble**. Run the relay loop.
   - `RESULT: pass <hash>` → report the plan path and the commit hash. Done.
   - `RESULT: fail` → report the failing `COMMAND` and that the work (its `CHANGED` paths) is
     **staged, not committed**. Done. Never spawn a second fix agent.

### Phased flow

A phased task has no top-level `prompt.md`; each phase directory holds its own four artifacts,
in full:

- `.zi/{slug}/phase-NN/prompt.md` — written by the prompt stage;
- `.zi/{slug}/phase-NN/plan.draft.md` — the plan stage's DRAFT;
- `.zi/{slug}/phase-NN/findings.md` — the verifier's output;
- `.zi/{slug}/phase-NN/plan.md` — the persisted plan the execute stage implements;

plus the orchestrator's one-line marker `.zi/{slug}/phase-NN/commit`. Below, `P` is shorthand
for `.zi/{slug}/phase-NN`.

1. For each phase directory `P`, **in order**, run the plan stage and the execute stage
   **exactly as written above**, with every `.zi/{slug}/<artifact>` path replaced by
   `P/<artifact>`: prompt path `P/prompt.md`, DRAFT `P/plan.draft.md`, verifier output
   `P/findings.md`, PERSIST → `P/plan.md`, execute plan path `P/plan.md`. Each phase gets
   fresh agents (plan, verifier, execute, and at most one fix); the fenced `@P/plan.md` block
   is printed per phase with the actual path; each phase's execute/fix agent commits on its
   own under the unchanged execute-stage rules — one commit per phase.
2. **Commit marker**: on a phase's `RESULT: pass <hash>` write the one-line file `P/commit`
   containing the hash (this marker is the only file the orchestrator ever writes, and it never
   reads it back — resume checks its presence with `Glob` only), then start the next phase.
   Flat tasks get no marker.
3. **Halt**: on a phase's final `RESULT: fail` (after its single fix agent) stop — never start
   a later phase — and report the failing phase directory `P`, the `COMMAND`, that the
   `CHANGED` paths are **staged, not committed**, that earlier phases' commits stay on the
   branch, and the resume command `/zi:task .zi/{slug}`.
4. After the last phase passes, report the list of phase plan paths (`P/plan.md`) and their
   commit hashes, in order. Done.

## Guardrails

- **Fresh `general-purpose` per stage**; never `fork`; never nested agents — the orchestrator
  spawns the verifier itself, the plan agent never does.
- **Paths only across boundaries.** Permitted boundary content is `.zi/{slug}/…` paths — for a
  phased task the `.zi/{slug}/phase-NN/…` paths of the phase being run. The only non-path
  content that crosses a boundary is: the raw idea text (prompt-stage input), the absolute
  stage-file paths, the TIMESTAMP value, the failing `COMMAND`, the `CHANGED` path list, and
  the relayed question/answer text. Anything else — file bodies, diffs, logs, restated
  artifacts — is a violation.
- **Phases run strictly in order**, each with fresh agents, and a phase's agents receive only
  that phase's `phase-NN/…` paths — no cross-phase artifact path ever crosses a boundary; a
  phase's failure halts the run.
- **The relay never restates**, and the orchestrator never reads artifact bodies (`Glob` only
  under `.zi/`). The `P/commit` marker is the only file the orchestrator writes, and it never
  reads it back — `Glob` presence only.
- **No gate after the prompt stage.** The only user interaction after `prompt.md` is written is
  the relay for stage questions and finding resolutions.
- **A non-conforming report is never a done.**
- **AUTONOMY is bounded.** Subagents self-resolve only decisions meeting all three criteria,
  never intent, and always record them; the record lives in the artifact or commit body, never
  in a payload.
- **Commit, never push.** The execute/fix agent commits implementation paths only, on the
  current branch; `.zi/` artifacts are never staged.
- Start this command from a **fresh session** — the orchestrator's own context should hold
  nothing but this run.
