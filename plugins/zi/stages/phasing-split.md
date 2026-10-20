The prompt stage reads this file under PHASING on only when the total estimate exceeds 200K —
it holds the phase-split step and the per-phase file rules.

## Phase-split step

a. Partition the implementation into ordered phases, each a self-contained slice that leaves
   the repo working (later phases build on earlier commits). Estimate each phase with the
   estimate rule in `phasing-estimate.md`; any phase above 200K is split further until every
   phase is ≤200K. If a phase cannot be cut to ≤200K (a single file it must read already
   exceeds the budget), raise that as a risk in Phase-2 form (accept the oversized phase /
   mitigate), scored like any Phase-2 risk, instead of silently exceeding it.
b. Confirm the proposed list. It is scored like any decision: at a score ≤ setting
   self-confirm it and record `Decided (auto):`; otherwise put it to the user via **ASK** —
   the question text carries one line per phase in execution order —
   `phase-NN: <one-line scope> (~<N>K)` — plus the total, and ends with a question; the
   options are "Confirm the phase list (Recommended)" and "Revise" (free text describes
   the change) — and loop until the user confirms. Nothing is written before the list is
   confirmed, by the user or by a recorded score — the list is the
   cross-phase coverage check: each phase's verifier sees only its own phase prompt.
c. Write one file per confirmed phase, named exactly
   `.zi/{YYYYMMDD-HHmmss}-{description}/phase-NN/prompt.md`, `NN` two-digit zero-padded
   from `01` (`phase-10`, `phase-11`, … beyond nine), in one uninterrupted pass in
   execution order — the phase set is durable only once the stage reports DONE. A phased
   task has **no** top-level `prompt.md`.
   Under AUDIT on, the one-pass audit write of `prompt.md`'s Phase 3 step 3 precedes the
   first phase file; the audit file stays top-level, never inside a `phase-NN/` directory.

## Per-phase files (PHASING on, phased)

When the work is phased, each `.zi/{slug}/phase-NN/prompt.md` is itself a complete spec of
the form in `prompt.md`'s Output file contents section, with these additions:

- the heading names the phase and the count (`… — phase N of M`);
- the first load-bearing lines state what earlier phases are assumed to have landed (phase 01
  says it assumes nothing);
- the `Autonomy:` line is restated verbatim in every phase file, alongside the decision lines;
- every `Decided (user):` / `Decided (auto):` line that constrains the phase is restated
  verbatim in that phase file;
- the sentence budget (20 + one per decision line present in *that* file) applies per file;
- the fixed-form `Estimate:` line carries the phase's own figure and the 200K threshold —
  `Estimate: <bytes> B ÷ 4 × 3 ≈ <N>K tokens (threshold 200K)`; like the heading it does not
  count toward the budget;
- the `## Grounding` section carries **only that phase's slice** of the manifest — the
  entries the phase reads, modifies or creates, with the role as seen from that phase (a file
  phase 01 creates and phase 02 extends is `create` in 01 and `modify` in 02). An entry may
  recur across phases; the phase's `Estimate:` is summed over its own slice, and the union of
  all slices is the full manifest — so a phase's agents never rediscover files that belong to
  another phase;
- every other rule of `prompt.md`'s Output file contents section (self-contained, verified
  anchors, load-bearing sentences, bold labels optional) applies unchanged to each file.
