---
description: Turn a prompt (inline or a prompt file) into a verified implementation plan — explore and draft in plan mode, have a fresh subagent independently verify it against the prompt and the codebase, interrogate the findings with the user one at a time, update the plan, then finish with a three-way choice: execute it now, exit plan mode, or run another independent reviewer and repeat. Both finishing paths persist the plan to .zi/{slug}/plan.md. Use for a single quick plan rather than the full prompt→research→prd→decompose pipeline.
argument-hint: [prompt file path / task-directory reference, or the problem statement text itself]
allowed-tools: Bash(date:*), Read, Grep, Glob, Agent, AskUserQuestion, EnterPlanMode, ExitPlanMode, Write, Edit
---

# Verified Plan

## Objective

Turn a prompt — inline text or a prompt file — into a **verified** implementation plan. Draft
the plan in plan mode, have a **fresh, independent subagent** verify it against the prompt and
the actual codebase, interrogate every finding with the user one at a time, update the plan,
then finish with a **three-way choice** — execute it now, exit plan mode, or run another
independent reviewer and repeat; both finishing paths persist the plan to `.zi/{slug}/plan.md`.
This is a standalone quick planner, not a step in the prompt→research→prd→decompose pipeline.

This command is a thin host wrapper: it resolves the input, enters plan mode, binds the stage's
seams for interactive use, runs the shared plan stage included at the end of this file (its
Phases 1–3), and owns Phase 4 — the three-way finish and persistence — itself.

## Operating rules (host)

- **Never implement unasked.** The command plans and verifies; it writes code only when the
  user picks **Execute now** at the final Phase 4 choice. On **Exit plan mode** it persists the
  plan and stops. It never begins implementing on its own.
- **Never persist early or "just in case."** The `.zi/{slug}/plan.md` artifact is written only
  after `ExitPlanMode` on Phase 4's **Execute now** or **Exit plan mode** branch — never during
  drafting or a second-reviewer round.

## Input

The argument may be **either** of the following — resolve it before doing anything else:

- **A prompt file or task directory** — a file path, a path to a `.zi/{slug}/` task directory,
  or a bare `{slug}` naming one (e.g. `.zi/20260605-143000-csv-export/prompt.md`,
  `.zi/20260605-143000-csv-export`, or `20260605-143000-csv-export`). If it resolves to a
  prompt file, read it and treat its contents as the prompt.
- **The problem statement text itself** — inline prose describing what to plan.

Raw argument:

$ARGUMENTS

Resolution rules:

1. If the argument is a path to an existing file, read it and use its contents as the prompt.
2. If the argument points to a task directory — `.zi/{slug}/`, or a bare `{slug}` that exists
   as `.zi/{slug}/` — read `prompt.md` inside it and use its contents as the prompt. If the
   directory exists but contains no `prompt.md` (e.g. it holds only an `overnight.md`), say so
   and ask the user what they want planned — never fall through to rule 3 and treat the path
   itself as the prompt.
3. Otherwise, treat the argument text verbatim as the prompt.
4. If the argument is empty, ask the user what they want planned before continuing. Do not
   invent a topic.

**Resolution may only read the prompt.** The single Read permitted here is of the prompt
file the argument resolves to (rule 1 or 2). Do **not** Read/Grep/Glob the codebase during
resolution — all codebase exploration happens *inside* plan mode in Phase 1, never before it.
While reading that prompt file, note its fixed-form `Autonomy: <level> (<setting>)` line if
present — it is the AUTONOMY binding below.

**Remember where the prompt came from.** If it resolved to a file **inside an existing
`.zi/{slug}/` directory**, note that — it decides where the plan is persisted in Phase 4.
Then confirm the resolved prompt back to the user (and the resolved file path, if any) so they
have explicit feedback on exactly what this command is about to plan.

## Plan mode first

Call `EnterPlanMode` **first — before any codebase exploration** (this asks the user to consent
to plan mode). This MUST be the first action after the prompt is resolved: do **not**
Read/Grep/Glob the codebase before this call. Entering plan mode up front makes the entire
explore-and-draft phase read-only, so the `Edit`/`Write` tools this command holds cannot mutate
real source while drafting. If the user declines plan mode, stop and ask how they want to
proceed — never explore or draft outside plan mode.

## Seam bindings

