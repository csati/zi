# pmf — spec-driven development pipeline

A Claude Code plugin that turns a rough idea into shipped code through a chain of
context-cleared phases, each producing a reviewable artifact that feeds the next:

```
prompt → research → (review) → prd → (review) → decompose → (review) → implement → finalize
```

Every artifact for one feature shares a `{ts}-{desc}` slug, so the phases find each
other automatically (`prompt-…` → `brief-…` → `prd-…` → `plan-…-stage-NN`).

## The phases

| # | Phase | Command | Produces |
|---|-------|---------|----------|
| 1 | Prompt | `/pmf:prompt <desc>` | `prompt-{slug}.md` |
| 2 | Research | `/pmf:research prompt-{slug}.md` | `brief-{slug}.md` |
| 3 | Review brief | `/pmf:doublecheck brief-{slug}.md` | edits brief in place |
| 4 | PRD | `/pmf:prd brief-{slug}.md` | `prd-{slug}.md` |
| 5 | Review PRD | `/pmf:doublecheck prd-{slug}.md` | edits PRD in place |
| 6 | Decompose | `/pmf:decompose prd-{slug}.md` | `plan-{slug}-stage-NN.md` |
| 7 | Review decomposition | `/pmf:doublecheck plan-{slug}-stage-01.md` | edits stage files in place |
| 8 | Implement + finalize | `/pmf:implement-all prd-{slug}.md` | committed code + gap report |

**Clear context between phases.** Each phase's quality comes from a clean context that
sees only the prior artifact. Phases 1–7 are interactive — you run them. Phase 8 is the
automated back half.

### `/pmf:pipeline` — the conductor

Lost? Run `/pmf:pipeline` in your working directory. It inspects which artifacts exist
for the active slug, shows a phase checklist, and tells you the exact next command and
when to clear context. It only guides — it never runs a phase or edits anything.

### `/pmf:implement-all` — the automated back half

Once phases 1–7 are done, `/pmf:implement-all prd-{slug}.md` launches the `backhalf.js`
workflow: it implements each `plan-{slug}-stage-NN.md` with a **fresh agent, one at a
time, in order**, halts the moment a stage reports a precondition conflict, then runs a
finalize pass that verifies the whole feature against the PRD and reports gaps.

## Install (local marketplace)

```
/plugin marketplace add /Users/ncs/dev/claude/plugins
/plugin install pmf@local
```

Validate before installing if you like: `/plugin validate /Users/ncs/dev/claude/plugins`.

Editing the command `.md` files is picked up live. If you change `marketplace.json`
itself, run `/plugin marketplace update`.

## Contents

```
pmf/
├── .claude-plugin/plugin.json
├── commands/        prompt, research, prd, decompose, doublecheck, finalize, pipeline, implement-all
├── workflows/backhalf.js   ← the sequential implement→finalize engine
└── README.md
```

`implement-all` references the engine as `${CLAUDE_PLUGIN_ROOT}/workflows/backhalf.js`, so
the plugin is path-portable — it works wherever it's installed, on any machine.

## Caveats

- **Review state isn't auto-detectable.** `/pmf:doublecheck` leaves inline `[doublecheck]`
  notes only when it changes something, so the conductor can't *prove* a review happened;
  it greps for those notes as a hint and asks when unsure.
- **`finalize` reports, it doesn't fix.** The back-half's finalize pass returns a per-FR
  met/partial/missing gap report; deciding how to close a gap stays with you.
- **`stage` and `commit`** are general-purpose and intentionally left as your user-level
  commands, not bundled here.
