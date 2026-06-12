---
description: Conductor for the prompt→research→prd→decompose→implement→finalize pipeline. Inspects the artifacts in .pmf/, reports where you are, and tells you the exact next command and when to clear context. Guides only — it does not run the phases.
argument-hint: [optional {desc} slug, or part of it, to pick which feature's pipeline to track; defaults to the only/most-recent task directory in .pmf/]
allowed-tools: Bash(date:*), Bash(git:*), Bash(grep:*), Bash(ls:*), Read, Grep, Glob, AskUserQuestion
---

# Pipeline conductor

## Objective

Tell the user **where they are** in the spec-driven pipeline and **what to run next** — including the reminder to clear context between phases. This command is a read-only guide: it inspects artifacts and reports; it never runs a phase or edits a file.

## The pipeline

Every artifact for one feature lives together in a **per-task directory** `.pmf/{ts}-{desc}/` in the working directory — the directory name is the feature's slug. The ordered phases are:

| # | Phase | Run | Produces |
|---|-------|-----|----------|
| 1 | Prompt | `/pmf:prompt <desc>` | `.pmf/{slug}/prompt.md` |
| 2 | Research | `/pmf:research .pmf/{slug}/prompt.md` | `.pmf/{slug}/brief.md` |
| 3 | Review brief | `/pmf:doublecheck .pmf/{slug}/brief.md` | *(edits brief in place)* |
| 4 | PRD | `/pmf:prd .pmf/{slug}/brief.md` | `.pmf/{slug}/prd.md` |
| 5 | Review PRD | `/pmf:doublecheck .pmf/{slug}/prd.md` | *(edits PRD in place)* |
| 6 | Decompose | `/pmf:decompose .pmf/{slug}/prd.md` | `.pmf/{slug}/plan-stage-NN.md` |
| 7 | Review decomposition | `/pmf:doublecheck .pmf/{slug}/plan-stage-01.md` | *(edits stage files in place)* |
| 8 | Implement + finalize | `/pmf:implement-all .pmf/{slug}/prd.md` | committed code + gap report |

**Clear context before every phase.** Each phase's power comes from a clean context that sees only the prior artifact. Phases 1–7 are interactive (run by the user). Phase 8 is the automated back half.

## Process

### 1 — Resolve the slug

- If the argument names or partially matches a `.pmf/{ts}-{desc}/` task directory, use it.
- Otherwise glob the task directories `.pmf/*/`:
  - **No task directories** — the pipeline hasn't started. Tell the user to begin with `/pmf:prompt <description>` and stop.
  - **One** — use it.
  - **Several** — list them (with their furthest-reached phase) and ask which to track.

### 2 — Determine state

For the chosen task directory, glob which artifacts exist inside it:

- `.pmf/{slug}/prompt.md` → phase 1 done
- `.pmf/{slug}/brief.md` → phase 2 done
- `.pmf/{slug}/prd.md` → phase 4 done
- `.pmf/{slug}/plan-stage-*.md` → phase 6 done (note how many stages)
- `.pmf/{slug}/finalize.md` → phase 8 has been run at least once

The **review** phases (3, 5, 7) record a **completion receipt** — `/pmf:doublecheck` writes a `<!-- pmf:reviewed date=… hash=… … -->` line as the first line of each reviewed artifact, even when it found nothing. Read the receipt to determine review state; do **not** grep for change-notes (a clean review leaves none).

For each review phase, take its artifact(s) — phase 3 → `brief.md`, phase 5 → `prd.md`, phase 7 → every `plan-stage-*.md` — and for each file:

- **No receipt line** → the review is unconfirmed (`~`).
- **Receipt present** → recompute the canonical hash and compare it to the receipt's `hash` (the **identical** command `/pmf:doublecheck` used, so a match is exact):

  ```
  grep -v '^<!-- pmf:reviewed ' <file> | git hash-object --stdin
  ```

  - **matches** → fresh review (`✓`); surface the receipt's `date` and `result`.
  - **differs** → the artifact changed since it was reviewed: reviewed-but-**stale** (`✓ (stale — artifact changed since review)`), never a clean `✓`.

For the decomposition (phase 7), aggregate across all `plan-stage-*.md`: **any** stage missing a receipt → `~`; all stages stamped but **any** hash stale → `✓ (stale)`; all present and all matching → `✓`.

### 3 — Report and point to the next step

Print a compact checklist of the eight phases with a status each:

- `✓` produce-phase artifact present / review phase with a present, hash-matching receipt (show its `date` + `result`)
- `✓ (stale — artifact changed since review)` review phase whose receipt no longer matches the artifact
- `~` review phase with no receipt — freshness can't be confirmed; run the review to stamp one
- `▢` not started

Then give a single **Next:** line — the earliest incomplete phase — as the exact command to run, prefixed with **“clear context, then …”**. If the next produce-phase is preceded by a review phase whose receipt is **absent or stale**, mention that review first as recommended-but-skippable (a stale receipt means the artifact changed since it was last reviewed).

When phases 1–7 are complete (PRD exists, decomposed, and the decomposition has been reviewed), the next step is the automated back half: tell the user to run **`/pmf:implement-all .pmf/{slug}/prd.md`**, which implements every stage with a fresh agent in order and then finalizes against the PRD.

## Guardrails

- **Guide, don't execute.** Never run a phase, edit an artifact, or touch source from this command.
- **Don't fabricate review state.** Report review phases from the receipt, never a guess: a clean `✓` requires a present, hash-matching receipt. Never emit a clean `✓` when freshness can't be confirmed — absent receipt → `~`, stale receipt → `✓ (stale)`.
- **Always pair the next command with the clear-context reminder.** That reminder is the point of the conductor.