| Seam | Binding in this command |
|---|---|
| ASK | `AskUserQuestion` — one finding per call: the recommended fix first (labelled "(Recommended)"), any meaningful alternative, and an explicit **"Keep as-is"**; the tool's "Other" path is the custom-resolution path. |
| DRAFT | the **harness plan file** named in the plan-mode system message; draft with `Write`, apply finding resolutions with `Edit`. |
| VERIFY | this command launches **one fresh subagent** with the `Agent` tool, using a read-only agent type (`Explore`, or a `general-purpose` agent explicitly instructed to stay read-only and only report), with no access to this conversation. Its prompt says "Read and follow `${CLAUDE_PLUGIN_ROOT}/stages/verify.md` — your only stage text" and binds its seams: **PLAN** = the harness plan file path, **PROMPT** = the resolved prompt (file path, or inline text verbatim), **FINDINGS** = unbound (its findings arrive in its report text). The four rules that bind it are in that stage text; nothing else is passed — never this conversation, never `stages/plan.md`. It reads the autonomy level from the prompt's `Autonomy:` line per its stage text (absent, or inline text → zero). |
| PERSIST | Phase 4 below: the three-way choice, the bootstrap line, `ExitPlanMode`, then the Persistence rules. |
| AUTONOMY | the `Autonomy: <level> (<setting>)` line of the prompt file the argument resolved to; **zero (0.0)** when the line is absent or the prompt is inline text (no provenance word — this host has no restatement and detects no hint). It governs decisions inside the stage's Phases 1–3 and, on **Execute now**, implementation-time decisions; the Phase 4 choice itself is a host gate (see below). |
| AUDIT | **unbound** — the stage default applies (off, nothing written); interactive runs keep no audit file. |

