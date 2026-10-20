The prompt stage reads this file under PHASING on only — it holds the estimate rule, the
threshold and the fixed-form `Estimate:` line.

## Estimate rule

While grounding, estimate the implementation's execute-context cost: sum the byte sizes of
every file in the manifest with role `read` or `modify` (`wc -c` or the Read tool's view; count
each file once), convert at ≈4 bytes per token, and multiply by a fixed ×3 overhead factor for
tool output, tests and iteration; the result is the **total estimate**. One threshold, **200K**
tokens, applies twice: a total above it triggers phasing, and each phase must estimate at or
under it. The grounding-time sum is provisional: if the Phase-1/Phase-2 interrogation added or
removed files from the read/modify set, re-sum once before the Phase-3 branch, and the recorded
`Estimate:` line carries that final figure.

## Estimate line (flat layout)

When the total estimate is ≤ 200K and a single `prompt.md` is written, the spec additionally
carries one fixed-form line
`Estimate: <bytes> B ÷ 4 × 3 ≈ <N>K tokens (threshold 200K)` — the rule and the figure in one
line.
