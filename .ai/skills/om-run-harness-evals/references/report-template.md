# Evaluation report

Use this structure after observation or execution. Keep a complete selected-case table; omit optional sections only when they add no information.

```markdown
# Experiment results

<Outcome, current scope, and next action in one or two sentences. State whether the run is ongoing, completed, stopped, or process state is unknown.>

- Observed at: <UTC timestamp>
- Experiment: <producer ID/name>; source: <generic | legacy-summary | harness-results>
- Runner/model/provider: <actual values or unavailable>
- Scope: <selected cases and lanes>; denominator: <declared | observed>, <count>
- Counts by lane: <pass / fail / blocked / error / skipped / pending / running / not-applicable / not yet reported>
- Dashboard: <local URL for the user; omit URLs from committed sanitized reports>
- Certification: <actual canonical lane evidence, or custom/partial/uncertified with reason>

| Case | Lane | Outcome | Diagnostics or remaining work | Response/files/evidence availability |
|---|---|---|---|---|
| <each selected case, including not-yet-evaluated cases> | <lane> | <recorded status or not yet reported> | <concise fact> | <available / unavailable with reason> |

## Findings and limitations

- <Verified defect, evidence reference/hash, and consequence. Distinguish stale producer metadata and unknown process state from a failed test.>
- <Missing metric/artifact or unrun lane and its effect on interpretation.>

## Next action

<Concrete action justified by the evidence. For an unresolved direction choice, state the options without inventing a verdict.>
```

For publication, replace local URLs/absolute paths with repository-relative references or sanitized hashes, summarize private prompts/transcripts rather than copying them, and remove credentials and environment values. Never publish raw artifact archives automatically. Keep the selected denominator and all outcome categories intact during sanitization.
