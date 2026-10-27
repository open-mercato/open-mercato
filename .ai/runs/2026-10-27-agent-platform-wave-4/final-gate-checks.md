# Final gate — agent-platform-wave-4

- **When:** 2026-10-27T21:10:39Z
- **Head:** `9a0f3c245` (all Tasks rows `done`)
- **Runner:** local mode; integration in ephemeral environments

## 1. `validation.commands` (`.ai/agentic.config.json`, in order)

| Command | Result | Notes |
|---|---|---|
| `yarn build:packages` | pass | |
| `yarn generate` | pass | |
| `yarn build:packages` | pass | |
| `yarn i18n:check-sync` | pass | |
| `yarn i18n:check-usage` | pass | |
| `yarn typecheck` | pass | |
| `yarn test --continue` | fail → fixed | 46/49 tasks passed. `@open-mercato/core`: 2 real failures caused by this branch — `optimistic-lock-command-coverage` (the two new settings commands were not allowlisted) and `acl-feature-catalog.i18n` (missing `trace.view_content` title) → fixed in **5.2-review-fix** (`9a0f3c245`); full core re-run: 2461 suites, 23964 tests pass. `forms/public-start-security` and cli `injection-widget-id-validation`: jest-worker SIGSEGV (known flake), pass alone. `open-mercato-docs`: V8 OOM under the 1 GB gate limit, passes with 4 GB. |
| `yarn build:app --force` | pass | |
| also: `yarn lint`, `yarn agents:check-budget` | pass | |

## 2. Full integration suite (`yarn test:integration:ephemeral`, enterprise + AO + SSO + security, OTel exporter env)

2954 passed, 12 failed, 3 flaky, 116 skipped (51.5 min). No failure is caused by this branch:

| Failing specs | Classification |
|---|---|
| TC-DOCUMENTS-009/013, TC-ONBOARDING-EMAIL-001 | Pre-existing failures on `main` (handoff list) |
| TC-SX-009 | Pre-existing; also fails in isolation (as in the wave-3 gate) |
| TC-CRM-065, TC-CRM-085 (address-coordinates case) | Load-only: both pass in isolation |
| TC-FORMS-UI-002, TC-SALES-ADDR-CONTACT-002 | Flaky: fail once, pass on retry, in the full run and in isolation |

Wave-4 specs in the full run: `TC-AGENT-OTEL-001` (2 tests), `TC-AGENT-OTEL-002` (delivery to the fake OTLP receiver, opt-out sends nothing) and `TC-AGENT-TRACE-005` (2 tests) passed; the native-run case skipped (no LLM provider).

## 3. Design-system pass

`eslint --config eslint.ds.config.mjs` (through `scripts/typescript-js-require-hook.cjs`, as `yarn lint:ds` does) on the 8 changed `.tsx` files: clean.

Artifacts: `final-gate-artifacts/integration-full-summary.log`, `final-gate-artifacts/integration-isolated-rerun.log`; UI screenshots in `checkpoint-3-artifacts/` and `checkpoint-5-artifacts/`.
