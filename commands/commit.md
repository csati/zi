---
description: Commit staged changes with a terse single-line commit message.
---

# commit

Commit whatever is currently staged with a short, single-sentence commit message.

## When to use

The user asks to commit staged changes (e.g. "commit", "/commit", "commit it"). Do not stage files — only commit what is already staged.

## Steps

1. Run `git diff --cached` to see staged changes. If nothing is staged, tell the user and stop.
2. Optionally run `git log -5 --oneline` to match repo style.
3. Draft a commit message:
   - **Single line, single sentence.**
   - **Prefer brevity over clarity** — terse beats descriptive. Aim for under 50 characters when possible.
   - Imperative mood ("Fix X", "Add Y", "Refactor Z").
   - No body, no trailers, no Co-Authored-By line, no Claude Code attribution.
4. Commit with `git commit -m "<message>"`.
5. Do not push.

## Rules

- Never stage files — commit only what is already staged.
- Never use `--amend`, `--no-verify`, or `-a`.
- If the pre-commit hook fails, fix the issue and create a new commit.
- One sentence. No period required. Short.
