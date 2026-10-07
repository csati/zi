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

The plugin ships ten slash commands — two planning phases, a one-shot pipeline, a step-by-step plan mentor, a standalone overnight-loop generator, two git helpers, a code locator, a todo registrar, and a todo compactor:

| Command | Reads | Produces | Role |
|---------|-------|----------|------|
| `/zi:prompt <desc>` | a rough idea | `.zi/{slug}/prompt.md` | interrogate intent, surface flaws, save a refined prompt |
| `/zi:plan <prompt>` | `.zi/{slug}/prompt.md` or inline text | `.zi/{slug}/plan.md` | draft a plan, independently verify it, persist on approval |
| `/zi:task <idea>` | a rough idea, or a `.zi/{slug}` dir to resume | `prompt.md`, `findings.md`, `plan.md`, `decisions.md` + a commit and a `commit` marker — or, for oversized work, `phase-NN/` directories each with those three files, a commit and a `commit` marker (plus one top-level `decisions.md`) | run prompt → plan → execute in fresh subagents, relay their questions to you, commit on pass |
| `/zi:mentor <plan>` | a `plan.md`, a `.zi/{slug}` dir or a bare slug | a commit + the `commit` marker beside the plan | tutor you through implementing the plan yourself, one step at a time, then verify and commit |
| `/zi:overnight <goal>` | a loop GOAL | `.zi/{slug}/overnight.md` | interrogate the goal, generate an unattended never-halt loop-orchestration prompt |
| `/zi:stage <desc>` | your description | staged files | stage files for commit from a natural-language description |
| `/zi:commit [desc]` | staged changes, or the working-tree changes your description names | a commit | commit what is staged, or exactly the existing changes matching a description, with a terse subject plus a short body only when the diff needs explaining; never edits files |
| `/zi:locate <desc>` | a description or saved label | code pointers (+ a saved reference) | locate code from a natural-language description, or recall a saved one by label |
| `/zi:todo <concept>` | a concept or a file describing it | `.zi/todo/{ts}-{slug}.md` + a line in `.zi/todo/README.md` | register a todo document and a skimmable record entry (never lists or completes); the document ends with a cleanup instruction for its implementer |
| `/zi:todo-compact` | `.zi/todo/` documents + the codebase | deleted / trimmed todo documents and updated lines in `.zi/todo/README.md` | check each todo against the codebase and, after one confirmation, delete done ones and trim partial ones to their remaining work |

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
in the pipeline needs you. The prompt stage's mutually independent clarification questions
arrive together (up to four in one question) once the restatement of your idea is confirmed on
its own, while `/zi:prompt` still asks them one at a time. The plan is drafted to `plan.draft.md`, independently verified by a
read-only subagent that writes `findings.md`, and becomes `plan.md` once the last finding is
resolved. There is no gate after the prompt stage and exactly one verification pass: as soon
as `plan.md` exists the execute agent implements it, runs the plan's verification commands, and
on pass **commits the implementation paths on the current branch** (never `.zi/` artifacts,
never a push) with a terse single-line message. On failure the same agent keeps fixing and
re-running verification in rounds until it passes; when a round stalls on the same error, or
after 10 rounds, it asks you whether to continue fixing (another 10 rounds, with any guidance
you give) or stop. Only when you answer Stop is the work staged, not committed, and you're
told which command failed.

**Or implement it yourself.** Add `manual execution` (or `execution: manual`,
`execution=manual`) to the argument and the run prints `Execution: manual` first, then goes
unchanged up to the verified `plan.md` — and stops there instead of implementing. It prints
three fenced lines: the `@…/plan.md` mention, `/zi:mentor <plan path>` to work through the plan
yourself, and the resume command `/zi:task .zi/<slug> manual execution` (plus your autonomy hint,
if you gave one). The mode is not persisted anywhere — the printed resume command carries it.
In a phased run each phase stops the same way; once `/zi:mentor` has committed a phase, the
resume command picks up the next one.

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
after another**, with a `phase-NN/commit` marker recording each hash. If you stop a phase's fix
loop the run **halts**: later phases never start, earlier commits stay on the branch,
and the failing phase's work is left staged. Smaller jobs are untouched by this — a single
`prompt.md`, one chain, one commit — and `/zi:prompt` never estimates or phases anything.

