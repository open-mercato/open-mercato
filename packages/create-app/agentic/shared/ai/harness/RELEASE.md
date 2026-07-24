# Harness release gate

Run the complete per-release gate from a generated standalone app with one command:

```text
yarn harness:release --writable-targets /absolute/release-targets.json --acknowledge-writes
```

The target manifest must assign every catalog case whose `evaluationKind` is `implementation` or `regression` to its own fresh generated app:

```json
{
  "schemaVersion": 1,
  "targets": {
    "OMH-009": "/absolute/fresh-app-for-OMH-009",
    "OMH-011": "/absolute/fresh-app-for-OMH-011"
  }
}
```

The command derives all counts and case IDs from `cases.json`, `validators.json`, and `release-matrix.json`; it has no fixed 92-case or 16-writable-case assumptions. Run `yarn install-skills` first so the pinned external `om-code-review` skill and ownership evidence are present. Before running a model or writing a fixture, the release command requires complete deterministic, live-routing, writable, trusted-oracle, target, and generated-code-review coverage. Missing business fixtures or release-matrix entries fail preflight and are listed by exact case ID in the report.

After preflight it runs, in order:

1. deterministic validation for the complete catalog;
2. the release matrix's fixed `yarn generate`, `yarn typecheck`, `yarn lint`, and `yarn build` foundation;
3. every configured live-routing runner selection;
4. fixture preparation and the assigned writable runner for every writable case, including the controller-owned AST/behavior oracles and target typecheck;
5. explicit isolated `om-code-review` for every eligible one-shot implementation result.

Each writable target is single-use because fixture preparation marks it disposable. A failed deterministic or foundation-validation step prevents model execution. A failed writable result skips only its dependent code review; the other matrix entries continue so the report remains useful.

The command writes a mode-`0600` `*-release-suite.json` artifact under `.ai/harness/results/`. It stores no raw runner transcripts, target paths, environment values, or credentials. The report contains exact coverage gaps, sanitized step outcomes, first-pass and correction rates, aggregate context-token measures, review verdict counts, and categorized misuse/violation rates.
