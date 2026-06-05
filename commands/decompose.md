---
description: Decompose a PRD into an ordered set of self-contained plan-*-stage-{N}.md files, each runnable by a fresh agent (no shared context) within a ~50K-token budget. Use after /pmf:prd to turn a PRD into sequential implementation stages.
argument-hint: [path to the prd-*.md to decompose, defaults to the prd-*.md in the working directory]
allowed-tools: Bash(date:*), Bash(git:*), Read, Grep, Glob, AskUserQuestion, Write
---

# Decompose PRD

## Objective

Split a Product Requirements Document into **N ordered plan-stage files** — `plan-{ts}-{desc}-stage-{NN}.md`. Run in sequence by fresh agents, the stages fully implement the PRD. Every stage must be:

- **Self-contained** — it carries everything its agent needs; it never relies on another stage's conversation or memory.
- **Sequentially dependent only via the repo** — the only thing a stage inherits from earlier stages is the **committed repository state** they left behind, expressed as verifiable facts.
- **Repo-green on exit** — it compiles and its tests pass when done, so the next fresh agent starts from a known-good checkout.
- **Budget-targeted** — `/pmf:decompose` *sizes* each stage to aim for **under ~50K tokens** of execution (target ≤ ~40K for headroom). This is a planning goal for the split, not a limit the running agent must enforce — the agent runs the stage to completion and simply reports its actual token usage.

## Input

PRD path:

$ARGUMENTS

Resolve the PRD before doing anything else:

1. If the argument above is a non-empty path, use that file as the PRD.
2. Otherwise, glob `prd-*.md` in the current working directory and act on the count of matches:
   - **Zero matches** — nothing to decompose. Tell the user no `prd-*.md` was found and **terminate**.
   - **Exactly one match** — use it (state which file you picked).
   - **More than one match** — ask the user which PRD to use (list the candidates) and wait for their choice.
3. If a path is given but the file does not exist, say so and stop.

Confirm the resolved PRD path back to the user before proceeding.

## Process

Work through these phases. **Do not write any stage file until Phase 3 is approved by the user.**

### Phase 1 — Analyze the PRD and ground it in the code

1. Read the PRD in full. Extract every functional requirement (`FR-*`), technical constraint, non-goal, and acceptance criterion.
2. Ground it in reality with `Read`/`Grep`/`Glob`: locate the modules, files, and patterns each requirement touches, and the project's actual **build / test / lint commands** (from its `AGENTS.md` / `CLAUDE.md`). Respect existing module boundaries.
3. Build a dependency graph of the requirements: what must exist before what (shared models, ports/interfaces, schema, and DI wiring before the features that consume them; implementation before the integration that uses it).

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
- **Verification** — running the build/test/lint commands, plus a buffer for one or two iterations.
- **Overhead** — a safety buffer for reasoning and retries.

Rule of thumb: a stage should read on the order of **≤ ~8–10 files** and produce a **bounded diff (≈ ≤ ~300 net lines)**. If a slice would exceed the budget, **split it**. If two adjacent slices are trivially small and share context, consider **merging** them — but never merge across a dependency that balloons the result. **N is whatever the budget dictates**, not a number picked up front.

### Phase 3 — Propose the stage plan and confirm

Before writing anything, present the proposed decomposition:

- The stage count **N**.
- For each stage: a one-line title, the FRs/scope it covers, its key files, what prior repo state it depends on, and an estimated token budget.

Use `AskUserQuestion` (or ask plainly) to confirm or adjust. **Do not write stage files until the user approves the breakdown.**

### Phase 4 — Write the stage files

**Determine the timestamp and description slug.** If the PRD's name matches `prd-{YYYYMMDD-HHmmss}-{description}.md`, **reuse its `{YYYYMMDD-HHmmss}` and `{description}` verbatim** so the plans stay paired with their PRD (the normal case). Otherwise generate a fresh timestamp:

!`date +%Y%m%d-%H%M%S`

and derive a 1–4 word kebab-case `{description}` from the PRD title.

Write one file per stage to the **current working directory**, named exactly (zero-pad `N` to two digits so the files sort in execution order):

```
plan-{YYYYMMDD-HHmmss}-{description}-stage-{NN}.md
```

Each stage file MUST follow this structure, filled with concrete, project-specific detail (real paths, real commands):

```markdown
# Stage {N} of {M} — {stage title}

> Source PRD: `prd-{ts}-{desc}.md` — read it for full background.
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

The files this stage creates or modifies — its exclusive ownership for the duration. Be exhaustive and specific; the decomposition review uses this list to detect cross-stage conflicts.

- `{path}` — {created | modified} — {what changes}
- ...

## Tasks

> **Before changing anything:** read the files under "Context to load" and confirm every precondition above actually holds in the repo. **If a precondition is false, or the plan contradicts what the code now shows, STOP and report the conflict — do not work around it.** A stale plan must be revised (re-run `/pmf:decompose`, or fix the affected stage files), not forced; forcing it corrupts every stage that follows.

1. {Concrete, ordered step — describe the intent and the target interface/behaviour, not a paste of the final source. The implementing agent writes the actual code against the real repo.}
2. ...

## Acceptance criteria

- {Testable outcome.}
- Build is green: `{exact build command}`
- Tests pass: `{exact test command}`
- {Lint/format if the project requires it: `{exact command}`}

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
- **Propose before writing.** Never emit stage files until the user has approved the Phase 3 breakdown.
- **Don't implement.** This command plans only — it reads the codebase and writes plan files; it does not modify source.

## Commit

After writing the stage files, commit them (`plan-{YYYYMMDD-HHmmss}-{description}-stage-*.md`) to git so the plan is captured alongside the PRD.
