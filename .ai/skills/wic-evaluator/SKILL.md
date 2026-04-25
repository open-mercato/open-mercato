---
name: wic-evaluator
description: Evaluate Open Mercato WIC (Wildly Important Contribution) from GitHub evidence using the official WIC Assessment Guide and the local `wic_data_fetcher.mjs` tool. Use when the user asks to calculate WIC score, assess WIC level, review monthly contribution score, freeze a WIC fixture, or test whether WIC evaluation is deterministic across repeated runs.
---

# WIC Evaluator

Use this skill to run the Open Mercato WIC workflow end to end or to test whether repeated evaluations of the same dump stay consistent.

Current status: testing phase. The workflow is in active replay-testing and rubric iteration; the score remains advisory while the impact-bonus rules are still being tightened.

## Inputs

- GitHub profiles
- date range `from/to`
- optional repo override
- optional frozen fixture dump

## Source of Truth

Read [references/wic-assessment-guide.md](references/wic-assessment-guide.md) before scoring.

Treat that guide as the only scoring rubric. Do not invent extra categories, weights, or heuristics. If the guide is ambiguous, prefer the stricter interpretation.

## Workflow

1. Decide whether the task is `live scoring` or `determinism replay`.
2. For `live scoring`, create a dump with:
   `bash .ai/skills/wic-evaluator/scripts/freeze_fixture.sh --profiles <logins> --from <YYYY-MM-DD> --to <YYYY-MM-DD> --output <path>`
3. Read the frozen dump and the assessment guide.
4. Group logically connected PRs and issues into one feature when the guide requires it.
5. Score only from the dump and the guide.
6. Return the final answer as the exact markdown table required by the guide.

## Determinism Rules

- A live GitHub fetch is not a determinism test because the input can change.
- To test determinism, freeze one dump first and replay the evaluation from that same file.
- Save each replay result as its own markdown file and compare them with:
  `node .ai/skills/wic-evaluator/scripts/compare_reports.mjs <report-a.md> <report-b.md> [...]`

## Output Contract

Always produce one markdown table with these columns and no renamed headers:

`Person | GH profile | Month | WIC script version | WIC Score | WIC Level | Bounty bonus | Why bonus | What we included and why? | What we excluded and why?`

## Guardrails

- Unmerged PR without explicit approval signal gets `0`.
- Routine maintenance gets `0`.
- The same underlying feature split across many PRs gets one highest applicable score, not multiple stacked scores.
- Group artifacts only when the frozen dump shows an explicit linkage such as the same spec/issue identifier or a direct textual cross-reference.
- Do not merge unrelated small fixes into one synthetic feature just because they share month or author.
- Issue-only `Accepted Bug Report` scoring requires visible acceptance evidence in the dump, or a clearly linked merged fix in the same dump.
- If bounty intent is not clearly supported by evidence, do not grant bounty bonus.
- If you genuinely hesitate between a larger score and a minimal one, cut down to `0.25` as required by the guide.
- Monthly `WIC Level` is the max base classification level among included scored features; totals in `WIC Score`, impact, and bounty never raise it.

## Local Tools

- Fetcher: [scripts/wic_data_fetcher.mjs](scripts/wic_data_fetcher.mjs)
- Freeze wrapper: [scripts/freeze_fixture.sh](scripts/freeze_fixture.sh)
- Replay comparator: [scripts/compare_reports.mjs](scripts/compare_reports.mjs)

## Notes

- The fetcher requires `gh` CLI auth.
- The fetcher gathers evidence only; it does not evaluate anything.
- The comparator is for report stability checks, not for scoring.
- Treat the result as advisory until the impact-bonus rubric is fully stabilized.
