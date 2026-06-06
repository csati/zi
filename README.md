# pmf — spec-driven development pipeline

A Claude Code plugin that turns a rough idea into shipped code through a chain of
context-cleared phases, each producing a reviewable artifact that feeds the next:

```
prompt → research → (review) → prd → (review) → decompose → (review) → implement → finalize
```

Every artifact for one feature lives together in a per-task directory `.pmf/{ts}-{desc}/`
in your working directory — the directory name is the feature's slug — so the phases find
each other automatically (`prompt.md` → `brief.md` → `prd.md` → `plan-stage-NN.md`).

## The phases

| # | Phase | Command | Produces |
|---|-------|---------|----------|
| 1 | Prompt | `/pmf:prompt <desc>` | `.pmf/{slug}/prompt.md` |
| 2 | Research | `/pmf:research .pmf/{slug}/prompt.md` | `.pmf/{slug}/brief.md` |
| 3 | Review brief | `/pmf:doublecheck .pmf/{slug}/brief.md` | edits brief in place |
| 4 | PRD | `/pmf:prd .pmf/{slug}/brief.md` | `.pmf/{slug}/prd.md` |
| 5 | Review PRD | `/pmf:doublecheck .pmf/{slug}/prd.md` | edits PRD in place |
| 6 | Decompose | `/pmf:decompose .pmf/{slug}/prd.md` | `.pmf/{slug}/plan-stage-NN.md` |
| 7 | Review decomposition | `/pmf:doublecheck .pmf/{slug}/plan-stage-01.md` | edits stage files in place |
| 8 | Implement + finalize | `/pmf:implement-all .pmf/{slug}/prd.md` | committed code + gap report |

**Clear context between phases.** Each phase's quality comes from a clean context that
sees only the prior artifact. Phases 1–7 are interactive — you run them. Phase 8 is the
automated back half.

### `/pmf:pipeline` — the conductor

Lost? Run `/pmf:pipeline` in your working directory. It inspects which artifacts exist
for the active slug, shows a phase checklist, and tells you the exact next command and
when to clear context. It only guides — it never runs a phase or edits anything.

### `/pmf:implement-all` — the automated back half

Once phases 1–7 are done, `/pmf:implement-all .pmf/{slug}/prd.md` launches the `backhalf.js`
workflow: it implements each `.pmf/{slug}/plan-stage-NN.md` with a **fresh agent, one at a
time, in order**. After each stage a **separate verifier agent** independently re-runs that
stage's acceptance commands against the committed state — so no stage advances on the
implementer's word alone — and then a **third agent adversarially reviews** the stage's commit
diff for quality (correctness, security, edge cases, perf, conformance), not just completeness.
Every review finding is a claim until independently confirmed for **both reality and severity**:
a confirmed **minor** is auto-fixed and re-verified through the same green gate; a confirmed
**major** halts the run for you to resolve. The run also halts the moment a stage reports a
precondition conflict or its verification fails. A halt is **resumable** — once you resolve the
stage (delegate or apply a fix, or waive with a reason), re-launch with `startAt` and the engine
skips the already-committed stages. A final finalize pass then verifies the whole feature against
the PRD and reports gaps.

## Install

This repo is **self-contained**: its root is a one-plugin marketplace named `ncs-plugins`
(`.claude-plugin/marketplace.json`), and the plugin itself lives in `plugins/pmf/`.

### Share with colleagues (git-hosted)

Push this repo to a git host, then anyone adds it as a marketplace and installs the plugin:

```
/plugin marketplace add <owner>/pmf        # GitHub owner/repo shorthand, or a full git URL
/plugin install pmf@ncs-plugins
```

`ncs-plugins` is the marketplace name; `pmf` is the plugin within it. Relative plugin sources
only resolve when the marketplace is added **over git** (or a local path) — not via a bare URL
to `marketplace.json`, which downloads only the catalog and none of the plugin files.

### Local development

```
/plugin marketplace add /path/to/pmf   # this repo, as a local marketplace
/plugin install pmf@ncs-plugins
```

Validate first if you like: `/plugin validate /path/to/pmf`.

Editing the command `.md` files under `plugins/pmf/commands/` is picked up live. If you change
`marketplace.json` or `plugin.json`, run `/plugin marketplace update`.

## Contents

```
pmf/                                   ← repo root = the "ncs-plugins" marketplace
├── .claude-plugin/marketplace.json    ← the catalog (lists the pmf plugin)
├── plugins/pmf/                       ← the plugin itself
│   ├── .claude-plugin/plugin.json
│   ├── commands/   prompt, research, prd, decompose, doublecheck, finalize,
│   │               pipeline, implement-all, stage, commit
│   └── workflows/backhalf.js          ← the sequential implement→verify→review→finalize engine
├── README.md
├── CLAUDE.md
└── LICENSE
```

`implement-all` references the engine as `${CLAUDE_PLUGIN_ROOT}/workflows/backhalf.js`, so
the plugin is path-portable — it works wherever it's installed, on any machine.

## Caveats

- **Review state isn't auto-detectable.** `/pmf:doublecheck` leaves inline `[doublecheck]`
  notes only when it changes something, so the conductor can't *prove* a review happened;
  it greps for those notes as a hint and asks when unsure.
- **`finalize` reports, it doesn't fix.** The back-half's finalize pass returns a per-FR
  met/partial/missing gap report; deciding how to close a gap stays with you.
- **`stage` and `commit`** are general-purpose git helpers bundled alongside the pipeline
  commands — handy, but not part of the spec-driven flow itself.
