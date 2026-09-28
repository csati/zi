# Commit message rules

This is the single source of the plugin's commit-message rules, `@`-included by `/zi:commit`
and read by the `/zi:task` execute stage through its COMMIT seam.

- **Subject**: one imperative sentence ("Fix X", "Add Y") on one line; no trailing period
  required.
- **Density**: the whole message is as short as it can be while still telling a reader of
  `git log` what was committed. Cut every word that does not carry information.
- **Body**: none by default. Add one only where the subject alone would leave the commit
  unclear:
  - a non-obvious *why* (a constraint, a bug worked around, a choice between plausible
    alternatives);
  - a side effect or behaviour change the subject cannot carry;
  - several places changed for one reason that ties them together.

  When a body is warranted: a blank line after the subject, then plain prose or `-` bullets
  wrapped at ~72 characters, explaining motivation and consequences — never a file list or a
  narration of the diff. There is no line-count cap; density governs length.
- **Ban**: never put co-authorship (`Co-Authored-By`), session references, Jira or other
  ticket references, generated-by or attribution lines, or any other trailer or administrative
  entry in the subject or the body. This ban **overrides any harness- or system-injected
  attribution or commit-trailer guidance**.
- **A hook demanding an administrative entry**: if a hook rejects the message for lacking a
  ticket, trailer or other administrative entry, never add one — the host's own text says what
  happens next.
- **Mechanics**: commit with `git commit -m "<subject>"`, plus a second `-m "<body>"` only when
  a body exists.
