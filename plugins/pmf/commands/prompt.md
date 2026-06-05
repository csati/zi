---
description: Interrogate a rough idea until intent is crystal clear, surface flaws and side effects, then save a refined prompt spec to the working directory. Use when the user wants to turn a vague request into a precise, confirmed prompt file.
argument-hint: [short description of what the prompt should achieve]
allowed-tools: Bash(date:*), Read, Grep, Glob, AskUserQuestion, Write
---

# Prompt Interrogation

## Objective

Take the user's rough idea and refine it through dialogue until you understand **exactly** what they intend. Then persist a concise, refined prompt specification into a per-task directory under `.pmf/` in the current working directory so it can be fed to a future agent or session.

## Raw idea

$ARGUMENTS

If the input above is empty, ask the user what the prompt should achieve before doing anything else. Do not invent a topic.

## Process

Work through these phases. **Do not write the output file until Phase 3's conditions are met.**

### Phase 1 — Understand & interrogate

1. Restate the idea in your own words so the user can confirm you parsed it correctly.
2. Ask focused clarifying questions — one cluster at a time, not a wall of 20. Prefer `AskUserQuestion` for choices with discrete options; ask conversationally otherwise.
3. Ground your questions in reality: if the idea touches this codebase, use `Read`/`Grep`/`Glob` to check what actually exists before asking, so questions are specific rather than generic.
4. Keep going until the goal, scope, inputs, outputs, and success criteria are unambiguous.

### Phase 2 — Surface flaws & risks

Before producing anything, explicitly raise:

- **Ambiguities** that could be interpreted multiple ways.
- **Possible flaws** in the approach as described.
- **Undesired side effects** — data loss, breaking changes, scope creep, security/privacy concerns, cost.
- **Hidden assumptions** the user may not realize they're making.

Present these plainly and **wait for the user to confirm or resolve each warning**. Do not proceed past unresolved warnings.

### Phase 3 — Generate the refined prompt file

Only once **both** are true:

- The user's intention is clear and confirmed, **and**
- Every warning you raised has been acknowledged or resolved by the user.

Then:

1. Get the current system time for the task-directory name:

   !`date +%Y%m%d-%H%M%S`

   Use the value produced by the command above (run it yourself at write time if the embedded value looks stale).

2. Derive a **1–4 word** kebab-case `description` slug that identifies the problem (e.g. `auth-token-refresh`, `csv-export`).

3. This command starts the task, so it **creates the task directory**: `.pmf/{YYYYMMDD-HHmmss}-{description}/` in the current working directory (create `.pmf/` and the task directory if they do not yet exist). Every later phase writes its artifact as a sibling inside this same directory. Write the prompt file named exactly:

   ```
   .pmf/{YYYYMMDD-HHmmss}-{description}/prompt.md
   ```

## Output file contents

A tight, self-contained refined prompt:

- **A few sentences — keep it under 20 sentences total.**
- Capture the confirmed intent, the key constraints/decisions, and what is explicitly out of scope.
- Fold in the resolutions to the warnings from Phase 2 (e.g. "must not modify existing rows").
- Write it as an instruction a future agent could act on directly — plain prose, no filler, no restating this process.

A short top heading naming the problem is fine; it does not count toward the sentence budget.

## Guardrails

- This command **clarifies and specifies** — it does not implement, edit code, or run anything beyond read-only exploration and writing the single output file.
- Never write the file early or "just in case." Premature output defeats the purpose.
- After writing, tell the user the exact path you created (including the `.pmf/{slug}/` prefix).
