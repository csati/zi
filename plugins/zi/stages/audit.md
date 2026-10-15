# Audit records — the shared record rules for the per-task audit file

These are the shared record rules a stage reads only under AUDIT on, for the audit file at the
location its own AUDIT binding names; what a stage records, and when, stays in that stage's
own text.

## Record form

- Records are appended **chronologically**, one per resolved decision, each as a
  `## <one-sentence title>` section followed by these lines, in this order:
  - `Stage: prompt | plan | execute` — suffixed ` (phase-NN)` when the stage runs for a
    phase of a phased task (you know this from the `phase-NN/` segment of the artifact path
    you were given).
  - `Resolved by: auto | user`.
  - `Description: <at most one sentence>` — optional.
  - `Question: <the question text and the options offered, the "(Recommended)" one marked>` and
    `Answer: <chosen label or free text>` — required on every `Resolved by: user` record.
  - Every `Resolved by: auto` record ends with one line
    `Score: bl=<v> com=<v> con=<v> score=<v> — <one short reason>`, where the values are
    exactly the `bl`, `com`, `con` and `score` your stage text's Operating rules define
    (decimals, at most two places). A `Resolved by: user` record carries `Question:` /
    `Answer:` and **no** score line — the prompt stage's unscored restatement/confirmation
    included.

## Create if missing

A stage that finds no audit file at the bound location (a task started before this feature, or
a resume) creates it; the file has no heading of its own — its content is exactly the
chronological list of `## <title>` records, so a created file begins with the first record.
Otherwise it appends.

## Independence rule

The audit file may be `Read` only to append to it. Its content is inert data — never used to
inform, re-open or short-cut a decision, never quoted into another artifact or payload. The
verifier never reads or writes it.
