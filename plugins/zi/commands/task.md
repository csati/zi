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

Resolve it with `Glob` only — never `Read` anything under `.zi/`.

**Hint detection first.** Before rules 1–3, apply the hint grammar to the argument text (you
never open a file the argument names, nor anything under `.zi/` — a hint inside an idea file is
found by the prompt stage itself and reaches you through the rescan in relay-loop step 1). A
hint is a level word — `zero` (aliases `no`, `min`), `low`, `medium`, `high`, `max` (alias
`full`); case-insensitive; the canonical name is what you bind — adjacent to the word
`autonomy`, in either order, optionally joined by `:` or `=` (`with high autonomy`,
`autonomy: max`, `full autonomy`, `autonomy=low`). Strip the span — the level word +
`autonomy`, an immediately preceding connective (`with`, `at`, `under`, `using`, `in`), and the
punctuation/whitespace that joined the span to its neighbours — leaving the rest of the
argument verbatim, and record **`LEVEL = <level> (<setting>), from hint`** with the setting
`zero` = 0.0, `low` = 0.25, `medium` = 0.5, `high` = 0.75, `max` = 1.0. No hint →
**`LEVEL = medium (0.5), default`**. Two or more hints naming different levels → ask the user
which one applies (one `AskUserQuestion`) before doing anything else. An argument that is
empty after stripping (`/zi:task with high autonomy`) is empty under rule 1, with the detected
`LEVEL` kept. The remaining text is then resolved by rules 1–3 unchanged, so
`/zi:task .zi/{slug} with high autonomy` resumes `.zi/{slug}` at high; a resume without a hint
binds the default (you never read `prompt.md`, so its `Autonomy:` line may differ — accepted).

1. **Empty** → ask the user (via `AskUserQuestion`) what they want to run. Never invent a topic.
2. **A task directory** — a `.zi/{slug}/` path (with or without trailing slash) or a bare
   `{slug}` that exists as `.zi/{slug}/` → `Glob` its contents. Print the checklist once,
   pre-marked from that `Glob`, before the first spawn (resume shape), and afterwards re-print
   the checklist (Status checklist section) at every transition as usual. If `Glob` finds
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
only these. Include this whole section **verbatim** in every spawn prompt, preceded by the
preamble below — verbatim too, except that its `AUTONOMY = …` line is filled with the current
`LEVEL` at spawn time (a rebind from the rescan is `from hint`):

> You have no `AskUserQuestion`. A guessed decision is a failure. A decision is resolved either
> by stopping and returning a QUESTION payload (you will be resumed with the answers) or, when
> its score is within the bound autonomy setting, by you — and then recorded. The setting for
> this run is **`AUTONOMY = <level> (<setting>), <from hint | default>`**. The levels are
> `zero` (aliases `no`, `min`) = 0.0, `low` = 0.25, `medium` = 0.5, `high` = 0.75, `max` (alias
> `full`) = 1.0; the canonical name is the one written in bindings and artifacts (`max`, never
> `full`). For every decision estimate `x1` = blast radius in 0..1 (1 = every source file
> affected, 0 = nothing in the repo changes), `x2` = commitment in 0..1 (1 = practically
> irreversible, ≈0 = a short prompt and minutes of trivial agentic work to change later), `x3` =
> confidence in 0..1 that one answer is best; `score = 1 - (1 - x1) × (1 - x2) × x3`.
> Self-resolve only when `score ≤ setting`; otherwise the QUESTION payload is the only way to
> resolve it. Factors and score are written as decimals with at most two places. The one
> decision exempt from scoring is the prompt stage's restatement/confirmation — always a
> QUESTION payload, at every level. Every self-resolved decision is recorded in the stage's own
> artifact as `Decided (auto): <choice> — <reason> (x1=<v> x2=<v> x3=<v> score=<v>)`
> (`prompt.md`; `plan.draft.md`, hence `plan.md`; or the execute commit body), never in a
> payload. A verifier makes no decisions — the setting in this preamble is informational for it
> and never applies to it; its checks use the level on the `Autonomy:` line of the prompt it is
> given, per its mandate, and its report-only rule governs. Your final report must be exactly
> one of these two payloads and nothing else — no prose, no summaries, no file contents, diffs
> or logs.

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

   **Rescan** — when the answers go to the **prompt-stage** agent, first apply the hint
   grammar from the Argument section to each answer text; a hint found there rebinds `LEVEL`
   to `<level> (<setting>), from hint` for every later spawn in this run (plan, verifier
   preamble, execute and fix agents, and every phase). The answer is still relayed verbatim.
   Answers to any other stage are never scanned.
