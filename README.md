# pmf — prompt-to-plan planning helper

A Claude Code plugin that turns a rough idea into a verified implementation plan through two
context-cleared phases, each producing a reviewable artifact that feeds the next:

```
prompt → plan → (you implement)
```

Every artifact for one feature lives together in a per-task directory `.pmf/{ts}-{desc}/`
in your working directory — the directory name is the feature's slug — so the second phase
finds the first automatically (`prompt.md` → `plan.md`).

## The commands

The plugin ships four slash commands — two planning phases plus two git helpers:

| Command | Reads | Produces | Role |
|---------|-------|----------|------|
| `/pmf:prompt <desc>` | a rough idea | `.pmf/{slug}/prompt.md` | interrogate intent, surface flaws, save a refined prompt |
| `/pmf:plan <prompt>` | `.pmf/{slug}/prompt.md` or inline text | `.pmf/{slug}/plan.md` | draft a plan, independently verify it, persist on approval |
| `/pmf:stage <desc>` | your description | staged files | stage files for commit from a natural-language description |
| `/pmf:commit` | staged changes | a commit | commit staged changes with a terse single-line message |

**Clear context between phases.** Each phase's quality comes from a clean context that sees
only the prior artifact. Both planning phases are interactive — you run them, answer their
questions, and approve their output. After `plan` writes `plan.md`, **you implement the code
yourself** — the plugin stops at the verified plan; there is no automated, self-committing
back-half.

### `/pmf:prompt` — refine the idea

Interrogates a rough idea until intent is crystal clear: it grounds itself in your codebase
with read-only exploration, asks only the questions the code can't answer, and explicitly
surfaces ambiguities, flaws, side effects, and hidden assumptions for you to resolve. Only once
intent is confirmed and every raised risk is settled does it write a tight, self-contained
spec to `.pmf/{slug}/prompt.md` — the single input the next phase reads from a fresh context.

### `/pmf:plan` — draft and verify the plan

Takes a prompt — a `.pmf/{slug}/prompt.md` file, a task-directory reference, or inline text —
and drafts a concrete implementation plan in plan mode, grounded in the real files, modules,
and build/test/lint commands of your repo. It then launches a **fresh, independent subagent**
that never sees the planning conversation to verify the plan against both the prompt and the
codebase — checking prompt fidelity, internal consistency, groundedness, feasibility, ordering,
and verifiability — and returns a structured findings list. You work those findings **one at a
time**, deciding each resolution, and the plan is updated as you go. Only after you approve does
it persist the verified plan to `.pmf/{slug}/plan.md` — paired as a sibling of its source
prompt — and stop. Implementing the plan is a separate step you initiate.

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
│   └── commands/   prompt, plan, stage, commit
├── README.md
├── CLAUDE.md
└── LICENSE
```

After install, commands are namespaced **`/pmf:<command>`** (e.g. `/pmf:prompt`).

## Caveats

- **Plan, don't implement.** `/pmf:plan` stops at a verified, approved `plan.md`; writing and
  committing the code is a separate step you drive yourself.
- **Independence is the point.** `/pmf:plan`'s verification runs in a fresh subagent with no
  view of the planning conversation — it reports findings, it never silently rewrites the plan.
- **`stage` and `commit`** are general-purpose git helpers bundled alongside the planning
  commands — handy, but not part of the `prompt → plan` flow itself.
