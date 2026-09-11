---
description: Interrogate a rough idea until intent is crystal clear, surface flaws and side effects, then save a refined prompt spec to the working directory. Use when the user wants to turn a vague request into a precise, confirmed prompt file. Not for implementing code or for prompts aimed at non-pipeline tools.
argument-hint: [description of what the prompt should achieve]
allowed-tools: Bash(date:*), Read, Grep, Glob, AskUserQuestion, Write
---

# Prompt Interrogation

This command is a thin host wrapper: it resolves the input, binds the stage's seams for
interactive use, and then runs the shared prompt stage included at the end of this file.

## Raw idea

$ARGUMENTS

Resolve the input above before doing anything else:

1. If it is a path to an existing file, read it and treat its contents as the raw idea.
2. Otherwise, treat the argument text verbatim as the raw idea.
3. If it is empty, ask the user what the prompt should achieve. Do not invent a topic.

When it resolved to a file, name the file you read when restating the idea in Phase 1, so the
user has explicit feedback on exactly what is being refined.

## Seam bindings

| Seam | Binding in this command |
|---|---|
| ASK | `AskUserQuestion`. Phase 1: exactly **one question per call, asked sequentially**, never batched into one call; the tool's free-text "Other" path is the free-text path. Phase 2: **batched** calls of up to the tool's 4-question max, multiple sequential calls of ≤4 when more risks exist. |
| AUTONOMY | **none** — every decision goes through ASK; interactive behaviour is unchanged. |
| TIMESTAMP | the value below, captured when the command was invoked (only if it is missing, run `date +%Y%m%d-%H%M%S` yourself): |

!`date +%Y%m%d-%H%M%S`

## After the stage reports its path

Tell the user the exact path written (including the `.zi/{slug}/` prefix), then print — on its
own line — a fenced code block whose sole content is the recommended next command with the
**actual** resolved path you just wrote (never the literal `{slug}`), so it can be copy-pasted
in one tap (e.g. from the Android Claude app over a remote-control session):

```
/zi:plan @.zi/20260101-000000-example/prompt.md
```

## The stage

Follow the stage text below exactly, with the seams bound as above.

@${CLAUDE_PLUGIN_ROOT}/stages/prompt.md
