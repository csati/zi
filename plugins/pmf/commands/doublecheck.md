---
description: Verify a /pmf:research brief, a /pmf:prd PRD, or a /pmf:decompose plan set for correctness and completeness against the source it is based on. Interrogate each flaw one at a time with a recommended fix and a keep-as-is option, then edit the file(s) with the chosen resolutions and inline notes. Use when the user wants to double-check, validate, or sanity-check a brief, PRD, or decomposition before acting on it.
argument-hint: [path to the brief.md, prd.md, a plan-stage-*.md, or the task directory to verify]
allowed-tools: Bash(date:*), Read, Grep, Glob, AskUserQuestion, Edit
---

# Double-Check

## Objective

Verify a research brief (the output of `/pmf:research`), a PRD (the output of `/pmf:prd`), or a decomposition (the set of `plan-stage-*.md` files from `/pmf:decompose`) for **correctness** and **completeness** against the source it is based on, and against the actual codebase. Surface every flaw to the user **one at a time, interrogation style — never as an upfront list** — each with a recommended fix and an explicit option to confirm leaving it as-is. Apply the chosen resolution to the reviewed file in place, annotating each decision with an inline note. (A decomposition is reviewed as one unit: all `plan-stage-*.md` files in a task directory.)

## Input

The argument is what to verify — resolve it to a **review unit** before doing anything else. A review unit is one of: a single `brief.md`, a single `prd.md`, or a **decomposition** — the complete set of `plan-stage-*.md` files in one `.pmf/{slug}/` task directory, reviewed together as one unit.

$ARGUMENTS

Resolution rules:

1. If the argument is a non-empty file name/path/reference, resolve it to an existing file — use the path as given if it exists. Once resolved:
   - A `brief.md` or `prd.md` is itself the review unit.
   - A `plan-stage-*.md` resolves to the **whole sibling set**: glob `.pmf/{slug}/plan-stage-*.md` for that file's task directory and review all of them together.
2. If the argument points to a task directory (`.pmf/{slug}/`, or a bare `{slug}`), enumerate the review units inside it: its `brief.md`, its `prd.md`, and its decomposition (the `plan-stage-*.md` set). If exactly one exists, use it; if several exist, ask which to verify.
3. If the argument is empty, enumerate the candidate review units across all task directories: each `.pmf/*/prd.md`, each `.pmf/*/brief.md`, and each decomposition (one unit per task directory that holds `plan-stage-*.md` files). Then:
   - **Zero units** — nothing to verify. Tell the user no `brief.md`, `prd.md`, or `plan-stage-*.md` was found under any `.pmf/` task directory and **terminate**.
   - **Exactly one unit** — use it (state what you picked so the user can confirm).
   - **More than one unit** — list the candidates (briefs, PRDs, and decompositions, with their task directories) and ask which to verify; wait for their choice.
4. If a path is given but the file does not exist, say so and stop.

Confirm the resolved review unit back to the user before proceeding.

## Identify the document and its source

1. **Classify the review unit** by filename and structure:
   - `brief.md` / research-brief structure → a **research brief**; the spec it must be faithful to is the **prompt** it was based on.
   - `prd.md` / PRD structure → a **PRD**; the spec it must be faithful to is the **brief** it was based on.
   - A set of `plan-stage-*.md` files → a **decomposition**; the spec it must be faithful to is the **PRD** it was based on.
   - None of these — tell the user you expected a `/pmf:research` brief, a `/pmf:prd` PRD, or a `/pmf:decompose` plan set; ask whether to proceed anyway, and against which source.

2. **Locate the source artifact** — sibling artifacts live in the same `.pmf/{slug}/` task directory, so the source is a sibling file:
   - A `brief.md` pairs with `prompt.md` in the same directory.
   - A `prd.md` pairs with `brief.md` in the same directory.
   - A `plan-stage-*.md` set pairs with `prd.md` in the same directory.
   - Read the sibling source file — this is what the unit must satisfy.
   - If the sibling is not found (an inline source, or the source was deleted/renamed), ask the user to point you at the source or to state the original intent. If it is genuinely unavailable, tell the user that source-fidelity checks will be limited and proceed with the remaining checks.

## Process

