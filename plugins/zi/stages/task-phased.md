# `/zi:task` — phased runs

The `/zi:task` orchestrator reads this file only when a run turns phased (a prompt-stage DONE
naming several `phase-NN/prompt.md` paths, or a `.zi/{slug}` resume whose `Glob` finds
`phase-*/`); it is never passed to a subagent.

### Phased resume

Sort the `phase-NN` directories lexically and pick the **lowest-numbered one without a
`commit` file** (`.zi/{slug}/phase-NN/commit`). Inside it apply task.md's flat per-artifact
resume rules (Argument rule 2) — `prompt.md` only → plan stage; a lone `plan.draft.md` →
re-verify; `plan.md` → execute stage (under `MANUAL = on`, task.md's manual stop) — with
every path rewritten as in the "Phased flow" section below, then continue the phased flow with every later phase in order. If every phase
carries `commit` → report that the task is complete; nothing runs. A phase directory
**without `prompt.md`** is never routed to the "ask for the idea" rule (that would start an
unrelated flat task): report the task as malformed, naming that directory, and stop.

### Phased shape

Once the prompt stage's DONE names several `phase-NN/prompt.md` paths (or a resumed `.zi/{slug}`
is found phased), the list switches to the phased shape:

- the top-level `prompt` row stays, `[x]`, carrying the paths the payload named,
  comma-separated (or, on resume, the `phase-NN/prompt.md` paths `Glob` found);
- then one row per `phase-NN` in sorted order: `- [x] phase-NN → <hash>` for a phase whose
  `commit` marker exists or was just written, `- [>] phase-NN` for the running phase,
  `- [ ] phase-NN` for later phases, `- [!] phase-NN → failed` for a phase that halted the run;
- only the running (or halted) phase is expanded: its stage rows — `plan (draft)`, `verify`,
  `plan (interrogate)`, `execute`, `commit` — are indented one level under its
  `[>] phase-NN` row and follow task.md's flat rules; every other phase is a single row, so
  scrollback stays short for many-phase runs;
- writing `P/commit` is **not** a transition of its own: on a phase's `RESULT: pass <hash>`
  write `P/commit` first, and the pass-DONE print then already shows that phase collapsed to
  `- [x] phase-NN → <hash>`; the next phase's expansion first appears on its plan-spawn print.
  The three transition kinds in task.md therefore remain the only ones.

A phased run, printed right after the second phase's verifier spawn:

```
- [x] prompt → .zi/20260101-000000-example/phase-01/prompt.md, .zi/20260101-000000-example/phase-02/prompt.md, .zi/20260101-000000-example/phase-03/prompt.md
- [x] phase-01 → 1a2b3c4
- [>] phase-02
  - [x] plan (draft) → .zi/20260101-000000-example/phase-02/plan.draft.md
  - [>] verify — verifying
  - [ ] plan (interrogate)
  - [ ] execute
  - [ ] commit
- [ ] phase-03
```

### Phased flow

A phased task has no top-level `prompt.md`; each phase directory holds its own four artifacts,
in full:

- `.zi/{slug}/phase-NN/prompt.md` — written by the prompt stage;
- `.zi/{slug}/phase-NN/plan.draft.md` — the plan stage's DRAFT;
- `.zi/{slug}/phase-NN/findings.md` — the verifier's output;
- `.zi/{slug}/phase-NN/plan.md` — the persisted plan the execute stage implements;

plus the orchestrator's one-line marker `.zi/{slug}/phase-NN/commit`. Below, `P` is shorthand
for `.zi/{slug}/phase-NN`. The audit file is not among them: it is the **top-level**
`.zi/{slug}/decisions.md` for the whole task, the prompt stage's DONE never names it, and the
checklist tracks no such artifact.

1. For each phase directory `P`, **strictly in order**, run the plan stage and the execute
   stage **exactly as written in task.md's Plan stage and Execute stage sections**, with every
   `.zi/{slug}/<artifact>` path replaced by `P/<artifact>`: prompt path `P/prompt.md`, DRAFT
   `P/plan.draft.md`, verifier output `P/findings.md`, PERSIST → `P/plan.md`, execute plan
   path `P/plan.md` — the AUDIT binding is the one path **not** rewritten: in every phase spawn
   (plan, verifier's off-limits clause, execute) it stays the top-level
   `.zi/{slug}/decisions.md`, the single top-level path a phase's agents receive; no other
   phase's artifact path ever crosses a boundary. Each phase gets fresh agents (plan,
   verifier, execute); the fenced `@P/plan.md` block is printed per phase with the actual
   path; each phase's execute agent commits on its own under the unchanged execute-stage
   rules — one commit per phase. Whenever those stages say to re-print the checklist, the
   checklist is in its phased shape and the running phase is the expanded one. Under
   `MANUAL = on` the execute stage of the current phase is task.md's manual stop with
   `P/plan.md` as the plan path; the run ends there and later phases are not started (the
   printed resume command continues them — a phase committed by `/zi:mentor` carries `P/commit`
   and is skipped exactly like an executed one).
2. **Commit marker**: on a phase's `RESULT: pass <hash>` write the one-line file `P/commit`
   containing the hash (this marker and the flat `.zi/{slug}/commit` marker of task.md's Execute
   stage are the only files the orchestrator ever writes, and it never reads either back —
   resume checks their presence with `Glob` only) **before** the pass-DONE
   re-print — that print already shows the phase collapsed to `- [x] phase-NN → <hash>`; the
   marker write gets no print of its own. Then start the next phase.
3. **Halt**: on a phase's `RESULT: fail` (which arrives only after the user stopped that
   phase's fix loop, or its verification could not run) stop — never start a later phase.
   That fail DONE's re-print shows the phase row `[!]` with its inner rows as the fail left
   them — no separate halt print. Then report the failing phase directory `P`, the `COMMAND`,
   that the `CHANGED` paths are **staged, not committed**, that earlier phases' commits stay
   on the branch, and the resume command `/zi:task .zi/{slug}`.
4. After the last phase passes — its pass-DONE re-print shows every phase `[x]` — report the
   list of phase plan paths (`P/plan.md`) and their commit hashes, in order. Done.