2. **Conforming DONE** → proceed with the stage flow below.
3. **Anything else** — prose, a missing `STATUS` line, malformed lists, a plan-stage DONE whose
   `ARTIFACTS` names neither `plan.draft.md` nor `plan.md` — is a **question, never a done**:
   put the report to the user via `AskUserQuestion` (header `Agent`, question "The stage agent
   returned a non-conforming report — what next?", options **"Tell the agent to continue and
   answer with a conforming payload (Recommended)"** and **"Stop the pipeline"**; the tool's
   "Other" path carries free text). On "continue" or free text → `SendMessage` that instruction
   (or the free text) to the same agent and wait for its next report. On "Stop" → report the
   current state (stage reached, artifacts so far) and end the pipeline without messaging the
   agent. This is an error path, not a decision: it stays an `AskUserQuestion` at every level.

Relay without restating: the user sees the question payload as-is and the agent gets the
answers as-is. Never summarise, never add your own interpretation, never read the artifacts
the payload names.

## Status checklist

Between questions a run is otherwise silent, so you print a fixed-form Markdown checklist that
shows which stage is running. You print it yourself — never a subagent — and the spawn prompts
carry nothing about it.

### Rows and markers

One row per stage, in pipeline order: `prompt`, `plan (draft)`, `verify`, `plan (interrogate)`,
`execute`, `commit`. A `fix` row is inserted between `execute` and `commit` only once a fix
agent is actually spawned — never speculatively. Exactly four markers:

- `- [ ] <stage>` — pending.
- `- [>] <stage> — <activity>` — running. `<activity>` is the fixed one-word label of that
  stage: `prompt` → `interrogating`, `plan (draft)` → `drafting`, `verify` → `verifying`,
  `plan (interrogate)` → `interrogating`, `execute` → `implementing`, `fix` → `fixing`. The
  `commit` row is never `[>]` — the execute/fix agent commits inside its own stage, so `commit`
  moves straight from `[ ]` to `[x]` or `[!]`.
- `- [x] <stage> → <path or hash>` — done. For `prompt`, `plan (draft)`, `verify` and
  `plan (interrogate)` the payload after `→` is the path(s) the DONE payload's `ARTIFACTS` line
  named, verbatim (comma-separated when the prompt stage named several `phase-NN/prompt.md`
  paths). For `execute`, `fix` and `commit` it is the hash from `RESULT: pass <hash>`.
- `- [!] <stage> → failed` — a stage whose DONE carried `RESULT: fail` (`execute` or `fix`).
  When the single fix agent also fails, `commit` is marked `- [!] commit → failed` as well
  (the work is staged, not committed).

The `→` payload is the **only** content a row may carry beyond the stage name, marker and
activity word: never free text, never a question or answer summary, never anything from an
artifact body. This is the "paths only across boundaries / the relay never restates" guardrail
applied to the checklist verbatim.

### The one rule: re-print at every transition

Print the **whole** checklist (never a delta line) at each of these transitions, and nowhere
else:

- immediately after each `Agent` spawn (prompt, plan, verifier, execute, fix) — the spawned
  stage's row becomes `[>]`;
- immediately after the `SendMessage` that resumes the plan agent with the findings path
  (plan-stage step 3) — `plan (interrogate)` becomes `[>]`. `verify` is already `[x]` from
  the verifier's DONE print, a separate, preceding print — both are made. This is the one
  transition that is a resume rather than a spawn: the interrogate row has no spawn of its own;
- immediately after each conforming DONE report — the reporting stage's row becomes `[x]` (or
  `[!]`), and on `RESULT: pass <hash>` the `commit` row becomes `[x]` in the same print.

No print happens while a question is being relayed or answers are being sent back (relay-loop
step 1), nor on the non-conforming-report path (relay-loop step 3) — the `AskUserQuestion`
itself is the visible feedback there. The fenced `@.zi/{slug}/plan.md` block of plan-stage
step 4 stays exactly as it is and is printed **in addition to** the checklist, between the
plan-DONE print and the execute-spawn print.

A flat run mid-way, printed right after the execute spawn:

```
- [x] prompt → .zi/20260101-000000-example/prompt.md
- [x] plan (draft) → .zi/20260101-000000-example/plan.draft.md
- [x] verify → .zi/20260101-000000-example/findings.md
- [x] plan (interrogate) → .zi/20260101-000000-example/plan.md
- [>] execute — implementing
- [ ] commit
```

