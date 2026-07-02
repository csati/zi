---
description: Locate code in the current repository from a natural-language description — return the exact file path, line, enclosing class/module, and symbol. Also recalls a previously-saved locate result by its short label. Use to be *pointed at* code, not to have it explained, edited, or rewritten.
argument-hint: [description of the code to find, or a saved label to recall]
allowed-tools: Bash(basename:*), Bash(mkdir:*), Bash(ls:*), Bash(date:*), Read, Grep, Glob, Task, Write
---

# locate

Turn a natural-language description into precise code pointers.

## Input

The description to locate (or a label to recall):

$ARGUMENTS

If the input above is empty, ask the user what they want located before doing anything else. Do not invent a query.

## When to use

The user describes some code (behavior, concept, partial symbol) and wants to know *where it lives*. They want coordinates, not an explanation or an edit.

Do **not** use this command when the user wants code changed, refactored, or explained in depth — only for lookups.

## Recall vs. locate

First decide whether the input is a **recall** of a saved reference rather than a new search. Treat it as a recall when the input is any of:

- an explicit verb + label: `recall jwt-validator`, `reopen jwt-validator`, `use jwt-validator`, `show jwt-validator`, `open jwt-validator`
- a bare token that looks like a label (matches `^[a-z][a-z0-9]*(-[a-z0-9]+)+$`) and matches an existing reference file

If it is a recall, jump to **Recall a reference** and run no searches. Otherwise perform a new locate (below) and then save it.

## Search strategy

Execute in order, stop as soon as you are confident:

1. **Extract candidates** from the description.
   - Nouns → likely class, file, or module names.
   - Verbs → likely function/method names.
   - Domain terms → likely keywords in identifiers or comments.
2. **Glob for filenames first** — cheapest and often decisive (e.g. `**/*AuthInterceptor*`).
3. **Grep for symbols** with `output_mode: "content"` and `-n` so line numbers come back inline. Apply `type:` filters when the language is obvious from the repo (e.g. `type: "kotlin"` in an Android module). Prefer anchored patterns like `class \w*Foo`, `fun \w*validate`, `def \w*reset`.
4. **Escalate to Explore** if more than ~3 Grep rounds have not narrowed the result. Delegate to the `Explore` subagent (via `Task`) with thoroughness `medium` and pass the original description verbatim.
5. **Confirm each candidate** by `Read`ing a small slice (±20 lines) around the hit to verify the semantic match and identify the enclosing class/module and function/method.

Never guess a path you have not verified with a tool. If unsure, say so.

## Output format

One block per match, ranked best-first. Omit fields that do not apply.

```
<file_path>:<line>
  class:  <ClassName or module>
  symbol: <function/method name>
  why:    <one short sentence on why this matches>
```

- If there is one clear winner, output just that block.
- If there are multiple plausible matches, list up to 5 and prefix the list with a single `best guess: <file>:<line>` line.
- If nothing is found, say so explicitly and list the patterns/globs you searched, so the user can refine their query.

Keep the response to the blocks above plus at most one sentence of context. No narration of intermediate searches.

## Save a reference

After producing the normal output for a *new* locate query (not a recall), persist it so the user can refer back to it later by a short label.

Steps:

1. **Pick a 2-word kebab slug** from the user's query that captures the intent — e.g. `the function that validates JWT tokens` → `jwt-validator`, `where Hilt modules are wired up` → `hilt-wiring`. Lowercase, `[a-z0-9-]` only, exactly two meaningful words when possible.
2. **Resolve the project slug** with `basename "$PWD"` (Bash). This scopes references per project.
3. **Ensure the directory exists**: `mkdir -p ~/.claude/locate-refs/<project-slug>`.
4. **Handle collisions by suffixing.** If `<label>.md` already exists, try `<label>-2.md`, `<label>-3.md`, … until you find a free name. Never overwrite — old references must be preserved.
5. **Write the file** with this exact shape:

   ```markdown
   ---
   label: <final-label>
   query: <the user's original description, verbatim>
   cwd: <absolute path of $PWD>
   created: <ISO-8601 UTC timestamp>
   ---

   <the exact pointer blocks you just printed to the user>
   ```

6. **Append one trailing line** to the user-facing response, on its own line after the blocks:

   ```
   saved as: <final-label>
   ```

   Nothing else. No explanation, no path.

Writing under `~/.claude/locate-refs/` is the **only** write this command is permitted to perform.

## Recall a reference

When the input is a recall (see **Recall vs. locate**), do **not** run any searches. Instead:

1. Compute `<project-slug>` as above.
2. Look for `~/.claude/locate-refs/<project-slug>/<label>.md`.
3. If not found there, glob `~/.claude/locate-refs/*/<label>.md`. If exactly one match, use it. If multiple, list the matching project slugs and ask which one.
4. If still nothing, say so and print `ls ~/.claude/locate-refs/<project-slug>/` (or a note that the project dir doesn't exist yet) so the user can see what labels are available.
5. On a hit, print:

   ```
   recalled: <label>
   query:    <stored query>

   <pointer blocks, verbatim from the file>
   ```

Do not re-verify the pointers unless the user explicitly asks for a refresh.

### Staleness

Recalled pointers are a snapshot from when the reference was saved. Files may have moved or been renamed since. If the user asks to refresh a recalled reference, re-run the locate using the stored `query:` field and write the new result to a **new** file with a suffixed label (per the collision rule). The old file is left alone.

## Constraints

- **Read-only for the target repository.** Never edit repo files, never run builds or tests, never modify repo state.
- The single write exception is creating/appending files under `~/.claude/locate-refs/` (and `mkdir -p` of that tree).
- Keep output terse — the user wants pointers, not prose.
- Do not fabricate line numbers; they must come from a real tool result.
