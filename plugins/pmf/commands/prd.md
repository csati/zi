---
description: Generate a Product Requirements Document (PRD) from a research brief. Use when the user wants to create a PRD, write requirements, or plan a feature from a brief.
argument-hint: [path to research brief or its task directory, defaults to the lone brief.md under .pmf/]
allowed-tools: Bash(date:*), Bash(git:*), Read, Grep, Glob, AskUserQuestion, Write
---

# Create PRD

## Objective

Generate a Product Requirements Document (PRD) from a research brief. The PRD must be specific, actionable, and granular enough for direct decomposition into independently-runnable implementation stages. Get there through dialogue: interrogate the brief, surface gaps and flaws, and **resolve or confirm every open decision and detected flaw with the user before writing the PRD.**

## Input

Research brief path:

$ARGUMENTS

Resolve the brief before doing anything else:

1. If the argument is a non-empty path to an existing file, use that file as the brief. If it points to a task directory (`.pmf/{slug}/`, or a bare `{slug}`), use the `brief.md` inside it.
2. Otherwise, glob `.pmf/*/brief.md` (the output of the explore phase) and act on the count of matches:
   - **Zero matches** — there is nothing to work from. Tell the user no `brief.md` was found under any `.pmf/` task directory and **terminate** without producing a PRD.
   - **Exactly one match** — use it as the brief.
   - **More than one match** — ask the user which brief to use (list the candidate task directories) and wait for their choice before continuing.

## Process

Work through these phases. **Do not write the PRD until Phase 3's conditions are met.**

### Phase 1 — Analyze & interrogate

1. **Analyze the brief** — extract key constraints, risks, and recommendations.
2. Ground your understanding in reality: use `Read`/`Grep`/`Glob` (follow the paths the brief references) to check what actually exists before deciding requirements, so questions are specific rather than generic.
3. Ask focused clarifying questions — one cluster at a time, not a wall of 20. Prefer `AskUserQuestion` for choices with discrete options; ask conversationally otherwise.
4. Keep interrogating until the goals, scope, requirements, and success criteria are unambiguous. Each requirement must be testable — do not leave vague language like "should be fast"; pin it to something verification can check (e.g. "p99 latency under 200ms").

### Phase 2 — Surface flaws & resolve

Before producing anything, explicitly raise:

- **Critical gaps** — essential information the brief never settled.
- **Ambiguities** that could be interpreted multiple ways.
- **Possible flaws** in the approach or scope as currently framed.
- **Undesired side effects** — breaking changes, scope creep, security/privacy concerns, cost.
- **Hidden assumptions** the plan depends on.

Present these plainly and **wait for the user to confirm or resolve each one**. Every decision the PRD depends on must be settled by the user, not assumed by you. Do not proceed past unresolved warnings.

### Phase 3 — Write the PRD

Only once **both** are true:

- Goals, scope, and requirements are clear and confirmed, **and**
- Every gap, flaw, and decision you raised has been acknowledged or resolved by the user.

Then assemble the PRD from the confirmed decisions:

1. **Define goals** — 3-5 measurable objectives (SMART format preferred).
2. **Write requirements** — each with acceptance criteria that verification can check.
3. **Identify non-goals** — explicitly state what is out of scope.
4. **Define user impact** — who benefits and how.
5. **List assumptions** — what must be true for the plan to work.

Fold the resolutions from Phase 2 into the relevant sections, then write the file as described in **Output** below.

## Output

The PRD is written as `prd.md` inside the brief's task directory.

1. **Determine the task directory.** Write the PRD as a sibling of the brief — in the same `.pmf/{slug}/` directory the brief lives in — so it stays paired with the brief it came from (the normal case). Only if the brief was passed by a custom path outside `.pmf/` do you create a fresh task directory:

   - **Timestamp** — use the current system time:

     !`date +%Y%m%d-%H%M%S`

     Use the value produced by the command above (run it yourself at write time if the embedded value looks stale).

   - **Description** — derive a **1–4 word** kebab-case slug that identifies the feature (e.g. `auth-token-refresh`, `csv-export`).

   - Create `.pmf/{YYYYMMDD-HHmmss}-{description}/` if it does not yet exist.

2. Write the file named exactly:

   ```
   .pmf/{slug}/prd.md
   ```

Use this structure:

```markdown
## Overview

{Brief feature description and primary goal}

## Problem Statement

{The core problem, why existing approaches fail, business impact}

## Goals

{Numbered list with success criteria}

## Non-Goals

{What is explicitly out of scope}

## Requirements

### FR-1: {title}

{Description}

- Acceptance: {testable criteria}

### FR-2: {title}

...

## Technical Constraints

{Stack, allowed libraries, deployment target, explicit prohibitions}

## Assumptions

{What must be true}

## Success Metrics

{Quantitative metrics for post-launch validation}
```

## Guardrails

- Never write the PRD early or "just in case." Premature output defeats the purpose of the interrogation.
- Resolve decisions with the user — do not silently pick an interpretation and bake it into the PRD.

## Commit & next step

Commit the PRD file you just wrote (`.pmf/{slug}/prd.md`) to git. The natural next step is `/pmf:decompose`, which splits this PRD into ordered, independently-runnable `.pmf/{slug}/plan-stage-{NN}.md` files — one per implementation stage, each runnable by a fresh agent within a ~50K-token budget.