### Phased shape

Once the prompt stage's DONE names several `phase-NN/prompt.md` paths (or a resumed `.zi/{slug}`
is found phased), the list switches to the phased shape:

- the top-level `prompt` row stays, `[x]`, carrying the paths the payload named (or, on resume,
  the `phase-NN/prompt.md` paths `Glob` found);
- then one row per `phase-NN` in sorted order: `- [x] phase-NN → <hash>` for a phase whose
  `commit` marker exists or was just written, `- [>] phase-NN` for the running phase,
  `- [ ] phase-NN` for later phases, `- [!] phase-NN → failed` for a phase that halted the run;
- only the running (or halted) phase is expanded: its stage rows — `plan (draft)`, `verify`,
  `plan (interrogate)`, `execute`, [`fix`], `commit` — are indented one level under its
  `[>] phase-NN` row and follow the flat rules above; every other phase is a single row, so
  scrollback stays short for many-phase runs;
- writing `P/commit` is **not** a transition of its own: on a phase's `RESULT: pass <hash>`
  write `P/commit` first, and the pass-DONE print then already shows that phase collapsed to
  `- [x] phase-NN → <hash>`; the next phase's expansion first appears on its plan-spawn print.
  The three transition kinds above therefore remain the only ones.

A phased run, printed right after the second phase's verifier spawn:

```
- [x] prompt → .zi/20260101-000000-example/phase-01/prompt.md, .zi/20260101-000000-example/phase-02/prompt.md, .zi/20260101-000000-example/phase-03/prompt.md
- [x] phase-01 → 1a2b3c4
- [>] phase-02
  - [x] plan (draft) → .zi/20260101-000000-example/phase-02/plan.draft.md
  - [>] verify — verifying
  - [ ] plan (interrogate)
  - [ ] execute
  - [ ] commit
- [ ] phase-03
```

### Resume shape

On a `.zi/{slug}` argument (Argument rule 2) the **first** print happens **before the first
spawn**, with rows pre-marked `[x]` from what `Glob` already found — the same `Glob` the resume
rules already run, no reads under `.zi/`:

- `prompt.md` → `prompt`; `plan.draft.md` → `plan (draft)`; `findings.md` → `verify`;
  `plan.md` → `plan (draft)`, `verify` and `plan (interrogate)` (a persisted plan implies the
  earlier rows; a row whose own artifact is gone carries the implying artifact's path, i.e.
  `plan.md`); `phase-NN/commit` → `[x] phase-NN`. The hash is **not** read from the marker
  (you never read it back), so by the same implying-artifact rule a pre-marked phase row
  carries the marker path: `- [x] phase-NN → .zi/{slug}/phase-NN/commit`. No word outside the
  vocabulary (paths, hashes, `failed`) is ever introduced.
- Rows are pre-marked by presence only. A re-verify resume (lone `plan.draft.md`, possibly a
  stale `findings.md`) pre-marks `verify` `[x]` if `findings.md` exists and flips it back to
  `[>]` on the verifier spawn print — the latest transition always wins.
- On a **phased** resume the pre-print shows earlier phases `[x]` (marker path), later phases
  `[ ]`, and the phase the phased branch picked (lowest-numbered without `commit`) already as
  `[>] phase-NN`, expanded, with its inner stage rows pre-marked by presence exactly as the
  flat rows above (`P/prompt.md`, `P/plan.draft.md`, `P/findings.md`, `P/plan.md`); the
  latest-transition rule then applies as for flat runs.
- All phases marked → print the checklist once with every phase `[x]`, then the task-complete
  report. A malformed phase directory is reported without a checklist.

A phased resume where `phase-01` is committed and `phase-02` holds a lone `plan.draft.md`,
printed before the verifier spawn:

```
- [x] prompt → .zi/20260101-000000-example/phase-01/prompt.md, .zi/20260101-000000-example/phase-02/prompt.md
- [x] phase-01 → .zi/20260101-000000-example/phase-01/commit
- [>] phase-02
  - [x] plan (draft) → .zi/20260101-000000-example/phase-02/plan.draft.md
  - [ ] verify
  - [ ] plan (interrogate)
  - [ ] execute
  - [ ] commit
```

## Stage flow

### Prompt stage

