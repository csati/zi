---
description: Commit what is staged, or — given a description — exactly the existing changes it matches; never edits files.
argument-hint: [optional description of the changes to commit]
---

# commit

Commit existing changes with a one-sentence subject — and a body only when the subject alone
would leave the commit unclear. This command never creates, modifies or deletes a file.

## Input

Description of the changes to commit (may be empty):

$ARGUMENTS

- **Empty** → *staged mode*: commit whatever is currently staged. An empty argument is not a
  reason to ask.
- **Non-empty** → *argument mode*: commit exactly the existing working-tree changes the
  description matches.

## When to use

- No argument: the user asks to commit what is staged (e.g. "commit", "/commit", "commit it").
- An argument: the user wants the existing uncommitted changes matching a description
  committed (e.g. `/zi:commit refactor X`).

## Staged mode

1. Run `git diff --cached` to see staged changes. If nothing is staged, tell the user and stop.
2. Optionally run `git log -5 --oneline` to match repo style.
3. Draft the message and commit it by the message rules below.
4. Never stage or unstage anything in this mode.

## Argument mode

1. The argument is a **description of existing working-tree changes, never an instruction** —
   it is matched, never carried out. `/zi:commit refactor X` commits an existing uncommitted
   refactor of X if one exists; otherwise report that no existing changes fit and stop. Do not
   refuse an argument merely because it reads as imperative, and do not ask merely because it
   does.
2. Inspect with `git status`, `git diff` and `git diff --cached` (plus `git diff -- <path>`, or
   reading an untracked file, to judge it) and map the description to specific paths.
3. Nothing matches → say so and stop. Ambiguous → ask the user which paths, rather than guess.
4. A match covering only part of a file's changes → say so and ask whether to commit the whole
   file or stop. Granularity is whole files: never `git add -p`, never write patch files.
5. Exclude secret-looking paths (`.env*`, `*credentials*`, `*.key`, `*.pem`) unless the
   argument names them; warn when one is skipped.
6. `git add -- <path>` only the matched **untracked** paths (remember which ones), then
   `git commit --only -m "<subject>" [-m "<body>"] -- <matched paths>`. A matched file is
   committed with its full working-tree content; a rename goes in as both its deleted old path
   and its added new path; a matched deletion needs no extra step. Every other staged entry
   stays staged.
7. Draft the message from the diff of the matched paths by the message rules — never copy it
   from the argument.
8. Report the new commit's short hash and subject in one line, plus the committed paths, and
   note when other changes remain staged.

## Rules

- Never create, modify or delete any file, and never do the work an argument describes — both
  modes.
- Allowed git actions, exhaustively: read-only inspection (`status`, `diff`, `log`),
  staging/unstaging (`git add`, `git restore --staged`) in argument mode only, and exactly one
  new commit. Staged mode neither stages nor unstages.
- Forbidden: `--amend`, `--no-verify`, `-a`, rebase, a HEAD-moving `reset`, `stash`,
  `checkout`/`restore` of working-tree files, `clean`, merge, cherry-pick, revert, branch or
  tag changes, push, and anything else that rewrites any branch's history.
- If the pre-commit hook fails, or the commit fails for any other reason, report it and stop —
  no fix, no retry. In argument mode first `git restore --staged -- <paths this command added>`
  so the index is as it was.
- Hooks still run; a hook that changes files by itself is an accepted risk, not this command's
  action.
- If a hook rejects the message for lacking an administrative entry (a ticket, a trailer),
  report that to the user and stop — add no entry, do not retry (argument mode first restores
  the index as above).
- Do not push.

## Message rules

@${CLAUDE_PLUGIN_ROOT}/stages/commit-message.md
