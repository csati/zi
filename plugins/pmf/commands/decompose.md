---
description: Decompose a PRD into an ordered set of self-contained plan-stage-{NN}.md files, each runnable by a fresh agent (no shared context) within a ~50K-token budget. Use after /pmf:prd to turn a PRD into sequential implementation stages.
argument-hint: [path to the prd.md or its task directory, defaults to the lone prd.md under .pmf/]
allowed-tools: Bash(date:*), Bash(git:*), Read, Grep, Glob, AskUserQuestion, Write
---

# Decompose PRD

## Objective

Split a Product Requirements Document into **N ordered plan-stage files** — `.pmf/{slug}/plan-stage-{NN}.md`. Run in sequence by fresh agents, the stages fully implement the PRD. Every stage must be:

- **Self-contained** — it carries everything its agent needs; it never relies on another stage's conversation or memory.
- **Sequentially dependent only via the repo** — the only thing a stage inherits from earlier stages is the **committed repository state** they left behind, expressed as verifiable facts.
- **Repo-green on exit** — it compiles and its tests pass when done, so the next fresh agent starts from a known-good checkout.
- **Budget-targeted** — `/pmf:decompose` *sizes* each stage to aim for **under ~50K tokens** of execution (target ≤ ~40K for headroom). This is a planning goal for the split, not a limit the running agent must enforce — the agent runs the stage to completion and simply reports its actual token usage.

## Input

PRD path:

$ARGUMENTS

Resolve the PRD before doing anything else:

1. If the argument is a non-empty path to an existing file, use that file as the PRD. If it points to a task directory (`.pmf/{slug}/`, or a bare `{slug}`), use the `prd.md` inside it.
2. Otherwise, glob `.pmf/*/prd.md` and act on the count of matches:
   - **Zero matches** — nothing to decompose. Tell the user no `prd.md` was found under any `.pmf/` task directory and **terminate**.
   - **Exactly one match** — use it (state which file you picked).
   - **More than one match** — ask the user which PRD to use (list the candidate task directories) and wait for their choice.
3. If a path is given but the file does not exist, say so and stop.

Confirm the resolved PRD path back to the user before proceeding.

## Process

Work through these phases. **Do not write any stage file until Phase 3 is approved by the user.**

### Phase 1 — Analyze the PRD and ground it in the code

1. Read the PRD in full. Extract every functional requirement (`FR-*`), technical constraint, non-goal, and acceptance criterion.
2. Ground it in reality with `Read`/`Grep`/`Glob`: locate the modules, files, and patterns each requirement touches, and the project's actual **build / test / lint commands** (from its `AGENTS.md` / `CLAUDE.md`). Respect existing module boundaries.
3. Build a dependency graph of the requirements: what must exist before what (shared models, ports/interfaces, schema, and DI wiring before the features that consume them; implementation before the integration that uses it).
4. **Confirm a test harness exists.** From step 2, pin down the project's real test command and where tests live. If there is **no test harness** — no test command in `AGENTS.md` / `CLAUDE.md`, no test directories — the `test-coverable` FRs cannot be made executable. Surface this with `AskUserQuestion` **before slicing**, and let the user choose: (a) **add a harness** — name the framework and the test command a stage will stand up, so later stages can author against it; or (b) **waive tests** for the affected FRs. **Persist the choice as an artifact** (state travels in files, not this conversation): fold the chosen harness command into the stages that author tests, or record the waiver — which FRs it covers and that the user agreed — in the PRD or a dedicated note in a stage file, so the unattended finalize knows tests were waived by agreement rather than silently missing.

### Phase 2 — Slice into ordered stages

Cut the work into an **ordered** sequence where each stage satisfies every property in the Objective. Concretely:

- **Order topologically** — foundational/shared pieces first (models, schema, ports/interfaces, DI wiring), then features that build on them, then integration, tests, and polish.
- **Express dependencies as verifiable repo facts** — "`FooRepository` exists at `path` with method `bar`", not "what you built in stage 2".
- **Keep each stage cohesive** — prefer one module/concern per stage and a small, closely-related set of files.
- **Leave the tree green** — never end a stage mid-refactor; the build and tests must pass on exit.

#### Budgeting — the ~50K target

This budget governs **how `/pmf:decompose` sizes the split** — it is not a runtime cap on the agent that later runs the stage. Aim each stage under the target at planning time; the executing agent always finishes its stage regardless.

Estimate each stage's execution cost as the sum of:

