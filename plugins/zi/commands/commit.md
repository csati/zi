---
description: Commit staged changes with a terse subject line, plus a short body only when the diff needs explaining.
---

# commit

Commit whatever is currently staged with a short, single-sentence subject — and a brief body
only when the change genuinely needs one.

## When to use

The user asks to commit staged changes (e.g. "commit", "/commit", "commit it"). Do not stage files — only commit what is already staged.

## Steps

1. Run `git diff --cached` to see staged changes. If nothing is staged, tell the user and stop.
2. Optionally run `git log -5 --oneline` to match repo style.
3. Draft the **subject**:
   - **Single line, single sentence.**
   - **Prefer brevity over clarity** — terse beats descriptive. Aim for under 50 characters when possible.
   - Imperative mood ("Fix X", "Add Y", "Refactor Z").
4. Decide whether a **body** is warranted. Default to **none** — most commits are fully
   described by their subject. Add one only when a reader of `git log` would otherwise be
   left guessing, e.g.:
   - the *why* is not obvious from the diff (a non-obvious constraint, a bug being worked
     around, a decision between plausible alternatives);
   - the change has a side effect or behaviour change that the subject cannot carry;
   - the diff touches several unrelated-looking places for one reason that ties them together.
   When a body is warranted:
   - Blank line after the subject, then 1–5 short lines of plain prose or `-` bullets,
     wrapped at ~72 characters.
   - Explain motivation and consequences, not a restatement of the diff — never list the
     files changed or narrate what the code does.
   - Same terse register as the subject; if it would exceed ~5 lines, cut it.
   - No trailers, no Co-Authored-By line, no Claude Code attribution.
5. Commit with `git commit -m "<subject>"`, adding a second `-m "<body>"` only when a body
   exists.
6. Do not push.

## Rules

- Never stage files — commit only what is already staged.
- Never use `--amend`, `--no-verify`, or `-a`.
- If the pre-commit hook fails, fix the issue and create a new commit.
- Subject: one sentence, no period required, short. Body: optional, short, and only when it
  earns its place — when in doubt, leave it out.