Pass a `.zi/{slug}` directory (or bare slug) instead of an idea to **resume** at the first
missing artifact: `prompt.md` only → planning; a lone `plan.draft.md` → re-verify; `plan.md` →
execution; a `commit` marker → the task is complete (a flat pass writes `.zi/{slug}/commit`);
an empty directory → it asks for the idea. A phased task resumes at the lowest
`phase-NN/` without a `commit` marker and applies the same rules inside it, then carries on with
the later phases. **Start `/zi:task` from a fresh session** — the orchestrator's context should
hold nothing but the run.

`/zi:prompt`, `/zi:plan` and `/zi:task` all read the same stage text from `plugins/zi/stages/`,
so the interactive commands and the pipeline cannot drift apart; the verifier gets its own
`verify.md` so it never reads — or pays for — the planner's text.

### `/zi:mentor` — implement the plan yourself, step by step

Give it a `plan.md`, a `.zi/{slug}` task directory or a bare slug (for a phased task it takes the
lowest phase without a `commit` marker). It splits the plan into small ordered steps and, for
each one, tells you what to change, where and why, then asks: **Done — check it**, **Give me a
hint**, or **Apply the fix for me**. On "Done" it reviews your diff against the step and the
plan's acceptance criteria; a hint never writes the code for you; only "Apply the fix for me"
lets it edit, and only for the current step. Uncommitted work is picked up where it left off.
After the last step it asks you to stash anything unrelated, runs the plan's verification once,
stages the changed paths by name (never `.zi/`), **commits on the current branch** (never
pushes) and — for a plan under `.zi/` — writes the `commit` marker beside it, so
`/zi:task .zi/<slug> manual execution` continues with the next phase.

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
Every document ends with a `## When done` section telling whoever implements the todo how to
clean it up: full success → delete the document and its record line; partial → trim the
document to the remaining work and update its record line; nothing landed → leave both
untouched; in doubt → treat it as partial.

It is **not a prompt and not a plan**: it never interrogates intent, surfaces risks, plans, or
touches repo files, and the command itself never lists, completes, or edits todos — the
implementer performs the cleanup by following the document's `## When done` section, or
`/zi:todo-compact` does it in bulk across the whole store. To act on
a todo later, hand the document's path to `/zi:prompt` as a file path or paste its text into
`/zi:task`; **never pass `.zi/todo` as a task directory**, and don't point `/zi:plan` at a todo
document.

### `/zi:todo-compact` — prune done todos

Takes no argument. Checks every todo document under `.zi/todo/` (everything but `README.md`)
against the current codebase with bounded read-only evidence — the document's pointers and the
paths and symbols it names, plus `git log` as supporting evidence — and gives each a verdict:
**done** (every part has concrete evidence) → the document is deleted and its record line
removed; **partial** → the document is trimmed in place to the remaining work, its pointers
re-checked, `effort` and the record line updated; **untouched** → nothing changes. In doubt, a
document is treated as partial: only parts with concrete evidence of completion are removed.
A trimmed document gains no "Done" or "Progress" section — done work simply disappears from it.

All verdicts are put to you in exactly **one** apply/cancel question; nothing is written or
deleted before you pick *Apply*, and when nothing would change it just prints the list. It
writes only under `.zi/todo/`, never commits, and deliberately does not pre-approve `rm`, so
each deletion goes through your normal permission prompt.

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
│   ├── commands/   prompt, plan, task, mentor, overnight, stage, commit, locate, todo, todo-compact
│   └── stages/     prompt, plan, verify, execute   ← shared stage text read by prompt, plan and task
├── README.md
├── CLAUDE.md
└── LICENSE
```

After install, commands are namespaced **`/zi:<command>`** (e.g. `/zi:prompt`).

## Caveats

- **Plan, don't implement — except `/zi:task` and `/zi:mentor`.** `/zi:plan` stops at a
  verified, approved `plan.md`; writing and committing the code is a separate step you drive
  yourself. `/zi:task` is the deliberate exception: it implements the plan and commits on the
  current branch (never pushes), so invoke it only when that is what you want. `/zi:mentor`
  commits too, at the end of a loop you drive.
- **Independence is the point.** `/zi:plan`'s verification runs in a fresh subagent with no
  view of the planning conversation — it reports findings, it never silently rewrites the plan.
- **`stage`, `commit`, `locate`, `todo`, and `todo-compact`** are general-purpose helpers bundled
  alongside the planning commands — handy, but not part of the `prompt → plan` flow itself.
  `locate` is read-only for your repo (it only writes recallable references under
  `.zi/location/`), and `todo` and `todo-compact` write only under `.zi/todo/`.