- **Context reads** — files the agent must read (a ~300-line source file ≈ 3–4K tokens; include the relevant PRD sections).
- **Code produced** — files created/modified and their net diff.
- **Test authoring** — for each `test-coverable` FR this stage completes, writing or extending its acceptance test(s): a read of the existing test file/fixtures plus the new test code. This is real diff, not free — count it as its own line, and re-balance the cuts so a stage that owns a feature *and* its test still lands under budget.
- **Verification** — running the build/test/lint commands and the per-FR selectors, plus a buffer for one or two iterations.
- **Overhead** — a safety buffer for reasoning and retries.

Rule of thumb: a stage should read on the order of **≤ ~8–10 files** and produce a **bounded diff (≈ ≤ ~300 net lines)**, test code included. If a slice would exceed the budget, **split it**. If two adjacent slices are trivially small and share context, consider **merging** them — but never merge across a dependency that balloons the result. **N is whatever the budget dictates**, not a number picked up front.

### Phase 3 — Propose the stage plan and confirm

Before writing anything, present the proposed decomposition:

- The stage count **N**.
- For each stage: a one-line title, the FRs/scope it covers, its key files, what prior repo state it depends on, and an estimated token budget. For any `test-coverable` FR a stage completes, name the **test selector** that stage will own — the exact command that runs that FR's tests (e.g. `pytest tests/export.py::test_csv_headers`).

Use `AskUserQuestion` (or ask plainly) to confirm or adjust. **Do not write stage files until the user approves the breakdown.**

### Phase 4 — Write the stage files

Write the stage files as siblings of the PRD, inside the same `.pmf/{slug}/` task directory the PRD lives in (the normal case). Only if the PRD was passed by a custom path outside `.pmf/` do you create a fresh task directory — get a timestamp with

!`date +%Y%m%d-%H%M%S`

and derive a 1–4 word kebab-case `{description}` from the PRD title to form `.pmf/{YYYYMMDD-HHmmss}-{description}/`.

Write one file per stage into the task directory, named exactly (zero-pad `N` to two digits so the files sort in execution order):

```
.pmf/{slug}/plan-stage-{NN}.md
```

Each stage file MUST follow this structure, filled with concrete, project-specific detail (real paths, real commands):

```markdown
# Stage {N} of {M} — {stage title}

> Source PRD: `.pmf/{slug}/prd.md` — read it for full background.
> Run this stage with a **fresh agent**. It assumes ONLY the committed repository state left by stages 1–{N-1}, never any prior conversation.

## Mission

{One paragraph: what this stage delivers and why.}

## Preconditions (repo state this stage assumes)

- {A verifiable fact left by an earlier stage, with the path/symbol to confirm it.}
- ...
{For stage 1: "A clean checkout of `{branch}`; none of this PRD is implemented yet."}

## Context to load

Read only what you need (kept small to stay in budget):

- `{path}` — {why}
- ...
- PRD sections: {which FRs this stage covers}

## Files this stage owns

The files this stage creates or modifies — its exclusive ownership for the duration. Be exhaustive and specific; the decomposition review uses this list to detect cross-stage conflicts. **If this stage completes a `test-coverable` FR, the test file(s) that encode its acceptance criteria are part of this ownership list** — name them explicitly.

- `{path}` — {created | modified} — {what changes}
- `{test path}` — {created | modified} — {the acceptance test(s) for the `test-coverable` FR(s) this stage completes}
- ...

## Tasks

> **Before changing anything:** read the files under "Context to load" and confirm every precondition above actually holds in the repo. **If a precondition is false, or the plan contradicts what the code now shows, STOP and report the conflict — do not work around it.** A stale plan must be revised (re-run `/pmf:decompose`, or fix the affected stage files), not forced; forcing it corrupts every stage that follows.

1. {Concrete, ordered step — describe the intent and the target interface/behaviour, not a paste of the final source. The implementing agent writes the actual code against the real repo.}
2. ...
{If this stage completes a `test-coverable` FR: include an explicit step to **author or extend that FR's acceptance test**, named so the selector in "Acceptance criteria" resolves to it. Describe *what* to assert — the behaviour and the cases — not literal test source. **Pin the expected values to the PRD's concrete acceptance values** (e.g. "first CSV row equals header `id,name,email`"), carried verbatim from the PRD's acceptance criteria into this step — never "assert it works" and never an expected value back-derived from the implementation's own output. The same agent writes both the code and this test; the more its assertions come straight from the PRD, the less room it has to back-fit the test to its own buggy output.}

## Acceptance criteria

- {Testable outcome.}
- **FR-{N} proven:** `{exact selector that runs THIS FR's acceptance test — e.g. `pytest tests/export.py::test_csv_headers`, `go test ./export -run TestCSVHeaders`}` passes. This stage **authors or extends** that test to encode FR-{N}'s acceptance criteria, with its **assertions pinned to the PRD's concrete acceptance values** (carried verbatim from the PRD, never back-derived from the implementation's output); **name the test so this exact command runs it.** (One line per `test-coverable` FR this stage completes; omit for `inspection-only` FRs. If tests were waived in Phase 1, cite the recorded waiver instead of a selector.)
- Build is green: `{exact build command}`
- Tests pass: `{exact test command}`
- {Lint/format if the project requires it: `{exact command}`}

