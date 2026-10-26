# Checkpoint 2 — Steps 2.1..2.5 (+ 1.5-review-fix)

- **When:** 2026-10-26
- **Steps:** 2.1, 2.2, 2.3, 2.4, 2.5, 1.5-review-fix (`c101f38ef`..`cdb0d95f3`)
- **Touched areas:** `@open-mercato/ai-assistant` — run entities + migration `Migration20261026192929_ai_assistant`, encryption map, `lib/agent-run-{recorder,capture,reader}.ts`, `lib/agent-runtime.ts`, `api/ai/chat`, `api/ai/run-object`, `events.ts`, `di.ts`
- **Runner:** local mode (no compose `app` container)

| Check | Result |
|---|---|
| `packages/ai-assistant` jest (all suites) | ✅ 148 suites, 2000 tests |
| `packages/core/src/__tests__` guard suites (incl. explicit-sort-comparators, command-interceptor-http-coverage, module-decoupling) | ✅ 25 suites, 244 tests (after 1.5-review-fix) |
| App typecheck | ✅ exit 0 |
| `yarn lint` | ✅ exit 0 |
| `apps/docs/__tests__/notification-registry.test.mjs` | ✅ exit 0 |
| UI verification | ⏭️ skipped — no UI touched in this window |

## Findings
- ❌→✅ `explicit-sort-comparators` guard failed on two bare `.sort()` calls added in Step 1.5; fixed in `1.5-review-fix` with a code-point comparator.
- Migration generated with `yarn db:generate`; unrelated forms/wms output discarded; `yarn db:migrate` not run. The migration includes the encryption-map backfill for the three new entity ids.
