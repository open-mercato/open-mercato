# Checkpoint 3 — Steps 2.6..2.8, 3.1 (+ 1.3-review-fix, 2.8-review-fix); Phase 2 closed

- **When:** 2026-10-26
- **Steps:** 2.6 `0fc51def6`, 2.7 `c7b1f195d`, 2.8 `5a5dcb0f3`, 3.1 `dce125ccd`, 1.3-review-fix `6b8848718`, 2.8-review-fix `785a79a38`
- **Touched areas:** ai-assistant (prune worker + CLI + schedule, conversation soft-delete of runs, docs, AGENTS.md, integration spec, observer hook typing); agent_orchestrator native runner (`trace: { persist: false }`); shared `lib/ai/run-observation.ts`
- **Runner:** local mode; integration against the ephemeral app at `http://127.0.0.1:5001`

| Check | Result |
|---|---|
| `packages/ai-assistant` jest | ✅ 150 suites, 2010 tests |
| `packages/enterprise` jest, `agent_orchestrator` | ✅ 169 suites, 1539 tests |
| Enterprise `tsc --noEmit` | ✅ |
| App typecheck script | ✅ |
| `yarn build:app` (Next type check) | ❌→✅ failed on the observer end-hook typing from Step 1.3; fixed in `1.3-review-fix` |
| `yarn lint` | ✅ |
| `yarn agents:check-budget` (Step 2.8) | ✅ |
| Playwright `TC-AI-RUN-TRACE-016` | ❌→✅ OpenAPI case failed (path keyed without `/api`, `$ref` schema); fixed in `2.8-review-fix`; now 3 passed, 1 skipped (live-model case, no provider configured) |
| Playwright `TC-AI-PLAYGROUND-004` | ✅ 4 passed |
| Playwright `TC-AI-CONVERSATIONS-001` | ⚠️ 2 passed, 1 failed — the cross-org case fails in its DB fixture (`createOrganizationInDb` → `organizations_tenant_id_foreign`) before any route call; the fixture writes straight to the database, not through the app. Not caused by this run's changes (no change to tenants/organizations or fixtures); to be re-checked in CI |
| UI verification | ⏭️ no UI touched in this window |

## Lesson
- The app typecheck script (`apps/mercato/scripts/typecheck.mjs`) does not reproduce the `next build` type check for package sources; run `yarn build:app` at every checkpoint that touches ai-assistant runtime types.