Work through these phases. **Do not surface any flaw until Phase 1 is complete, and never as a list.**

### Phase 1 — Analyze (silently)

Read the file under review, its source, and — following the paths they reference — the relevant code with `Read`/`Grep`/`Glob`. Build the flaw list internally; do **not** dump it to the user.

Check for:

- **Source fidelity (completeness, both directions)** — every requirement, recommendation, or constraint the source asks for is addressed by the file; and the file invents no scope the source never asked for.
- **Internal consistency** — contradictions between sections (e.g. a Goal that fights a Non-Goal, conflicting requirements, a Technical Constraint a requirement violates).
- **Groundedness (correctness)** — referenced file paths, modules, APIs, and constraints actually exist and match the codebase; nothing is hallucinated or stale.
- **Structural completeness** — every section the template prescribes is present and substantive, not a placeholder or hand-wave.
- **Testability** *(PRD)* — each goal is measurable, each acceptance criterion is concrete and verifiable, and success metrics are quantitative. Flag vague language like "should be fast".
- **Coverage** *(decomposition)* — every `FR-*` and acceptance criterion in the PRD is owned by exactly one stage; nothing is dropped and no stage invents scope the PRD never asked for. The union of the stages must equal the PRD.
- **Ordering & dependencies** *(decomposition)* — each stage's preconditions are established by the handoff of an *earlier* stage (never a later one, never thin air). Trace every precondition to the stage that produces it; flag forward references and unmet assumptions.
- **Stage independence** *(decomposition)* — each stage is runnable by a fresh agent from the committed repo alone; flag any stage that secretly needs another stage's in-flight context, or that was split at a seam that can't actually hold green.
- **File-ownership conflicts** *(decomposition)* — using each stage's declared "Files this stage owns", flag any file owned by multiple stages in conflicting ways, and any ordering that forces a later stage to rewrite an earlier stage's work.
- **Green-on-exit & read-first** *(decomposition)* — every stage carries concrete build/test acceptance criteria and instructs its agent to verify preconditions before editing and to stop-and-report on conflict.
- **Risks & feasibility** — anything technically infeasible or high-risk that the document failed to flag.

### Phase 2 — Interrogate one flaw at a time

For each flaw, in descending order of severity:

1. **State it plainly** — name the flaw, point at its location (which file and section), and give the evidence: what the source says, or what the codebase actually shows.
2. **Recommend a specific fix.**
3. **Resolve it with the user** via `AskUserQuestion` — offer the recommended fix first (label it "(Recommended)"), any meaningful alternative, and an explicit **"Keep as-is"** option. The user may also type a custom resolution.
4. **Immediately apply the resolution** with `Edit` before raising the next flaw:
   - *Fix chosen* → make the edit, then add the inline note recording what changed and why.
   - *Keep as-is* → leave the content, but add the inline note recording the deliberate decision and the user's rationale, so downstream readers know it was reviewed, not missed.

Surface, resolve, and apply **one** flaw before raising the next. Never present them as a batch.

#### Inline note format

Get the review date once:

!`date +%Y-%m-%d`

Place the note as a markdown blockquote immediately adjacent to the affected content:

- Fixed: `> **[doublecheck {date}]** Revised per review — {what changed and why}.`
- Kept as-is: `> **[doublecheck {date}]** Reviewed, kept as-is per user — {flaw}; {rationale}.`

## Output

You edit the reviewed file(s) **in place** — you do not create new files. For a decomposition, a single fix may touch more than one stage file (e.g. moving a requirement from one stage to another); edit each affected file and record the note in that file. When the interrogation is complete, give the user a short summary: how many flaws were raised, how many were fixed vs kept as-is, and the path(s) of the file(s) you edited.

## Guardrails

- **Verify against reality** — confirm claims against the source and the codebase. Don't take the document's word for what exists.
- **Interrogation, not a report** — one flaw at a time, each resolved before the next. No upfront list.
- **Never change the document silently** — every edit, whether a fix or a confirmed as-is, carries an inline note recording the user's choice.
- **Resolve, don't assume** — if a fix has more than one reasonable form, ask; don't pick one and bake it in.
- **If you find no flaws**, say so plainly and leave the file untouched (no notes).
