---
description: Auto-run the pipeline back half — implement every /pmf:decompose stage with a fresh agent in order, independently verify and adversarially review each (halting on conflict or a confirmed major finding), then finalize against the PRD. Run once phases 1–7 (prompt→…→reviewed decomposition) are done.
argument-hint: [path to the prd.md whose stages to implement, or its task directory; defaults to the lone prd.md under .pmf/]
allowed-tools: Bash(date:*), Bash(git:*), Read, Glob, AskUserQuestion, Workflow, Task
---

# Implement all stages + finalize

## What this does

Runs the automated back half of the pipeline. For the chosen PRD it takes the ordered `.pmf/{slug}/plan-stage-{NN}.md` files and, **one at a time in order**, spawns a *fresh agent* to implement each stage against the live repo. The per-stage tail is **implement → verify → review → advance**, each step finishing before the next begins:

- a **separate verifier agent** independently re-runs that stage's exact acceptance commands against the committed state — confirming a clean tree, the commit, and exit-code-0 — before review; no stage advances on the implementer's word alone;
- a **third agent then adversarially reviews** the stage's commit diff for whether it is *good*, not merely green — correctness, security, unhandled edge cases, perf foot-guns, and conformance to the surrounding code. Every finding is a claim until independently confirmed for **both reality and severity**: a confirmed **minor** is auto-fixed by a fix agent and re-verified through the same green gate; a **major** is substantiated by a dedicated confirmer agent and, if confirmed, **halts** the run for you to resolve.

A finalize pass against the PRD follows. The sequencing, the per-stage verification, the adversarial review, the halt-on-conflict, and the fresh-context-per-stage are handled by the `pipeline-backhalf` workflow engine — this command just prepares its inputs, launches it, and (on a halt) helps you resolve and resume.

This is the only phase that runs unattended. Phases 1–7 are interactive; do those with `/pmf:prompt`, `/pmf:research`, `/pmf:prd`, `/pmf:decompose`, and `/pmf:doublecheck` (see `/pmf:pipeline`).

## Steps

1. **Resolve the PRD** from the argument:

   $ARGUMENTS

   - If it's a non-empty path to an existing file, use it. If it points to a task directory (`.pmf/{slug}/`, or a bare `{slug}`), use the `prd.md` inside it.
   - Otherwise glob `.pmf/*/prd.md`: zero → tell the user there's nothing to implement and stop; one → use it; many → list the candidate task directories and ask which.
   - The task directory `.pmf/{slug}/` containing the PRD is the slug for everything below.

2. **Gather the stages.** Glob `.pmf/{slug}/plan-stage-*.md` and sort ascending by the zero-padded `NN`. If there are none, tell the user to run `/pmf:decompose .pmf/{slug}/prd.md` first and stop.

3. **Confirm before launching.** Show the user the ordered list of stage files that will be implemented and that a finalize pass against `.pmf/{slug}/prd.md` follows. Ask for an explicit go-ahead with `AskUserQuestion` — launching spawns agents that **edit and commit code**. Do not proceed without confirmation.

