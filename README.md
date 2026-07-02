# ZI — prompt-to-plan planning helper

A Claude Code plugin that turns a rough idea into a verified implementation plan through two
context-cleared phases, each producing a reviewable artifact that feeds the next:

```
prompt → plan → (you implement)
```

Every artifact for one feature lives together in a per-task directory `.zi/{ts}-{desc}/`
in your working directory — the directory name is the feature's slug — so the second phase
finds the first automatically (`prompt.md` → `plan.md`).

## The commands

The plugin ships six slash commands — two planning phases, a standalone overnight-loop generator, two git helpers, and a code locator:

| Command | Reads | Produces | Role |
|---------|-------|----------|------|
| `/zi:prompt <desc>` | a rough idea | `.zi/{slug}/prompt.md` | interrogate intent, surface flaws, save a refined prompt |
| `/zi:plan <prompt>` | `.zi/{slug}/prompt.md` or inline text | `.zi/{slug}/plan.md` | draft a plan, independently verify it, persist on approval |
| `/zi:overnight <goal>` | a loop GOAL | `.zi/{slug}/overnight.md` | interrogate the goal, generate an unattended never-halt loop-orchestration prompt |
| `/zi:stage <desc>` | your description | staged files | stage files for commit from a natural-language description |
| `/zi:commit` | staged changes | a commit | commit staged changes with a terse single-line message |
| `/zi:locate <desc>` | a description or saved label | code pointers (+ a saved reference) | locate code from a natural-language description, or recall a saved one by label |

**Clear context between phases.** Each phase's quality comes from a clean context that sees
only the prior artifact. Both planning phases are interactive — you run them, answer their
questions, and approve their output. After `plan` writes `plan.md`, **you implement the code
yourself** — the plugin stops at the verified plan; there is no automated, self-committing
back-half.

### `/zi:prompt` — refine the idea

Interrogates a rough idea until intent is crystal clear: it grounds itself in your codebase
with read-only exploration, asks only the questions the code can't answer, and explicitly
surfaces ambiguities, flaws, side effects, and hidden assumptions for you to resolve. Only once
intent is confirmed and every raised risk is settled does it write a tight, self-contained
spec to `.zi/{slug}/prompt.md` — the single input the next phase reads from a fresh context.

### `/zi:plan` — draft and verify the plan

Takes a prompt — a `.zi/{slug}/prompt.md` file, a task-directory reference, or inline text —
and drafts a concrete implementation plan in plan mode, grounded in the real files, modules,
and build/test/lint commands of your repo. It then launches a **fresh, independent subagent**
that never sees the planning conversation to verify the plan against both the prompt and the
codebase — checking prompt fidelity, internal consistency, groundedness, feasibility, ordering,
and verifiability — and returns a structured findings list. You work those findings **one at a
time**, deciding each resolution, and the plan is updated as you go. Only after you approve does
it persist the verified plan to `.zi/{slug}/plan.md` — paired as a sibling of its source
prompt — and stop. Implementing the plan is a separate step you initiate.

### `/zi:overnight` — generate an overnight loop prompt

Interrogates a loop GOAL with the same produce-phase discipline — grounds in your repo to detect
its stack, asks only what the code can't answer, recommends a verification gate, and surfaces the
autonomy risks of an unattended run — then writes a self-contained, generalized
loop-orchestration prompt to `.zi/{slug}/overnight.md`. It produces a **prompt only** and never
runs the loop; the output is deliberately named `overnight.md` (not `prompt.md`) so `/zi:plan`
won't treat it as a plannable pipeline prompt.

### `/zi:locate` — point me at the code

Turns a natural-language description (a behavior, concept, or partial symbol) into precise code
pointers — file path, line, enclosing class/module, and symbol — grounded by real `Glob`/`Grep`/`Read`
(escalating to a read-only `Explore` subagent when a few grep rounds don't narrow it), never a
guessed path. It is **read-only for your repo**; the only thing it writes is a small reference under
`.zi/location/` so you can recall the result later by a short label
(`/zi:locate jwt-validator`). Use it to be *pointed at* code, not to have it explained or changed —
it's a lookup helper, not part of the `prompt → plan` flow.

## Install

This repo is **self-contained**: its root is a one-plugin marketplace named `ncs-plugins`
(`.claude-plugin/marketplace.json`), and the plugin itself lives in `plugins/zi/`.

### Share with colleagues (git-hosted)

Push this repo to a git host, then anyone adds it as a marketplace and installs the plugin:

```
/plugin marketplace add <owner>/zi        # GitHub owner/repo shorthand, or a full git URL
/plugin install zi@ncs-plugins
```

`ncs-plugins` is the marketplace name; `zi` is the plugin within it. Relative plugin sources
only resolve when the marketplace is added **over git** (or a local path) — not via a bare URL
to `marketplace.json`, which downloads only the catalog and none of the plugin files.

### Local development

```
/plugin marketplace add /path/to/zi   # this repo, as a local marketplace
/plugin install zi@ncs-plugins
```

Validate first if you like: `/plugin validate /path/to/zi`.

Editing the command `.md` files under `plugins/zi/commands/` is picked up live. If you change
`marketplace.json` or `plugin.json`, run `/plugin marketplace update`.

## Contents

```
zi/                                   ← repo root = the "ncs-plugins" marketplace
├── .claude-plugin/marketplace.json    ← the catalog (lists the zi plugin)
├── plugins/zi/                       ← the plugin itself
│   ├── .claude-plugin/plugin.json
│   └── commands/   prompt, plan, overnight, stage, commit, locate
├── README.md
├── CLAUDE.md
└── LICENSE
```

After install, commands are namespaced **`/zi:<command>`** (e.g. `/zi:prompt`).

## Caveats

- **Plan, don't implement.** `/zi:plan` stops at a verified, approved `plan.md`; writing and
  committing the code is a separate step you drive yourself.
- **Independence is the point.** `/zi:plan`'s verification runs in a fresh subagent with no
  view of the planning conversation — it reports findings, it never silently rewrites the plan.
- **`stage`, `commit`, and `locate`** are general-purpose helpers bundled alongside the planning
  commands — handy, but not part of the `prompt → plan` flow itself. `locate` is read-only for your
  repo (it only writes recallable references under `.zi/location/`).