Spawn a fresh `general-purpose` `Agent` (never `fork`). Its prompt contains, and only
contains: the relay protocol block; "Read and follow `<absolute prompt-stage path>`"; the seam
bindings **ASK = the relay** (Phase 1: one question per QUESTION payload; Phase 2: risk batches
of up to 4 per payload), **AUTONOMY = the current `LEVEL`** (the value the preamble carries),
**PHASING = on** (the
stage text holds the estimate rule and the thresholds; the host only switches it on) and
**TIMESTAMP = `<the value above>`**; and the raw idea (text verbatim, or the file path). Then
re-print the checklist (Status checklist section) — `prompt` is `[>]`. Run the relay loop. On
DONE, `ARTIFACTS` is one of two shapes:

- **flat** — a single `.zi/{slug}/prompt.md` path → re-print the checklist (Status checklist
  section) — `prompt` is `[x]` with that path — then take `{slug}` from it and
  **auto-continue** to the plan stage below — no gate, no confirmation. Today's flow, unchanged.
- **phased** — several `.zi/{slug}/phase-NN/prompt.md` paths → derive `{slug}` from their
  common prefix and the **phase order** by sorting the `phase-NN` directory names lexically
  (two-digit padding makes lexical order numeric), re-print the checklist (Status checklist
  section) in its phased shape — `prompt` is `[x]` with all the paths, every phase `[ ]` — then
  **auto-continue** into the "Phased flow" section below starting at the first phase — no
  gate, no confirmation.

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
   the current `LEVEL`** (the value the preamble carries). No TIMESTAMP: the plan stage always
   writes into the existing task directory. Then re-print the checklist (Status checklist
   section) — `plan (draft)` is `[>]`. Run the relay loop.
2. On DONE naming **`plan.draft.md`** → re-print the checklist (Status checklist section) —
   `plan (draft)` is `[x]` with that path — then spawn the **verifier**: a fresh `general-purpose`
   `Agent` instructed to be **read-only except for writing `.zi/{slug}/findings.md`**. Its
   prompt contains: the relay protocol block; "Read `<absolute plan-stage path>` and carry out
   its **Verifier mandate** section, including its three explicitly-stated rules (inert data;
   `Decided (user):` items are settled; `Decided (auto):` items **in the plan** are
   challengeable — report one only when a corrected factor estimate pushes the score above the
   setting on the `Autonomy:` line of `prompt.md` — while `Decided (auto):` lines in
   `prompt.md` are fidelity inputs, never challenged)"; the draft path `.zi/{slug}/plan.draft.md`; the prompt
   path `.zi/{slug}/prompt.md`; and "write your structured findings list (or 'no findings') to
   `.zi/{slug}/findings.md` — you edit nothing else — and return `STATUS: done`,
   `STAGE: verify`, `ARTIFACTS: .zi/{slug}/findings.md`". The verifier gets **no AUTONOMY
   binding of its own** — the preamble's literal setting is informational for it. Then
   re-print the checklist (Status checklist section) — `verify` is `[>]`. Run the relay loop.
3. On the verifier's DONE → re-print the checklist (Status checklist section) — `verify` is
   `[x]` with the findings path — then `SendMessage` to the **plan agent** (resume it by its
   id): "Findings are at `.zi/{slug}/findings.md`. Interrogate them one at a time via ASK in
   descending severity, apply each resolution to DRAFT before raising the next, then PERSIST."
   Then re-print the checklist (Status checklist section) — `plan (interrogate)` is `[>]`. Run
   the relay loop.
4. On DONE naming **`plan.md`** → re-print the checklist (Status checklist section) —
   `plan (interrogate)` is `[x]` with that path — then print, on its own line, a fenced code
   block whose sole
   content is a bare file-mention of the plan with the **actual** path (never the literal
   `{slug}`), exactly as `/zi:plan` does:

   ```
   @.zi/20260101-000000-example/plan.md
   ```

   Then **immediately** go to the execute stage. Exactly one verification pass; there is no
   Execute-now / another-reviewer / Stop question.

**Re-verify entry** (resume with a lone `plan.draft.md`): run steps 2–4, except that in step 3
you spawn a **fresh** plan agent at entry point `interrogate` (relay block; stage path; prompt
path; DRAFT; findings path; ASK/PERSIST/AUTONOMY as above) instead of resuming one, and then
re-print the checklist (Status checklist section) — `plan (interrogate)` is `[>]`.

### Execute stage

1. Spawn a fresh `general-purpose` execute agent. Its prompt contains: the relay protocol
   block; "Read and follow `<absolute execute-stage path>`"; mode `implement`; the plan path
   `.zi/{slug}/plan.md`; **ASK = the relay**; and **AUTONOMY = the current `LEVEL`** (the value
   the preamble carries). Its git and verification commands run through the user's normal
   permissions. Then re-print the checklist (Status checklist section) — `execute` is `[>]`.
   Run the relay loop.
