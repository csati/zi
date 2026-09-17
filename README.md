# ZI — prompt-to-plan planning helper

A Claude Code plugin that turns a rough idea into a verified implementation plan through two
context-cleared phases, each producing a reviewable artifact that feeds the next — plus a
one-shot `task` command that runs both phases and the implementation for you:

```
prompt → plan → (you implement)        # /zi:prompt, /zi:plan
prompt → plan → execute → commit       # /zi:task, one shot
```

Every artifact for one feature lives together in a per-task directory `.zi/{ts}-{desc}/`
in your working directory — the directory name is the feature's slug — so the second phase
finds the first automatically (`prompt.md` → `plan.md`).

## The commands

The plugin ships eight slash commands — two planning phases, a one-shot pipeline, a standalone overnight-loop generator, two git helpers, a code locator, and a todo registrar:

| Command | Reads | Produces | Role |
|---------|-------|----------|------|
| `/zi:prompt <desc>` | a rough idea | `.zi/{slug}/prompt.md` | interrogate intent, surface flaws, save a refined prompt |
| `/zi:plan <prompt>` | `.zi/{slug}/prompt.md` or inline text | `.zi/{slug}/plan.md` | draft a plan, independently verify it, persist on approval |
| `/zi:task <idea>` | a rough idea, or a `.zi/{slug}` dir to resume | `prompt.md`, `findings.md`, `plan.md`, `decisions.md` + a commit — or, for oversized work, `phase-NN/` directories each with those three files, a commit and a `commit` marker (plus one top-level `decisions.md`) | run prompt → plan → execute in fresh subagents, relay their questions to you, commit on pass |
| `/zi:overnight <goal>` | a loop GOAL | `.zi/{slug}/overnight.md` | interrogate the goal, generate an unattended never-halt loop-orchestration prompt |
| `/zi:stage <desc>` | your description | staged files | stage files for commit from a natural-language description |
| `/zi:commit` | staged changes | a commit | commit staged changes with a terse single-line message |
| `/zi:locate <desc>` | a description or saved label | code pointers (+ a saved reference) | locate code from a natural-language description, or recall a saved one by label |
| `/zi:todo <concept>` | a concept or a file describing it | `.zi/todo/{ts}-{slug}.md` + a line in `.zi/todo/README.md` | register a todo document and a skimmable record entry (never lists or completes) |

**Clear context between phases.** Each phase's quality comes from a clean context that sees
only the prior artifact. Both planning phases are interactive — you run them, answer their
questions, and approve their output. After `plan` writes `plan.md`, **you implement the code
yourself** — the `prompt → plan` flow stops at the verified plan. **`/zi:task` is the deliberate
exception**: it is the one command with a self-committing back half — it runs the same stages
one-shot and finishes by implementing the plan and committing on the current branch (never
pushing).

### `/zi:prompt` — refine the idea

Interrogates a rough idea until intent is crystal clear: it grounds itself in your codebase
with read-only exploration, asks only the questions the code can't answer, and explicitly
surfaces ambiguities, flaws, side effects, and hidden assumptions for you to resolve. Only once
intent is confirmed and every raised risk is settled does it write a tight, self-contained
spec to `.zi/{slug}/prompt.md` — the single input the next phase reads from a fresh context.
An autonomy hint in the argument (`with high autonomy`, `autonomy: max`) is accepted — the
default is zero, so an unhinted run asks every question as before — and `prompt.md` carries
the resulting `Autonomy:` line that `/zi:plan` reads. The spec ends with a `## Grounding`
manifest — every file it verified, with its role (`read` / `modify` / `create`) and the
symbols or line range that matter — so the plan stage starts from targeted reads instead of
rediscovering the repo.

### `/zi:plan` — draft and verify the plan

