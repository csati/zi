# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`pmf` is a **Claude Code plugin**, not an application. It has no build, no test runner, and
no dependencies. The repo is **self-contained**: its root is a one-plugin marketplace
(`.claude-plugin/marketplace.json`, name `ncs-plugins`) and the plugin lives in `plugins/pmf/`.
The plugin ships two kinds of artifact:

- **Slash commands** — `plugins/pmf/commands/*.md`, each a Markdown file with YAML frontmatter.
  These ARE the product: the body is the prompt Claude executes when the command is invoked.
- **One workflow script** — `plugins/pmf/workflows/backhalf.js`, JavaScript run by the `Workflow`
  tool (not by Node), which orchestrates subagents.

Editing any command `.md` is picked up live by an installed plugin — no rebuild. There is
nothing to compile or lint; "testing" a change means installing the plugin and running the
command.

## Install / validate / develop

The repo root is the marketplace; `plugins/pmf/` is the plugin. For local development add the
repo itself as a marketplace:

```
/plugin marketplace add /Users/ncs/dev/claude/plugins/pmf   # register this repo as a marketplace
/plugin install pmf@ncs-plugins                             # install the plugin
/plugin validate /Users/ncs/dev/claude/plugins/pmf          # validate before installing
```

To share with colleagues, push the repo to a git host; they run `/plugin marketplace add
<owner>/pmf` then `/plugin install pmf@ncs-plugins`. Relative plugin sources resolve only when
the marketplace is added over git or a local path — not via a bare URL to `marketplace.json`.

After install, commands are namespaced **`/pmf:<command>`** (e.g. `/pmf:prompt`). Command
`.md` edits apply live; if you change `marketplace.json` or `plugin.json`, run
`/plugin marketplace update`.

## The core architecture: a slug-linked, context-cleared pipeline

The plugin turns a rough idea into shipped code through a chain of phases, each run with a
**fresh/cleared context** so it sees only the prior artifact, not the whole history. The phases
find each other through one convention — **every artifact for one feature shares a
`{ts}-{desc}` slug** (`ts` = `YYYYMMDD-HHmmss`, `desc` = 1–4 word kebab slug):

```
prompt-{slug}.md → brief-{slug}.md → prd-{slug}.md → plan-{slug}-stage-{NN}.md → finalize-{slug}.md
   /pmf:prompt       /pmf:research      /pmf:prd          /pmf:decompose            /pmf:finalize
```

Review gates (`/pmf:doublecheck`) sit between produce-phases and edit the prior artifact
**in place**. `/pmf:pipeline` is a read-only conductor that inspects which artifacts exist for a
slug and reports the next command; `/pmf:implement-all` runs the automated back half.

The slug is load-bearing. When a command produces the next artifact, it **reuses the source
file's `{ts}-{desc}` verbatim** (only generating a fresh timestamp when the source name doesn't
match the pattern). Preserve this when editing any produce-phase command — breaking the slug
breaks how every downstream phase locates its inputs.

### Phase responsibilities

| Command | Reads | Writes | Role |
|---|---|---|---|
| `/pmf:prompt` | rough idea | `prompt-{slug}.md` | interrogate intent, surface flaws, save refined prompt |
| `/pmf:research` | `prompt-*` or inline | `brief-{slug}.md` | ground in codebase, produce research brief |
| `/pmf:prd` | `brief-*` | `prd-{slug}.md` | testable FRs, non-goals, constraints |
| `/pmf:decompose` | `prd-*` | `plan-{slug}-stage-{NN}.md` | split into ordered, self-contained, ~50K-token stages |
| `/pmf:doublecheck` | brief / PRD / plan set | edits in place | verify against source + codebase, one flaw at a time |
| `/pmf:implement-all` | `prd-*` + stages | code + commits | launch `backhalf.js` |
| `/pmf:finalize` | `prd-*` | optional `finalize-*` | verify whole feature against PRD, report gaps |
| `/pmf:pipeline` | all artifacts | nothing | read-only conductor; reports next step |

`commit` and `stage` are general-purpose git helpers bundled with the plugin — handy, but not
pipeline phases.

## How commands are written (conventions to match when editing)

Each `plugins/pmf/commands/*.md` is frontmatter + a prompt body. Match the existing structure:

- **Frontmatter** — `description` (shown in the picker), `argument-hint`, and `allowed-tools`.
  `allowed-tools` is a real permission boundary: list only what the command needs, scoped
  (e.g. `Bash(date:*)`, `Bash(git:*)`). A command can't use a tool it doesn't declare.
- **`$ARGUMENTS`** — placeholder the body uses to receive the invocation argument. Most
  produce-commands resolve it: if it's a path use it, else glob for the expected prefix
  (`prd-*.md` etc.) and act on zero/one/many.
- **Inline bash** — `` !`date +%Y%m%d-%H%M%S` `` executes at command-run time to stamp filenames;
  this is why `Bash(date:*)` appears in `allowed-tools`.
- **Produce-phase shape** — these commands follow a strict interrogation discipline:
  interrogate → surface flaws and resolve each WITH the user → only then write the output file.
  "Never write the output early / just in case" is a recurring guardrail; preserve it.

## The back-half workflow engine (`plugins/pmf/workflows/backhalf.js`)

Launched by `/pmf:implement-all` via the `Workflow` tool, referenced as
`${CLAUDE_PLUGIN_ROOT}/workflows/backhalf.js` so the plugin is path-portable. Key constraints
baked into its design — keep them if you modify it:

- **No filesystem access.** The script cannot glob, so `/pmf:implement-all` must pass the
  **ordered** stage list and PRD path in `args` (`args.stages`, `args.prd`). The script trusts
  that ordering.
- **Strictly sequential, never parallel.** Each stage assumes the committed repo state the
  previous stage left behind. One fresh `agent()` per stage, in order.
- **Halt on conflict.** Each stage agent verifies preconditions against the real repo first; if
  a precondition is false it returns `status: "conflict"` and stops without editing. The loop
  halts immediately and reports — it never forces a stale plan onto the next stage.
- **Structured returns.** Agents are forced to a JSON schema (`STAGE_RESULT`, `FINALIZE_REPORT`)
  so results are validated data, not prose. The finalize agent only reports gaps; it does not fix.

## Cross-cutting principles encoded in these commands

These are deliberate and repeated across the command set; honour them when adding or editing
commands:

- **Stages describe intent, not source.** Plan files state target interfaces and acceptance
  criteria; the implementing agent writes actual code against the live repo, which may have
  drifted. Never paste final source into a stage.
- **Ground every claim in the codebase.** Commands use `Read`/`Grep`/`Glob` to verify that
  referenced paths/APIs exist before asserting them — nothing hallucinated or stale.
- **Green between stages.** No stage may leave the build or tests broken for the next fresh agent.
- **Report vs. fix is a hard line.** `doublecheck` and `finalize` surface and recommend; they get
  explicit user confirmation before any code change. `implement-all` is the only unattended phase
  and the only one that commits code.