4. **Isolate the run on a branch (pre-launch safety).** This is the only unattended, code-committing phase; never let it commit onto an undecided branch or carry pre-existing changes into the run. Runs on **every fresh launch, regardless of which branch is checked out**; **skip it entirely on resume** (`startAt` set — see step 7), where the branch was chosen on the original launch and the user has just committed fixes. Gather the decisions first, then mutate the repo in a safe order — **stash before any branch switch**. Fold these into the same pre-launch gate as step 3, not a scatter of surprise prompts.

   - **A — Capture the base ref (rollback anchor).** Run `git rev-parse HEAD` and `git branch --show-current`; record both. They feed the launch summary (E) and the rollback recipe.
   - **B — Always ask where to commit.** Derive a **recommended** branch name: take the `{desc}` part of the task slug and **strip the leading `{YYYYMMDD-HHmmss}-` timestamp** (slug `20260605-143000-csv-export` → `csv-export`; namespacing as `pmf/csv-export` is fine — keep it simple). Ask with `AskUserQuestion` (header e.g. `Branch`), the recommended option **first**:
     1. **Create branch `{recommended}`** *(Recommended)* — will `git switch -c {recommended}` in D.
     2. **Name the branch myself** — take the free-text **"Other"** entry `AskUserQuestion` always offers (or ask a one-line follow-up). **Validate** it with `git check-ref-format --branch <name>` and re-ask if invalid. Will `git switch -c {name}` in D.
     3. **Work on the current branch** — no new branch; commits land straight onto the current branch. Warn that recovery is then manual (the step-A base SHA is the only anchor).

     Show this on **every** launch — even off `main`/`master`. When the current branch *is* a protected/default branch, still lead with option 1, but the choice is always the user's.
   - **C — Handle a dirty working tree (only if dirty).** Run `git status --porcelain`. Treat the tree as **dirty** if it shows any uncommitted change — tracked modifications **or untracked files that are not gitignored** (gitignored files do not count). Only if it is dirty, ask a **second** `AskUserQuestion` (header e.g. `Uncommitted changes`):
     1. **Stash and continue** *(Recommended)* — `git stash push -u -m "pmf: pre-implement-all autostash"` (run in D). The `-u` also stashes untracked-not-ignored files; gitignored caches stay put. This gives the run the clean baseline the per-stage `cleanTree` gate requires. Tell the user the changes are saved and to restore them with `git stash pop` after the run.
     2. **Abort** — do **not** launch; stop so the user can commit or handle the changes themselves.

     By `implement-all` time the PRD and stage files are already committed, so the stash only moves genuine uncommitted working changes (and any stray untracked `.pmf/` scratch); the committed stages the workflow needs are unaffected.
   - **D — Execute the mutations, in this order:** (1) if C chose **stash**, run it **now**, before touching the branch; (2) if B chose option 1 or 2, `git switch -c {name}` now — so the new branch starts from a clean tree; option 3 stays on the current branch; (3) proceed to launch (step 5).
   - **E — State the rollback recipe in the launch summary.** Name the branch the run will commit to, quote the base SHA, and state that `git reset --hard {baseSHA}` (or deleting the new branch) discards the whole run. If C stashed, add the `git stash pop` reminder. Never `git stash pop` automatically — leave restoration to the user.

5. **Launch the engine.** Call the `Workflow` tool with the script at `${CLAUDE_PLUGIN_ROOT}/workflows/backhalf.js` and pass the inputs as `args`:

   ```
   Workflow({
     scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/backhalf.js",
     args: { prd: ".pmf/{slug}/prd.md", stages: [".pmf/{slug}/plan-stage-01.md", ".pmf/{slug}/plan-stage-02.md", ...], baseRef: "{baseSHA}" }
   })
   ```

   Pass `stages` already ordered. `baseRef` is the base SHA captured in step 4A — the engine echoes it back in its return for the audit trail. The workflow runs in the background; you'll be notified when it finishes.

   **Resuming after a halt** (see step 6): once you've resolved the halting stage, re-launch the **same** call with one extra arg — `startAt`, the 1-based index (or the path) of the resolved stage (skip the step-4 branch/stash prompts on resume — stay on the run's branch):

   ```
   args: { prd: "...", stages: [ ...same ordered list... ], startAt: 3 }
   ```

   The engine skips the already-committed earlier stages, re-verifies the resolved stage through the green gate, then continues. Keep `stages` identical to the original launch.

