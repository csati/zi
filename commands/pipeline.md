---
description: Conductor for the prompt→research→prd→decompose→implement→finalize pipeline. Inspects the artifacts in the working directory, reports where you are, and tells you the exact next command and when to clear context. Guides only — it does not run the phases.
argument-hint: [optional {desc} slug, or part of it, to pick which feature's pipeline to track; defaults to the only/most-recent slug in the working directory]
allowed-tools: Bash(date:*), Bash(git:*), Bash(ls:*), Read, Grep, Glob, AskUserQuestion
---

# Pipeline conductor

## Objective

Tell the user **where they are** in the spec-driven pipeline and **what to run next** — including the reminder to clear context between phases. This command is a read-only guide: it inspects artifacts and reports; it never runs a phase or edits a file.

## The pipeline

Every artifact for one feature shares a `{ts}-{desc}` slug. The ordered phases are:

| # | Phase | Run | Produces |
|---|-------|-----|----------|
| 1 | Prompt | `/pmf:prompt <desc>` | `prompt-{slug}.md` |
| 2 | Research | `/pmf:research prompt-{slug}.md` | `brief-{slug}.md` |
| 3 | Review brief | `/pmf:doublecheck brief-{slug}.md` | *(edits brief in place)* |
| 4 | PRD | `/pmf:prd brief-{slug}.md` | `prd-{slug}.md` |
| 5 | Review PRD | `/pmf:doublecheck prd-{slug}.md` | *(edits PRD in place)* |
| 6 | Decompose | `/pmf:decompose prd-{slug}.md` | `plan-{slug}-stage-NN.md` |
| 7 | Review decomposition | `/pmf:doublecheck plan-{slug}-stage-01.md` | *(edits stage files in place)* |
| 8 | Implement + finalize | `/pmf:implement-all prd-{slug}.md` | committed code + gap report |

**Clear context before every phase.** Each phase's power comes from a clean context that sees only the prior artifact. Phases 1–7 are interactive (run by the user). Phase 8 is the automated back half.

## Process

### 1 — Resolve the slug

- If the argument names or partially matches a `{ts}-{desc}` present in the working directory, use it.
- Otherwise glob `prompt-*.md`, `brief-*.md`, `prd-*.md`, `plan-*-stage-*.md`, `finalize-*.md` and group by `{ts}-{desc}`:
  - **No slugs** — the pipeline hasn't started. Tell the user to begin with `/pmf:prompt <description>` and stop.
  - **One slug** — use it.
  - **Several** — list them (with their furthest-reached phase) and ask which to track.

### 2 — Determine state

For the chosen slug, glob which artifacts exist:

- `prompt-{slug}.md` → phase 1 done
- `brief-{slug}.md` → phase 2 done
- `prd-{slug}.md` → phase 4 done
- `plan-{slug}-stage-*.md` → phase 6 done (note how many stages)
- `finalize-{slug}.md` → phase 8 has been run at least once

The **review** phases (3, 5, 7) leave no reliable marker — `/pmf:doublecheck` writes inline `> **[doublecheck …]**` notes only when something changed, and nothing when the artifact was already clean. So you cannot prove a review happened from the files. Grep the relevant artifact for `[doublecheck` as a hint, and if it's ambiguous whether the user has reviewed the latest produced artifact, **ask** rather than assume.

### 3 — Report and point to the next step

Print a compact checklist of the eight phases with a status each:

- `✓` artifact present / phase done
- `~` review phase — recommended, completion unverifiable (note if `[doublecheck]` marks were found)
- `▢` not started

Then give a single **Next:** line — the earliest incomplete phase — as the exact command to run, prefixed with **“clear context, then …”**. If the next produce-phase is preceded by an un-confirmed review phase, mention the review first as recommended-but-skippable.

When phases 1–7 are complete (PRD exists, decomposed, and the decomposition has been reviewed), the next step is the automated back half: tell the user to run **`/pmf:implement-all prd-{slug}.md`**, which implements every stage with a fresh agent in order and then finalizes against the PRD.

## Guardrails

- **Guide, don't execute.** Never run a phase, edit an artifact, or touch source from this command.
- **Don't fabricate review state.** If you can't tell whether a review happened, say so or ask — don't report `✓` for a review you can't verify.
- **Always pair the next command with the clear-context reminder.** That reminder is the point of the conductor.
