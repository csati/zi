---
description: Commit staged changes with a one-sentence subject, plus a body only when the subject alone would leave the commit unclear.
---

# commit

Commit whatever is currently staged with a one-sentence subject — and a body only when the
subject alone would leave the commit unclear.

## When to use

The user asks to commit staged changes (e.g. "commit", "/commit", "commit it"). Do not stage files — only commit what is already staged.

## Steps

1. Run `git diff --cached` to see staged changes. If nothing is staged, tell the user and stop.
2. Optionally run `git log -5 --oneline` to match repo style.
3. Draft the message and commit it by the message rules below.
4. Do not push.

## Rules

- Never stage files — commit only what is already staged.
- Never use `--amend`, `--no-verify`, or `-a`.
- If the pre-commit hook fails, fix the issue and create a new commit.
- If a hook rejects the message for lacking an administrative entry (a ticket, a trailer),
  report that to the user and stop — add no entry, do not retry.

## Message rules

@${CLAUDE_PLUGIN_ROOT}/stages/commit-message.md