6. **Report the outcome** when it returns. The return carries `results[]` (each stage `{ file, result, verification }`, plus `review` once it has been reviewed and `reverification` when a minor fix was re-verified, or `{ file, skipped: true }` for stages skipped on resume) and, on completion, `report`; on a halt it carries `halted: true`, `reason`, `atStage`, and `atStageIndex`.
   - **Completed** (`halted` falsy) — summarize which stages landed (and their commits), noting that **each was independently verified** (`results[i].verification`) **and adversarially reviewed** (`results[i].review`). For any stage whose review auto-fixed minor findings, list what was found and fixed (its `review.findings` entries with `resolution: "fixed"`, plus `review.fixCommitMode`) — these are real changes layered onto the stage. Then present the finalize gap report: per-FR met/partial/missing **and how each was verified** (`verifiedBy` — the executed test selector vs inspection/waiver, flagging any "met" established only by inspection), build/test/lint results, and the bottom line on whether the PRD is satisfied.
   - **Halted** (`halted: true`) — name the stage (`atStage`) that stopped and quote the evidence, then recommend a route per the stop-and-report rule and **let the user choose — don't auto-resume**:
     - `reason: "conflict"` / `"failed"` — quote the stage result's `detail`. Recommend a small local fix, a revised/appended stage, or a step back up the pipeline (`/pmf:prd` → `/pmf:doublecheck` → `/pmf:decompose`) when the plan no longer matches reality. Once the stage is fixed, committed, and green, you can resume from it with `startAt` (step 7) rather than redoing the earlier stages.
     - `reason: "verification-failed"` — the independent verifier could not re-establish the stage's green on the committed state. Quote the specific evidence from that stage's `verification`: a dirty working tree (`cleanTreeEvidence` — the implementer likely committed only a subset of what made it green), a missing commit (`commitPresent: false`), or the failing acceptance command(s) (each `checks[]` entry's `command`, `exitCode`, and `outputTail`). Recommend completing/repairing the commit or fixing the failing command before re-running — do **not** paper over it by forcing the next stage.
     - `reason: "review-major"` — the adversarial reviewer raised, and a **dedicated confirmer independently substantiated**, one or more **major** findings in the stage's committed diff. The stage is *green*; the issue is quality, not completeness. Serious issues are never silently auto-fixed during the unattended phase — surface them and resolve each before resuming (step 7).

7. **Resolve a `review-major` halt and resume.** The findings live in `results[atStageIndex - 1].review.findings`. The blockers are the entries with `resolution: "halted"` (each a confirmer-substantiated major); the list may also carry other findings that were surfaced but not auto-fixed (`resolution: "unresolved"`). For each blocker quote its `file:line`, `claim`, `suggestedFix`, and the confirmer's `resolutionReason`.

   For **each confirmed major**, ask the user with `AskUserQuestion` how to resolve it:
   - **Delegate the fix to an agent** — spawn a fresh `Task` agent scoped to that finding and that stage: fix it minimally against the live repo, make the stage green, and **commit** (amend the stage's commit, or add one follow-up commit). Record the resolution as a *delegated* `fixed`.
   - **Fix it manually** — tell the user exactly what to change; wait until they confirm the fix is **committed**. Record a *manual* `fixed`.
   - **Waive with a reason** — capture the user's reason; the code does not change. Record `waived-with-reason`.

   Offer the same three options for any surfaced non-blocking findings the user wants addressed, but only the confirmed majors block the resume.

   Once every confirmed major is resolved **and all fixes are committed** (the resume re-verifies the stage through the green gate, which requires a clean committed tree), re-launch the workflow exactly as in step 5 **with `startAt: atStageIndex`**. Keep a short audit note of what was fixed vs waived and by whom: the workflow itself stamped `fixed`/`halted`/`dropped`; **you** (the orchestrating layer) stamp the `waived-with-reason` and any delegated/manual `fixed` — so the trail records who decided.

## Guardrails

- **Get explicit confirmation before launching** — this phase writes and commits code. Fold the branch + stash decisions (step 4) into that same pre-launch gate.
- **Isolate where the commits land** — on every fresh launch let the user choose the branch and, if the tree is dirty, stash-or-abort *before* the engine starts; capture a base SHA so a bad run is one `git reset --hard` to undo. Mutate in safe order (stash before `git switch -c`) and never `git stash pop` automatically. Branch management lives in this command, never in `backhalf.js` (it has no filesystem access and stays a pure orchestrator). On resume, skip the branch/stash prompts and stay on the run's branch.
- **Sequential, not parallel** — stages depend on each other's committed state; the engine runs them in order and must not be made concurrent.
- **Honour the halt** — if the engine stopped (a conflict, a failed stage, a failed independent verification, or a confirmed major review finding), surface it with its evidence and recommend a fix; never paper over it by forcing the next stage.
- **Only confirmed findings gate** — a review halt always rides on a *confirmed* major (reviewer claim + independent confirmer), never the raising reviewer's word; confirmed minors are auto-fixed and re-verified, not halted. Report findings honestly: distinguish what was confirmed-and-fixed, what was dropped as a false positive, and what halted.
- **Resume, don't restart** — after resolving a halt and committing the fix, re-launch with `startAt` so already-committed stages are trusted and skipped; never silently re-run from stage 1 over committed work.
