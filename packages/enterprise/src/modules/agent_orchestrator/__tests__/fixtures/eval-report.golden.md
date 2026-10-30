# Eval report: invoice_triage

| Field | Value |
| --- | --- |
| Suite run | suite-1 |
| Agent | invoice_triage |
| Report status | completed |
| Trigger | ci |
| Eval set version | sha256:abc123 |
| Eval set label | regression |
| Pin | hash |
| Manifest hash | sha256:abc123 |
| Eval set source | file |
| Eval set cases | 2 |
| Eval set assertions | 2 |
| Baseline run | suite-0 |
| Release | — |
| Repeat count | 2 |
| Started | 2026-10-22T11:58:00.000Z |
| Finished | 2026-10-22T11:59:30.000Z |
| Generated | 2026-10-22T12:00:00.000Z |

## Gate

**Verdict: FAILED**

- Pass score: 0.5
- Score variance: 0.0625
- Judge may gate: no

### Regressions

- amount_matches

## Summary

| Cases | Trials | Passed | Failed | Errored | Skipped | Flaky cases |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 4 | 2 | 1 | 1 | 0 | 1 |

- Cost: 12 USD (minor units)
- Latency p50 / p95 / max: 1200 ms / 3000 ms / 3000 ms
- Tokens in / out: 900 / 300

## Environment

- Models: openai/gpt-5-mini
- Temperature: 0
- Seed: 42 (honored: unknown)
- Tool mode: replay
- Model mode: live
- Git SHA: deadbeef
- CLI version: 0.9.0

## Baseline

- Baseline run: suite-0
- Baseline manifest hash: sha256:abc123
- Same dataset: yes

## Assertions

| Assertion | Scorer | Type | Severity | Pass rate | Pass/Fail/Skip | Baseline | Delta | Flags |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| amount_matches | exact_match | deterministic | gate | 50.0% | 1/1/0 | 100.0% | -50.0 pp | regressed, flaky |
| rationale_quality | llm_judge | llm_judge | advisory | 100.0% | 3/0/0 | 75.0% | +25.0 pp | — |

### Judge deltas

| Assertion | Pass rate | Baseline | Delta |
| --- | ---: | ---: | ---: |
| rationale_quality | 100.0% | 75.0% | +25.0 pp |

## Cases

| Case | Source | Trials | Score | Max latency | Baseline | Flaky |
| --- | --- | --- | ---: | ---: | --- | --- |
| invoice-overdue (Overdue invoice) | file | passed, failed | 0.75 | 3000 ms | passed | yes |
| invoice-paid | file | passed, error | 1 | 900 ms | absent | no |

## Failures

### invoice-overdue (Overdue invoice) — trial 1

- Status: failed
- Case run: cr-a1
- Trace: /backend/traces/run-a1
- Flaky: yes

Failed assertions:

- `amount_matches` — scorer exact_match, type deterministic, severity gate, score 0

  ```json
  {
    "expected": 120,
    "actual": 210
  }
  ```

### invoice-paid — trial 1

- Status: error
- Case run: cr-b1

Error:

```text
Provider timeout
```