Entry point: `draft` (the stage's Phase 1). Run the stage's Phases 1–3, then come back here
for Phase 4.

## Phase 4 — Choose the next step (repeatable)

Once every finding from the **latest** verification round is resolved and the plan is fully
updated, do **not** exit plan mode automatically. Present a single `AskUserQuestion` with
exactly three choices and act on the answer. This three-way choice and the `ExitPlanMode`
approval are **host gates, never scored — always asked at every autonomy level**; only
decisions inside the stage's Phases 1–3 and during Execute-now implementation use the AUTONOMY
binding.

1. **Execute now** — implement the finished plan in this same context. Call `ExitPlanMode` to
   leave plan mode (include any `allowedPrompts` the implementation needs, e.g. "run tests",
   "install dependencies"), persist the plan per the **Persistence** rules below, then implement
   it against the live repo: make the edits and verify with the project's real build / test /
   lint commands (these run through the user's normal permission prompts — this command
   pre-approves only `date`). This is the **only** path on which this command writes code.
2. **Exit plan mode** — call `ExitPlanMode` to present the finished plan for approval and hand
   control back, persist the plan per the **Persistence** rules below, and **stop** — do not
   implement. Whether the harness clears context on exit is the **user's own plan-mode setting**;
   respect whatever it does — this command neither forces nor prevents it.
3. **Run a second reviewer** — stay in plan mode and repeat the stage's **Phases 2–3** with a
   brand-new, independent subagent: fresh verification of the *current* plan, then interrogate
   its findings one at a time and apply each, exactly as with the first reviewer. When that
   round finishes, return to **this** three-way question. The user may request as many review
   rounds as they want before executing or exiting.

On the two finishing branches (**Execute now** and **Exit plan mode**), do this **before**
calling `ExitPlanMode`, while the harness plan file is still editable:

1. **Resolve the persistence path now.** Apply the **Persistence** rules below to determine the
   exact `.zi/{slug}/plan.md` path (existing task directory, or invocation timestamp + fresh
   slug). Only *resolve* the path — create nothing under `.zi/` yet; plan mode forbids it.
2. **Prepend the bootstrap line** to the top of the harness plan file with `Edit`, carrying the
   **actual** resolved path (never the literal `{slug}`):

   > Bootstrap (remove this line when persisting): first write this plan, minus this line,
   > verbatim to `.zi/20260101-000000-example/plan.md`, then continue.

   The line exists for the case where the user's plan-mode setting **clears context on
   approval**: the approved plan text is the only thing carried into the fresh context, so the
   persistence instruction must ride inside the plan itself to survive the clear. In the
   same-context case it is harmlessly redundant — the very next step persists the plan (minus
   the line) and the harness plan file is discarded. It is an instruction inside the plan file,
   not an early persist: nothing is written under `.zi/` before `ExitPlanMode`.

If the user **rejects** the `ExitPlanMode` approval on either branch, the session is still in
plan mode and nothing may be persisted or implemented: **remove the bootstrap line** from the
plan file first (a later review round would rightly flag it as invented scope), then treat the
rejection feedback as a new finding — resolve it Phase-3 style (state it, recommend a fix, ask,
apply) if it is concrete — then return to this three-way question.

Carry all three as explicit options every time; never pick for the user. It is fair to note that
**Execute now** saves the tokens a fresh context would spend re-grounding when context usage is
low — but the choice is always theirs.

### Persistence (Execute now and Exit plan mode)

`ExitPlanMode` has left plan mode, so `Write` is now permitted. Write the final plan — **minus
the bootstrap line** — to the `.zi/{slug}/plan.md` path resolved before exiting:

- **If the prompt came from a file inside an existing `.zi/{slug}/` directory** — write
  `plan.md` as a **sibling** in that same directory, so it stays paired with its source.
- **Otherwise** (inline text, or a file outside `.zi/`) — create a fresh task directory, stamped
  with the timestamp below (captured when the command was invoked; its exact value is not
  important — it only dates the session and gives task directories a natural ordering — so do
  not re-derive it; only if it is missing, run `date +%Y%m%d-%H%M%S` yourself):

  !`date +%Y%m%d-%H%M%S`

  Derive a
  **1–4 word** kebab-case `{description}` slug that identifies the task (e.g.
  `auth-token-refresh`, `csv-export`), create `.zi/{YYYYMMDD-HHmmss}-{description}/` (and `.zi/`
  itself) if it does not yet exist, and write `plan.md` inside it.

Then tell the user the exact path you wrote (including the `.zi/{slug}/` prefix) and print — on
its own line — a fenced code block whose sole content is a bare file-mention of the plan you
just wrote, with the **actual** resolved path (never the literal `{slug}`), so it can be
copy-pasted in one tap to start an implementation session (e.g. from the Android Claude app over
a remote-control session):

```
@.zi/20260101-000000-example/plan.md
```

On **Exit plan mode**, stop here. On **Execute now**, go on to implement the plan.

## Guardrails

- **Plan mode first.** `EnterPlanMode` is the first action after the prompt is resolved; no
  codebase Read/Grep/Glob happens before it. Resolution itself only reads the prompt file.
- **Never persist early.** The `.zi/{slug}/plan.md` artifact is written only after `ExitPlanMode`
  on Phase 4's **Execute now** or **Exit plan mode** branch — never "just in case," and never
  during a second-reviewer round. The bootstrap line prepended before exit is an instruction
  inside the harness plan file, not a persist — it writes nothing under `.zi/`.
- **Independence is mandatory.** Every verifier — the first and each **Run a second reviewer**
  round — is a fresh subagent with no view of this conversation, not a self-review pass.
- **One finding at a time.** In every review round, resolve and apply each finding before raising
  the next; never present them as a batch, and never silently pick an interpretation — ask, or
  self-resolve only at a score ≤ the bound setting and record it.
- **Phase 4 is never scored.** The three-way choice and the `ExitPlanMode` approval are host
  gates, always asked at every autonomy level; the binding applies only inside the stage's
  Phases 1–3 and to implementation-time decisions on **Execute now**.
- **Ground every claim; specify intent, not source.** Describe what to build and the target
  interfaces; do not paste final code into the plan.
- **Implementation is opt-in and final.** The command writes code only on the explicit
  **Execute now** choice at Phase 4; **Exit plan mode** persists and stops; **Run a second
  reviewer** loops. It never starts implementing on its own.
- **A rejected exit changes nothing.** If the user rejects the `ExitPlanMode` approval, the
  session stays in plan mode, nothing is persisted or implemented, and control returns to the
  Phase 4 three-way question once the bootstrap line is removed from the plan file.

## The stage

Follow the stage text below exactly, with the seams bound as above. Its Phases 1–3 run after
`EnterPlanMode`; Phase 4 above follows.

@${CLAUDE_PLUGIN_ROOT}/stages/plan.md
