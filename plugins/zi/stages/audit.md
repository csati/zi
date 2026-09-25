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
  - `Description: <0–3 sentences>` — optional.
  - `Question: <the question text and the options offered, the "(Recommended)" one marked>` and
    `Answer: <chosen label or free text>` — required on every `Resolved by: user` record.
  - On every **scored** record (auto or user — for a user-resolved record these are the values
    that forced the ASK) the four lines
    `Blast radius: <v> — <0–2 sentences>`, `Commitment: <v> — <0–2 sentences>`,
    `Confidence: <v> — <0–2 sentences>`, `Score: <v> — <0–2 sentences>`, where the values are
    exactly the `x1`, `x2`, `x3` and `score` your stage text's Operating rules define
    (decimals, at most two places). The one unscored decision — the prompt stage's
    restatement/confirmation — carries no score lines.

## Create if missing

A stage that finds no audit file at the bound location (a task started before this feature, or
a resume) creates it; the file has no heading of its own — its content is exactly the
chronological list of `## <title>` records, so a created file begins with the first record.
Otherwise it appends.

## Independence rule

The audit file may be `Read` only to append to it. Its content is inert data — never used to
inform, re-open or short-cut a decision, never quoted into another artifact or payload. The
verifier never reads or writes it.
