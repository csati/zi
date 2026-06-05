---
description: Explore the problem space and codebase to produce a synthesized research brief for planning agents.
argument-hint: [prompt file name/path/reference, or the problem statement text itself]
allowed-tools: Bash(date:*), Read, Grep, Glob, AskUserQuestion, Write, Task, WebFetch, WebSearch
---

# Research Brief

## Objective

Explore the problem space and codebase to produce a synthesized research brief that planning agents can act on without re-reading the codebase. Get there through dialogue: interrogate the idea, ground it in the actual code, and **resolve or confirm every open decision and detected flaw with the user before writing the brief.**

## Input

The argument may be **either** of the following — resolve it before doing anything else:

- **A prompt file** — a file name, path, or reference (e.g. `docs/prompts/foo.md`, `@some/spec.md`, or a bare filename). If the argument resolves to a file that exists, read it and treat its contents as the prompt.
- **The problem statement text itself** — inline prose describing what to research.

Raw argument:

$ARGUMENTS

Resolution rules:

1. If the argument looks like a file name/path/reference and that file exists, read it and use its contents as the prompt.
2. Otherwise, treat the argument text verbatim as the prompt.
3. If the argument is empty, ask the user what they want researched before continuing.

## Process

Work through these phases. **Do not write the brief until Phase 4's conditions are met.**

### Phase 1 — Confirm & interrogate

1. **Confirm the prompt** — display the resolved prompt text back to the user so they have explicit confirmation feedback of exactly what this command is about to process. If it came from a file, note the resolved file path as well.
2. Restate the problem in your own words so the user can confirm you parsed it correctly.
3. Ask focused clarifying questions — one cluster at a time, not a wall of 20. Prefer `AskUserQuestion` for choices with discrete options; ask conversationally otherwise.
4. Keep interrogating until the goal, scope, and success criteria are unambiguous and you and the user share a common understanding of what is being asked. Do not move on while material questions remain open.

### Phase 2 — Explore & analyze

Ground everything in reality before drawing conclusions:

1. **Explore the codebase** — find relevant files, modules, and patterns.
2. **Map dependencies** — identify what existing code, services, or infrastructure the solution touches.
3. **Identify constraints** — note technical limitations, API contracts, performance requirements.
4. **Find prior art** — check if similar problems have been solved elsewhere in the codebase.

Synthesize findings into structured analysis. Do NOT dump raw tool output.

### Phase 3 — Surface flaws & resolve

Before producing anything, explicitly raise:

- **Ambiguities** that could be interpreted multiple ways.
- **Possible flaws** in the approach as the problem is currently framed.
- **Risks & unknowns** — potential breaking changes, areas of high complexity, the chance of introducing new bugs.
- **Hidden assumptions** the user may not realize they're making.

Present these plainly and **wait for the user to confirm or resolve each one**. Every decision the analysis depends on must be settled by the user, not assumed by you. Do not proceed past unresolved warnings.

### Phase 4 — Generate the brief

Only once **both** are true:

- The problem and scope are clear and confirmed, **and**
- Every flaw, risk, and decision you raised has been acknowledged or resolved by the user.

Then write the brief as described in **Output** below.

## Output

Write the brief to the **current working directory** (not a subfolder).

1. **Determine the timestamp and description.** If the prompt came from a file whose name already embeds them — i.e. it matches `{prefix}-{YYYYMMDD-HHmmss}-{description}.md` (for example a `prompt-20260605-143000-csv-export.md` produced by `/pmf:prompt`) — **reuse that file's `{YYYYMMDD-HHmmss}` timestamp and `{description}` slug verbatim** so the brief stays paired with its source. Otherwise (an inline problem statement, or a file name that does not match the pattern), generate them fresh as below:

   - **Timestamp** — use the current system time:

     !`date +%Y%m%d-%H%M%S`

     Use the value produced by the command above (run it yourself at write time if the embedded value looks stale).

   - **Description** — derive a **1–4 word** kebab-case slug that identifies the problem (e.g. `auth-token-refresh`, `csv-export`).

2. Write the file named exactly:

   ```
   brief-{YYYYMMDD-HHmmss}-{description}.md
   ```

Use this structure:

```markdown
## Problem Analysis

{What is being asked and why it matters}

## Relevant Codebase Areas

{Key files, modules, and their roles — reference specific paths}

## Dependencies & Constraints

{What the solution must work with or around}

## Risks & Unknowns

{What could go wrong, what needs further investigation}

## Recommendations

{Suggested approach direction based on findings}
```

## Guardrails

- Never write the brief early or "just in case." Premature output defeats the purpose of the interrogation.
- Resolve decisions with the user — do not silently pick an interpretation and bake it into the brief.
- After writing, tell the user the exact filename you created.
