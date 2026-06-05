---
description: Verify a fully-implemented feature against its PRD end to end — every FR's acceptance criteria met, full build/test/lint green — and report the gaps. Run after the last /pmf:decompose stage is implemented.
argument-hint: [path to the prd-*.md to verify against, defaults to the prd-*.md in the working directory]
allowed-tools: Bash(date:*), Bash(git:*), Bash(./gradlew:*), Bash(bun:*), Bash(mise:*), Read, Grep, Glob, AskUserQuestion, Write
---

# Finalize — verify the feature against its PRD

## Objective

The per-stage green checks in `/pmf:decompose` prove each stage compiled and passed *in isolation*. This command proves the **whole feature** is done: every requirement in the PRD is actually implemented in the integrated codebase and the project is green end to end. It is the pipeline's acceptance gate — it **verifies and reports; it does not implement fixes.**

## Input

PRD path:

$ARGUMENTS

Resolve the PRD before doing anything else:

1. If the argument is a non-empty path to an existing file, use it.
2. Otherwise glob `prd-*.md` in the current working directory:
   - **Zero matches** — nothing to verify against. Tell the user no `prd-*.md` was found and **terminate**.
   - **Exactly one match** — use it (state which file you picked).
   - **More than one match** — list them and ask which feature to finalize; wait for the choice.
3. If a path is given but the file does not exist, say so and stop.

Confirm the resolved PRD path back to the user before proceeding.

## Process

### Phase 1 — Build the acceptance checklist

1. Read the PRD in full. Extract every `FR-*` with its acceptance criteria, every success metric, every technical constraint, and every non-goal.
2. If the paired `plan-{ts}-{desc}-stage-*.md` files exist (same slug), read them to see what each stage claimed to deliver — but treat that as a claim to verify, not as truth.
3. Discover the project's real **build / test / lint** commands from its `AGENTS.md` / `CLAUDE.md`.

### Phase 2 — Verify each requirement against the code

For every `FR-*`, ground the claim in reality with `Read`/`Grep`/`Glob`: find the code that satisfies it and judge whether its acceptance criteria are *actually* met. Mark each **met / partial / missing**, each with evidence — a `file:line` for "met", the specific absence for "missing". Do not take the plan's or the PRD's word for it; confirm against the committed code.

Also check the non-goals were respected (no out-of-scope scope crept in) and the technical constraints were honoured.

### Phase 3 — Run the suite

Run the full build, the full test suite, and the lint/format check. Capture pass/fail and the relevant output for anything that fails. Ask before running anything long-running or destructive the user might not expect.

### Phase 4 — Report

Give the user a concise verdict:

- A per-FR table: **met / partial / missing**, with evidence.
- Build / test / lint results.
- A prioritized **gap list** — what's missing or broken, each tied to its FR and the file.
- A clear bottom line: **is the PRD fully satisfied, yes or no.**

For each gap, recommend the route and **confirm with the user before any code changes** — do not silently start fixing:

- a small fix here and now,
- a new stage appended to the decomposition, or
- a revision back up the pipeline (`/pmf:prd` → `/pmf:doublecheck` → `/pmf:decompose`) when the gap is a spec problem, not a coding one.

Optionally, if the user wants a durable record, write the report to `finalize-{ts}-{desc}.md` (reuse the PRD's `{ts}-{desc}` slug). Get the timestamp with:

!`date +%Y-%m-%d`

## Guardrails

- **Verify against reality** — every "met" points at real code; every "missing" at a real absence. No taking claims on trust.
- **Report, don't fix** — this is the acceptance gate. Surface gaps, recommend a route, and let the user choose before any code changes.
- **Whole-feature scope** — you are checking the integrated result and cross-stage interactions, not re-running per-stage checks.
