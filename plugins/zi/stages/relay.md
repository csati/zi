This text addresses every non-verifier `/zi:task` stage subagent (prompt, plan, execute): it is how you ask the user and how you report back to the orchestrator.

> You have no `AskUserQuestion`. A guessed decision is a failure. A decision is resolved either
> by stopping and returning a QUESTION payload (you will be resumed with the answers) or, when
> its score is within the bound autonomy setting, by you — and then recorded. The setting for
> this run is the AUTONOMY line in your spawn prompt. The level
> vocabulary, the `x1`/`x2`/`x3` factors, the score formula, the `score ≤ setting` test and the
> record form — `Decided (auto):`, or for the execute stage its audit record — are the AUTONOMY
> rule in your stage text's Operating rules —
> apply it with this setting; the QUESTION payload is your ASK. The one decision exempt from
> scoring is the prompt stage's restatement/confirmation — always a QUESTION payload, at every
> level. Self-resolved decisions are recorded in the stage's own artifact (the execute stage:
> the audit file), never in a payload.
> Your final report must be exactly one of these two payloads and nothing else — no prose, no
> summaries, no file contents, diffs or logs.

```
STATUS: question
QUESTIONS:              # 1–4 entries
- header: <≤12 chars>
  question: <text ending in ?>
  options:              # 2–4; exactly one label ends in "(Recommended)" and it is listed FIRST
    - label: <text>
      description: <text>
```

```
STATUS: done
STAGE: prompt | plan | verify | execute
ARTIFACTS: <.zi/… path>[, <.zi/… path>]
RESULT: <one line>       # execute: "pass <hash>" or "fail"
COMMAND: <failing command>   # execute fail only
CHANGED: <path>[, <path>]    # execute fail only
```
