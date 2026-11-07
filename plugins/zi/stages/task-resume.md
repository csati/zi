# `/zi:task` — resume shape

The `/zi:task` orchestrator reads this file only on a `.zi/{slug}` argument (Argument rule 2),
flat or phased, before the pre-print; it is never passed to a subagent.

### Resume shape

On a `.zi/{slug}` argument (Argument rule 2) the **first** print happens **before the first
spawn**, with rows pre-marked `[x]` from what `Glob` already found — the same `Glob` the resume
rules already run, no reads under `.zi/`:

- `prompt.md` → `prompt`; `plan.draft.md` → `plan (create)`; `findings.md` → `verify`;
  `plan.md` → `plan (create)`, `verify` and `plan (update)` (a persisted plan implies the
  earlier rows; a row whose own artifact is gone carries the implying artifact's path, i.e.
  `plan.md`). The hash is **not** read from a `commit` marker (you never read it back), so by
  the same implying-artifact rule a pre-marked phase row carries the marker path:
  `- [x] phase <N>/<M> → .zi/{slug}/phase-NN/commit`. No word outside the vocabulary (paths,
  hashes, `failed`) is ever introduced.
- Flat `commit` (`.zi/{slug}/commit`) → every flat row `[x]`. A row whose own artifact is
  present carries that artifact's path as above, and the implying-artifact rule still governs
  the plan rows (`plan (create)`, `verify`, `plan (update)` → `plan.md` when it exists);
  the marker path `.zi/{slug}/commit` goes only on rows with no other implying artifact —
  always `execute` and `commit`, plus any earlier row whose artifacts are all gone (the hash is
  never read back). The checklist is printed once, followed by the task-complete report; no
  spawn.
- Under `MANUAL = on` the `Execution: manual` line precedes this pre-print.
- Rows are pre-marked by presence only. A re-verify resume (lone `plan.draft.md`, possibly a
  stale `findings.md`) pre-marks `verify` `[x]` if `findings.md` exists and flips it back to
  `[>]` on the verifier spawn print — the latest transition always wins.
- On a **phased** resume (the phased shape in `task-phased.md`) the pre-print shows only the
  phase the phased resume picked (lowest-numbered without `commit`), already as
  `[>] phase <N>/<M>`, expanded, with its inner stage rows pre-marked by presence exactly as
  the flat rows above (`P/prompt.md`, `P/plan.draft.md`, `P/findings.md`, `P/plan.md`); the
  latest-transition rule then applies as for flat runs.
- All phases marked → print the checklist once showing the last phase as
  `- [x] phase <M>/<M> → .zi/{slug}/phase-NN/commit`, then the task-complete report. A
  malformed phase directory is reported without a checklist.

A phased resume of a two-phase task where `phase-01` is committed and `phase-02` holds a lone
`plan.draft.md`, printed before the verifier spawn (the phased shape in `task-phased.md`):

```
- [x] prompt → .zi/20260101-000000-example/phase-02/prompt.md
- [>] phase 2/2
  - [x] plan (create) → .zi/20260101-000000-example/phase-02/plan.draft.md
  - [ ] verify
  - [ ] plan (update)
  - [ ] execute
  - [ ] commit
```