Takes a prompt — a `.zi/{slug}/prompt.md` file, a task-directory reference, or inline text —
and drafts a concrete implementation plan in plan mode, grounded in the real files, modules,
and build/test/lint commands of your repo, starting from the prompt's grounding manifest and
ending with its own `## Files` manifest that the verifier and the executor read first. It then launches a **fresh, independent subagent**
that never sees the planning conversation to verify the plan against both the prompt and the
codebase — checking prompt fidelity, internal consistency, groundedness, feasibility, ordering,
and verifiability — and returns a structured findings list. You work those findings **one at a
time**, deciding each resolution unless the autonomy level lets the stage decide it, and the
plan is updated as you go. Only after you approve does
it persist the verified plan to `.zi/{slug}/plan.md` — paired as a sibling of its source
prompt — and stop. Implementing the plan is a separate step you initiate.

### `/zi:task` — the whole pipeline in one shot

Give it a rough idea and it runs the prompt, plan and execute stages **each in a fresh
subagent**, passing nothing between them but `.zi/{slug}/…` paths. Subagents can't ask you
questions directly, so every question a stage raises — the prompt interrogation, the risk
batches, each verification finding, an open decision during implementation — is **relayed** to
you as a normal `AskUserQuestion` and your answer is sent back to the same agent; nothing else
in the pipeline needs you. The plan is drafted to `plan.draft.md`, independently verified by a
read-only subagent that writes `findings.md`, and becomes `plan.md` once the last finding is
resolved. There is no gate after the prompt stage and exactly one verification pass: as soon
as `plan.md` exists the execute agent implements it, runs the plan's verification commands, and
on pass **commits the implementation paths on the current branch** (never `.zi/` artifacts,
never a push) with a terse single-line message. On failure the same agent gets exactly one
fix round; if that doesn't make verification pass the work is staged, not committed, and
you're told which command failed.

**A run is never silent between questions.** The orchestrator prints a status checklist at
every stage boundary — which stage is running, what each finished stage produced (an artifact
path or a commit hash), and for phased runs one row per phase with only the running phase
expanded — so you always know where the pipeline is.

**How much it decides on its own is a dial.** Add a hint to the argument — `with high
autonomy`, `autonomy: max`, `full autonomy`, `autonomy=low` — to set one of five levels:
`zero` (aliases `no`, `min`), `low`, `medium`, `high` or `max` (alias `full`); without a hint
`/zi:task` runs at **medium**. For every decision a stage scores how much of the repo it
touches, how hard it would be to reverse and how sure it is that one answer is best, and
decides it itself only when that score is within the level — otherwise the question is relayed
to you. Every self-decision is recorded with its factors and score as a `Decided (auto):` line
in `prompt.md`, `plan.md` or the commit body, so nothing is decided invisibly; the prompt
stage's restatement of your idea is always asked, at every level.

**Every decision is on the record.** Each task run keeps one `.zi/{slug}/decisions.md` (a
single top-level file, also for phased runs), appended to by the prompt, plan and execute
agents: one titled record per resolved decision, saying who resolved it, the question and your
answer when it was you, and the blast-radius, commitment, confidence and score values with a
line of reasoning each — so the run's decision history can be read afterwards. The verifier
never touches it, and the interactive commands (`/zi:prompt`, `/zi:plan`) write none.

**Big jobs are split into phases.** While it grounds the idea, the prompt stage estimates how
much context the implementation will need (the size of every file it must read or change,
converted to tokens, times three for tool output, tests and iteration). If the total exceeds
200K tokens the work is cut into ordered, self-contained phases of at most 100K each, and you
are asked to **confirm the phase list** — one line per phase with its scope and estimate —
unless the autonomy level lets the stage decide it, before anything is written. Each phase then gets its own `.zi/{slug}/phase-NN/prompt.md` (instead of a
top-level `prompt.md`) and is planned, verified, executed and **committed on its own, one phase
after another**, with a `phase-NN/commit` marker recording each hash. If a phase fails after its
one fix round the run **halts**: later phases never start, earlier commits stay on the branch,
and the failing phase's work is left staged. Smaller jobs are untouched by this — a single
`prompt.md`, one chain, one commit — and `/zi:prompt` never estimates or phases anything.