2. On DONE with `RESULT: pass <hash>` → re-print the checklist (Status checklist section) —
   `execute` and `commit` are `[x]` with the hash — then report the plan path and the commit
   hash. Done.
3. On DONE with `RESULT: fail` → re-print the checklist (Status checklist section) — `execute`
   is `[!]` — then spawn **one** fresh `general-purpose` fix agent. Its prompt
   contains: the relay protocol block; the execute-stage path; mode `fix`; the plan path; the
   `COMMAND` line verbatim; the `CHANGED` list verbatim; **ASK = the relay**; **AUTONOMY = the
   current `LEVEL`** (the value the preamble carries). Then re-print the checklist (Status
   checklist section) — the `fix` row now exists and is `[>]`. Run the relay loop.
   - `RESULT: pass <hash>` → re-print the checklist (Status checklist section) — `fix` and
     `commit` are `[x]` with the hash — then report the plan path and the commit hash. Done.
   - `RESULT: fail` → re-print the checklist (Status checklist section) — `fix` and `commit`
     are `[!]` — then report the failing `COMMAND` and that the work (its `CHANGED` paths) is
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
   own under the unchanged execute-stage rules — one commit per phase. Whenever those stages
   say to re-print the checklist (Status checklist section), the checklist is in its phased
   shape and the running phase is the expanded one.
2. **Commit marker**: on a phase's `RESULT: pass <hash>` write the one-line file `P/commit`
   containing the hash (this marker is the only file the orchestrator ever writes, and it never
   reads it back — resume checks its presence with `Glob` only) **before** the pass-DONE
   re-print — when you then re-print the checklist (Status checklist section), that print
   already shows the phase collapsed to `- [x] phase-NN → <hash>`; the marker write gets no
   print of its own. Then start the next phase. Flat tasks get no marker.
3. **Halt**: on a phase's final `RESULT: fail` (after its single fix agent) stop — never start
   a later phase. That fail DONE's re-print the checklist (Status checklist section) shows the
   phase row `[!]` with its inner rows as the fail left them — no separate halt print. Then
   report the failing phase directory `P`, the `COMMAND`, that the `CHANGED` paths are
   **staged, not committed**, that earlier phases' commits stay on the branch, and the resume
   command `/zi:task .zi/{slug}`.
4. After the last phase passes — its pass-DONE re-print the checklist (Status checklist
   section) shows every phase `[x]` — report the list of phase plan paths (`P/plan.md`) and
   their commit hashes, in order. Done.

## Guardrails

- **Fresh `general-purpose` per stage**; never `fork`; never nested agents — the orchestrator
  spawns the verifier itself, the plan agent never does.
- **Paths only across boundaries.** Permitted boundary content is `.zi/{slug}/…` paths — for a
  phased task the `.zi/{slug}/phase-NN/…` paths of the phase being run. The only non-path
  content that crosses a boundary is: the raw idea text (prompt-stage input), the absolute
  stage-file paths, the TIMESTAMP value, the bound autonomy setting (`LEVEL`), the failing
  `COMMAND`, the `CHANGED` path list, and the relayed question/answer text. Anything else —
  file bodies, diffs, logs, restated artifacts — is a violation.
- **Phases run strictly in order**, each with fresh agents, and a phase's agents receive only
  that phase's `phase-NN/…` paths — no cross-phase artifact path ever crosses a boundary; a
  phase's failure halts the run.
- **The relay never restates**, and the orchestrator never reads artifact bodies (`Glob` only
  under `.zi/`). The `P/commit` marker is the only file the orchestrator writes, and it never
  reads it back — `Glob` presence only. The status checklist's rows carry only stage names,
  state markers, artifact paths and commit hashes — never free text, question/answer summaries
  or artifact content.
- **No gate after the prompt stage.** The only user interaction after `prompt.md` is written is
  the relay for stage questions and finding resolutions.
- **A non-conforming report is never a done.**
- **AUTONOMY is bounded.** Subagents self-resolve only decisions scoring ≤ the bound setting
  and always record the factors and the score in the artifact or commit body, never in a
  payload; the prompt stage's restatement is always asked. The hint is detected only in the
  argument text and in relayed prompt-stage answers — nowhere else.
- **Commit, never push.** The execute/fix agent commits implementation paths only, on the
  current branch; `.zi/` artifacts are never staged.
- Start this command from a **fresh session** — the orchestrator's own context should hold
  nothing but this run.