> The per-FR selector above is this stage's **own gate**, not just a note for finalize: the green check **runs that exact selector** and requires it to pass — not merely "include the new tests" as a vague set. Because the selector is written here *before the test exists*, naming the test to match it is what binds them. Any selector/test-name drift then surfaces **now**, as an ordinary red-test failure at stage time — instead of later in the unattended finalize, where a stale selector resolves to nothing and the FR falsely reads "missing" despite a perfectly good test existing. The same exact command is what `03`'s per-stage verifier and `01`'s re-verify re-run — one shared per-stage gate.

## Budget

This stage was **sized to aim for < 50K tokens** (est. ~{X}K). That target is informational — **do not stop, abort, or trim scope to stay under it**; run the stage to completion. On finishing, **report your actual token usage** for this stage (e.g. from `/cost`, or your best estimate if exact figures aren't available) so the sizing can be calibrated.

## Handoff

On completion: {what is now true in the repo}. Commit with `{type}: {summary}`. Stage {N+1} assumes this committed state.
{For the last stage: "Final stage — the PRD is fully implemented."}
```

## Guardrails

- **Each stage stands alone.** If running stage {N} would require knowing anything that isn't in the stage file or verifiable from the committed repo, the slice is wrong — restate the missing context in the file.
- **Specify intent, not source.** Stage files describe *what* to build, the target interfaces, and the acceptance criteria — they do not paste the final code. The implementing agent writes code against the real repo, which may have drifted from the plan's assumptions.
- **Declare file ownership.** Every stage lists the files it creates or modifies. Two stages must not own the same file in conflicting ways; if they genuinely must touch the same file, order them so the dependency is one-directional and say so.
- **Read-first, stop on conflict.** Each stage instructs its agent to verify preconditions against the actual repo before editing, and to halt and report rather than force a plan that no longer matches reality.
- **Aim under budget at planning time.** Estimate honestly with headroom and split any stage that *looks* likely to exceed ~50K tokens — but never bake a runtime cap into the stage file; the executing agent finishes its stage and reports actual usage.
- **Green between stages.** No stage may leave the build or tests broken for the next agent.
- **Executable acceptance for `test-coverable` FRs.** Every stage that completes a `test-coverable` FR (per the PRD classification) authors or extends that FR's test, lists the test file under "Files this stage owns", and records the FR's selector as an acceptance command the green gate actually runs. `inspection-only` FRs carry no such test. If the project has no harness, the Phase-1 waiver is recorded in place of a selector — never a silent gap.
- **The stage that completes an FR owns its test.** When a `test-coverable` FR spans stages (foundation early, observable behaviour later), the stage that completes its **observable behaviour** authors the acceptance test and records the selector — not the foundation stage.
- **Pin test assertions to PRD values, not implementation output.** A `test-coverable` FR's test must assert the **PRD's concrete acceptance values**, carried verbatim from the PRD's acceptance criteria — never an expected value lifted from whatever the implementation happens to produce. The implementing agent writes both the code and this test, so an assertion back-fitted to its own output lets a buggy implementation confirm itself and then sail through every downstream gate (the verifier re-*runs* the test but never re-*authors* it). Stating the expected values in the PRD and copying them into the stage is what gives the test something independent to check against. (If the PRD's acceptance criteria for an FR are too vague to yield concrete values, that is a spec gap to flag — the test has nothing independent to pin to.)
- **Propose before writing.** Never emit stage files until the user has approved the Phase 3 breakdown.
- **Don't implement.** This command plans only — it reads the codebase and writes plan files; it does not modify source.

## Commit

After writing the stage files, commit them (`.pmf/{slug}/plan-stage-*.md`) to git so the plan is captured alongside the PRD.