Pass a `.zi/{slug}` directory (or bare slug) instead of an idea to **resume** at the first
missing artifact: `prompt.md` only → planning; a lone `plan.draft.md` → re-verify; `plan.md` →
execution; an empty directory → it asks for the idea. A phased task resumes at the lowest
`phase-NN/` without a `commit` marker and applies the same rules inside it, then carries on with
the later phases. **Start `/zi:task` from a fresh session** — the orchestrator's context should
hold nothing but the run.

`/zi:prompt`, `/zi:plan` and `/zi:task` all read the same stage text from `plugins/zi/stages/`,
so the interactive commands and the pipeline cannot drift apart; the verifier gets its own
`verify.md` so it never reads — or pays for — the planner's text.

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

### `/zi:todo` — register a todo

Takes a concept — inline text, or a path to a file describing it — rephrases it, proposes a short
slug and a 1–2 word effort guess, and asks exactly **one** confirm/revise question (revise loops
until you confirm; nothing is written before that). It then writes exactly two things: a todo
document `.zi/todo/{ts}-{slug}.md` (frontmatter with `created`, `source` and `effort`, the
confirmed rephrasing, and grounded `path:line — why` pointers only when the concept points at
real code) and one appended checkbox line in the record file `.zi/todo/README.md`, of the form
`` - [ ] `{ts}-{slug}.md` — <brief description> — effort: <1–2 words> ``. The record file is
the skimmable index; it is appended to, never rewritten, so boxes you tick by hand survive.

It is **not a prompt and not a plan**: it never interrogates intent, surfaces risks, plans, or
touches repo files, and it never lists, completes, or edits todos. To act on a todo later, hand
the document's path to `/zi:prompt` as a file path or paste its text into `/zi:task`; **never
pass `.zi/todo` as a task directory**, and don't point `/zi:plan` at a todo document.

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

With a marketplace added from a local directory, the plugin is loaded from that directory:
edits and new files under `plugins/zi/` reach the next session (or the current one after
`/reload-plugins`) with no reinstall. Git-hosted installs run from a copy under
`~/.claude/plugins/cache/` and pick up changes via `/plugin marketplace update` +
`/plugin update zi@ncs-plugins` — bump `version` in `plugin.json` when shipping. If you change
`marketplace.json` or `plugin.json`, run `/plugin marketplace update`.

## Contents

```
zi/                                   ← repo root = the "ncs-plugins" marketplace
├── .claude-plugin/marketplace.json    ← the catalog (lists the zi plugin)
├── plugins/zi/                       ← the plugin itself
│   ├── .claude-plugin/plugin.json
│   ├── commands/   prompt, plan, task, overnight, stage, commit, locate, todo
│   └── stages/     prompt, plan, verify, execute   ← shared stage text read by prompt, plan and task
├── README.md
├── CLAUDE.md
└── LICENSE
```

After install, commands are namespaced **`/zi:<command>`** (e.g. `/zi:prompt`).

## Caveats

- **Plan, don't implement — except `/zi:task`.** `/zi:plan` stops at a verified, approved
  `plan.md`; writing and committing the code is a separate step you drive yourself. `/zi:task`
  is the deliberate exception: it implements the plan and commits on the current branch (never
  pushes), so invoke it only when that is what you want.
- **Independence is the point.** `/zi:plan`'s verification runs in a fresh subagent with no
  view of the planning conversation — it reports findings, it never silently rewrites the plan.
- **`stage`, `commit`, `locate`, and `todo`** are general-purpose helpers bundled alongside the
  planning commands — handy, but not part of the `prompt → plan` flow itself. `locate` is read-only
  for your repo (it only writes recallable references under `.zi/location/`), and `todo` writes
  only under `.zi/todo/`.
