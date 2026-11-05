# Checkpoint 1 — after steps 1.1–1.6

- Date: 2026-07-28 (UTC)
- Window: commits `1986c5aa7`..`c44852f80` (6 steps)
- Runner: local

## Steps covered

| Step | Commit | Summary |
|------|--------|---------|
| 1.1 | 1986c5aa7 | Pure interpolation-pipeline parser + transform table (37 + 8 boundary tests) |
| 1.2 | 293e954d4 | interpolateVariables + expression-refs on the shared parser; lenient behavior byte-identical |
| 1.3 | f3ac3aaee | Strict interpolation mode; default strict only on POST create path; editor toggle; 4-locale i18n |
| 1.4 | 5a2373a89 | `GET /api/workflows/endpoints` in-process OpenAPI projection; #4230 generator fix NOT needed (declared zod responses already emit real schemas) |
| 1.5 | ffd7350f6 | EndpointPicker (browse/search/typed param rows/free-text fallback) wired into CALL_API |
| 1.6 | c44852f80 | CALL_API `outputContract` → response schema → ledger via `bindCallApiResponseSchemaResolver` seam |

## Checks

- Workflows-scoped unit suite: **1099 suites / 8573 tests passed** (base was 1090/8442; +21 net suites incl. new endpoint/picker/pipeline suites). Run by executor at step 1.6 close.
- Shared openapi tests: 5 passed, `generator-response-fallback.test.ts` unchanged.
- `yarn typecheck`: green (22/22 turbo tasks), run at steps 1.3 and 1.6.
- `yarn i18n:check-sync`: all translation files in sync (50 modules).
- `yarn i18n:check-usage`: advisory only (4023 pre-existing unused keys; no new failures).
- `yarn generate`: run after module-file changes; no generated-file pruning occurred; nothing generated committed.
- Guards respected: no bare `.sort()`, purity boundary tests extended for `interpolation-pipeline.ts` (new import-boundary test), expression-refs boundary allowlists exactly the shared parser.

## Notes / decisions in window

- Strict-mode default lives ONLY in the create handler (briefing risk #9) — shared schema has no default, so existing lenient definitions cannot be flipped by a PUT round-trip.
- Endpoint catalog carries `/api`-prefixed paths matching CALL_API's `buildApiUrl` contract; undeclared responses omit `responseSchema` (honest degradation, `'unknown'` in the ledger).
- New pure helper `lib/endpoint-path.ts` shared between picker UI and server contract lookup (exact-beats-template matching).
- UI browser verification deferred to the integration batch (3.15) + final gate per PLAN rule 7 — no UI-affecting regression risk beyond new components in this window.
