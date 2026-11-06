# Checkpoint 2 — Steps 2.1..2.5 (Phase 2)

- **When:** 2026-10-27T17:36:39Z
- **Steps:** 2.1..2.5 (`2ab104644`..`763858447`)
- **Areas:** agent_orchestrator `lib/trace/{capturePolicy,captureSettingsForm,runManifestEntry}.ts`, `lib/runtime/{nativeAgentRunner,openCodeAgentRunner}.ts`, `data/validators.ts`, `acl.ts`, `api/trace-capture/settings/route.ts`, `commands/traceCapture.ts`, `backend/settings/trace-capture/*`, `i18n/*`.

| Check | Result |
|---|---|
| `yarn typecheck` | pass |
| `npx jest src/modules/agent_orchestrator` (packages/enterprise) | pass — 206 suites, 2111 tests (incl. jsdom render tests of the settings page) |
| core guards `feature-policy-authorization-coverage`, `module-decoupling` | pass — 14 tests |
| `yarn build:app --force` | pass |
| UI / integration (browser) | deferred — the settings page's integration spec + screenshots are Step 3.3; captured at checkpoint 3 |

Decisions:
- Settings PUT enforces optimistic locking on the module-config row's `updatedAt` (not exempt).
- Undo writes `null` (config service has no delete); a `null` value reads as the default.
- Ceiling-clamped levels report `source: 'deployment'`; a non-tenant (default) policy never applies per-agent overrides.
