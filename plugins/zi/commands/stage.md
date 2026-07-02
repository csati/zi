---
description: Stage files for commit based on a natural-language description.
argument-hint: [description of what to stage]
---

# stage

Stage files for commit based on the user's natural-language description.

## Input

What to stage:

$ARGUMENTS

If the input above is empty, ask the user what they want staged before continuing.

## Steps

1. Run `git status` to see what is modified/untracked.
2. Interpret the argument:
   - **"everything" / "all"** → `git add -A` is acceptable here (the user explicitly asked for all).
   - **File-type descriptions** (e.g. "kotlin files", "ts files", "markdown") → stage matching paths only, e.g. `git add '*.kt'` or specific paths from `git status`.
   - **Path-like descriptions** (e.g. "backend changes", "the auth stuff") → map to specific paths from `git status` output and stage those by name.
   - **Ambiguous** → ask the user to clarify rather than guessing.
3. Prefer staging specific files by name over broad globs, to avoid accidentally including secrets (`.env`, credentials, etc.). Skip obvious-secret files and warn the user if they match.
4. Run `git status` again and report what is now staged in one short line.

## Rules

- Do not commit — this command only stages.
- Do not stage files that look like secrets (`.env*`, `*credentials*`, `*.key`, `*.pem`) unless the user explicitly named them.
- If the description matches nothing, say so and stop.
