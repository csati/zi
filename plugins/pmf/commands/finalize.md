---
description: Verify a fully-implemented feature against its PRD end to end — every FR's acceptance criteria met, full build/test/lint green — and report the gaps. Run after the last /pmf:decompose stage is implemented.
argument-hint: [path to the prd.md to verify against, or its task directory; defaults to the lone prd.md under .pmf/]
allowed-tools: Bash, Read, Grep, Glob, AskUserQuestion, Write
---

# Finalize — verify the feature against its PRD

## Objective

The per-stage green checks in `/pmf:decompose` prove each stage compiled and passed *in isolation*. This command proves the **whole feature** is done: every requirement in the PRD is actually implemented in the integrated codebase and the project is green end to end. It is the pipeline's acceptance gate — it **verifies and reports; it does not implement fixes.**

## Input

PRD path:

$ARGUMENTS

Resolve the PRD before doing anything else:

1. If the argument is a non-empty path to an existing file, use it. If it points to a task directory (`.pmf/{slug}/`, or a bare `{slug}`), use the `prd.md` inside it.
2. Otherwise glob `.pmf/*/prd.md`:
   - **Zero matches** — nothing to verify against. Tell the user no `prd.md` was found under any `.pmf/` task directory and **terminate**.
   - **Exactly one match** — use it (state which file you picked).
   - **More than one match** — list the candidate task directories and ask which feature to finalize; wait for the choice.
3. If a path is given but the file does not exist, say so and stop.

Confirm the resolved PRD path back to the user before proceeding.

## Process

### Phase 1 — Build the acceptance checklist

1. Read the PRD in full. Extract every `FR-*` with its acceptance criteria and its **`test-coverable` / `inspection-only` classification**, every success metric, every technical constraint, and every non-goal.
2. If the paired `.pmf/{slug}/plan-stage-*.md` files exist (same task directory), read them to see what each stage claimed to deliver — but treat that as a claim to verify, not as truth. For each `test-coverable` FR, extract the **test selector** the stage recorded (the exact command that runs that FR's test), and note any persisted **test waiver** (which FRs it covers).
3. Discover the project's real **build / test / lint** commands from its `AGENTS.md` / `CLAUDE.md`.

### Phase 2 — Verify each requirement against the code

For every `FR-*`, establish whether its acceptance criteria are *actually* met **and record how you verified it**:

- **`test-coverable` FR** — **run the FR's recorded test selector** (the exact command captured in its stage file) and capture pass/fail and the relevant output. The selector passing is the evidence for "met"; a failure is "partial"/"missing"; a selector that resolves to no test is "missing". This is **execution, not inspection** — do not substitute reading the code for running the test. **Then sanity-check the test's intent:** read the selector's assertions and judge whether they assert the **PRD's concrete acceptance values** or merely **restate the implementation**. The same agent authored both the code and this test, so a "met" can rest on a **tautological/self-confirming test** — one whose expected values look lifted from the implementation rather than the PRD — which a green run does *not* actually prove. **Flag any such FR.** This is a static read, not proof the test is wrong; flag only the obvious cases.
- **`inspection-only` FR (and any FR under a recorded waiver)** — there is no executable assertion by design, so verify by reading the code/artifact with `Read`/`Grep`/`Glob` and judging the criteria. **Say so explicitly** in the report: this FR was established by inspection (or waiver), not by a test.

Mark each **met / partial / missing**, each with evidence — the selector's result for `test-coverable`, a `file:line` (or the specific absence) for `inspection-only`. Do not take the plan's or the PRD's word for it; confirm against the committed code.

Also check the non-goals were respected (no out-of-scope scope crept in) and the technical constraints were honoured.

### Phase 3 — Run the suite

Run the full build, the full test suite, and the lint/format check. Capture pass/fail and the relevant output for anything that fails. Ask before running anything long-running or destructive the user might not expect.

### Phase 4 — Report

Give the user a concise verdict:

- A per-FR table: **met / partial / missing**, **how it was verified** (test selector executed vs inspection/waiver), and the evidence (the selector and its result, or a `file:line`). Any "met" claimed by inspection rather than a test must be visibly flagged as such. Any `test-coverable` "met" you flagged as **tautological/self-confirming** must be visibly flagged too — a green test that merely restates the implementation is not proof the FR is met.
- Build / test / lint results.
- A prioritized **gap list** — what's missing or broken, each tied to its FR and the file.
- A clear bottom line: **is the PRD fully satisfied, yes or no.**

For each gap, recommend the route and **confirm with the user before any code changes** — do not silently start fixing:

- a small fix here and now,
- a new stage appended to the decomposition, or
- a revision back up the pipeline (`/pmf:prd` → `/pmf:doublecheck` → `/pmf:decompose`) when the gap is a spec problem, not a coding one.

Optionally, if the user wants a durable record, write the report to `.pmf/{slug}/finalize.md` (the PRD's task directory). Get the timestamp with:

!`date +%Y-%m-%d`

## Guardrails

- **Verify against reality** — every "met" points at real code; every "missing" at a real absence. No taking claims on trust.
- **Execute, don't inspect, where a test exists** — a `test-coverable` FR is "met" only by running its recorded selector green. Reading the code stands in for a test **only** for `inspection-only` and waived FRs, and is flagged as such in the report.
- **A green test isn't always proof** — for `test-coverable` FRs, sanity-check that the selector asserts the PRD's acceptance values, not the implementation, and flag a self-confirming test even when it passes. This is a static read that catches only the obvious cases; it cannot prove a test encodes the right intent.
- **Report, don't fix** — this is the acceptance gate. Surface gaps, recommend a route, and let the user choose before any code changes.
- **Whole-feature scope** — you are checking the integrated result and cross-stage interactions, not re-running per-stage checks.
- **Why `Bash` is unscoped here** — alone among the commands this declares bare `Bash`, because it must run an arbitrary project's *unknowable* build/test/lint suite, which cannot be pre-scoped the way `Bash(git:*)`/`Bash(date:*)` can elsewhere. The breadth is intentional, and what keeps it safe is the **report-don't-fix** guardrail above, not the tool scope: this command reads and verifies only and never commits.
