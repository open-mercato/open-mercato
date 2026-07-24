# Harness release gate

Run the complete per-release gate from a generated standalone app with one command:

```text
yarn harness:release --prepare-targets /absolute/empty-release-targets --acknowledge-writes
```

`--prepare-targets` accepts only an absolute, new or empty regular directory outside the controller app. It copies the current fresh scaffold once per catalog case whose `evaluationKind` is `implementation` or `regression`, while excluding `.git`, `node_modules`, build/cache/coverage output, `.ai/harness/results`, `.ai/reports`, and `.ai/framework-context`. Each target receives a guarded link to the controller's installed dependency tree; model writes remain outside the case allowlist. The release gate takes a bounded dependency-ownership fingerprint once before execution and once after the complete suite and fails if it changed. A generated `release-targets.json` records the local mapping.

For externally prepared apps, `--writable-targets /absolute/release-targets.json` remains supported. The manifest must assign every writable case to its own fresh generated app:

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
5. `yarn generate`, `yarn typecheck`, `yarn lint`, and `yarn build` in every writable target, after its trusted oracles;
6. explicit isolated `om-code-review` for every eligible one-shot implementation result, bound to the passing command attestation and final post-build target fingerprint.

Each writable target is single-use because fixture preparation marks it disposable. A failed deterministic or foundation-validation step prevents model execution. Once fixture preparation succeeds, all four target commands run even when the writable gate itself fails, so every generated target has exact diagnostics; the dependent review still requires both the writable and command gates to pass. A target command failure is recorded with its sanitized diagnostic, all four commands are attempted, and review is skipped. Other matrix entries continue so the report remains useful.

UI-routed implementation reviews receive only the bounded backend UI guide and `om-backend-ui-design` design-system references. Non-UI reviews do not receive that extra context.

The command writes a mode-`0600` `*-release-suite.json` artifact under `.ai/harness/results/`. It stores no raw runner transcripts, target paths, environment values, or credentials. The report contains exact coverage gaps, sanitized per-target command outcomes and actionable failure reasons, first-pass and correction rates, aggregate context-token measures, review verdict counts, and categorized misuse/violation rates.
