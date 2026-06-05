---
description: Auto-run the pipeline back half — implement every /pmf:decompose stage with a fresh agent in order (halting on conflict), then finalize against the PRD. Run once phases 1–7 (prompt→…→reviewed decomposition) are done.
argument-hint: [path to the prd-*.md whose stages to implement, defaults to the prd-*.md in the working directory]
allowed-tools: Bash(date:*), Bash(git:*), Read, Glob, AskUserQuestion, Workflow
---

# Implement all stages + finalize

## What this does

Runs the automated back half of the pipeline. For the chosen PRD it takes the ordered `plan-{slug}-stage-NN.md` files and, **one at a time in order**, spawns a *fresh agent* to implement each stage against the live repo, then runs a finalize pass against the PRD. The sequencing, the halt-on-conflict, and the fresh-context-per-stage are handled by the `pipeline-backhalf` workflow engine — this command just prepares its inputs and launches it.

This is the only phase that runs unattended. Phases 1–7 are interactive; do those with `/pmf:prompt`, `/pmf:research`, `/pmf:prd`, `/pmf:decompose`, and `/pmf:doublecheck` (see `/pmf:pipeline`).

## Steps

1. **Resolve the PRD** from the argument:

   $ARGUMENTS

   - If it's a non-empty path to an existing file, use it.
   - Otherwise glob `prd-*.md` in the working directory: zero → tell the user there's nothing to implement and stop; one → use it; many → list and ask which.
   - Derive the `{ts}-{desc}` slug from the PRD filename.

2. **Gather the stages.** Glob `plan-{slug}-stage-*.md` and sort ascending by the zero-padded `NN`. If there are none, tell the user to run `/pmf:decompose prd-{slug}.md` first and stop.

3. **Confirm before launching.** Show the user the ordered list of stage files that will be implemented and that a finalize pass against `prd-{slug}.md` follows. Ask for an explicit go-ahead with `AskUserQuestion` — launching spawns agents that **edit and commit code**. Do not proceed without confirmation.

4. **Launch the engine.** Call the `Workflow` tool with the script at `${CLAUDE_PLUGIN_ROOT}/workflows/backhalf.js` and pass the inputs as `args`:

   ```
   Workflow({
     scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/backhalf.js",
     args: { prd: "prd-{slug}.md", stages: ["plan-{slug}-stage-01.md", "plan-{slug}-stage-02.md", ...] }
   })
   ```

   Pass `stages` already ordered. The workflow runs in the background; you'll be notified when it finishes.

5. **Report the outcome** when it returns:
   - **Completed** — summarize which stages landed (and their commits), then present the finalize gap report: per-FR met/partial/missing, build/test/lint results, and the bottom line on whether the PRD is satisfied.
   - **Halted on conflict** — name the stage that stopped and quote its reason. Recommend the route per the stop-and-report rule: a small local fix, a revised/appended stage, or a step back up the pipeline (`/pmf:prd` → `/pmf:doublecheck` → `/pmf:decompose`) when the plan no longer matches reality. Let the user choose — don't auto-resume.

## Guardrails

- **Get explicit confirmation before launching** — this phase writes and commits code.
- **Sequential, not parallel** — stages depend on each other's committed state; the engine runs them in order and must not be made concurrent.
- **Honour the halt** — if the engine stopped on a conflict, surface it and recommend a fix; never paper over it by forcing the next stage.
