# Checkpoint 3 — Phase 3 (verified provider availability)

**UTC:** 2026-06-17T15:10:00Z
**Steps covered:** 3.1 → 3.3 (commits 4dcb14d6d / 93049daf5 / 1969322b1)
**Packages touched:** `@open-mercato/search` (`modules/search/lib/provider-probe.ts`, `modules/search/di.ts`, `modules/search/api/embeddings/route.ts`)

## Checks

| Check | Scope | Result |
|-------|-------|--------|
| Compile — `yarn workspace @open-mercato/search build` | search | ✅ built successfully (exit 0), 90 entry points |
| Unit — search lib tests | `modules/search/lib/__tests__` | ✅ 15/15 pass (probe 8 + scope 3 + existing 4) |
| UI / Playwright local | — | N/A — Phase 3 touches no UI (UI lands in Phase 4) |

## What landed

- `EmbeddingProviderProbe` (3.1): Ollama `/api/tags` via AbortController (1500ms) reporting model count; env-key presence for the rest; cached ~30s (global key); fail-closed; DI-registered as `embeddingProviderProbe`.
- Gate wiring (3.2): GET `/api/search/embeddings` returns `providerAvailability` (per-provider available/reason/models); POST rejects an unavailable provider with `409 { error, reason }`.
- Tests (3.3): reachable/non-ok/timeout/unreachable, key-presence, caching/force, `checkAllProviders`.

## Scope note (documented for reviewer)

- The probe is the **availability authority** for provider selection (UI disable + save guard). The synchronous `isProviderConfigured` / `EmbeddingService.available` getters remain **presence** signals to avoid an async refactor of hot indexing/query paths; the user-facing defect (selecting an unreachable provider) is fixed by the GET annotations + POST 409 guard. Rewiring the runtime `available` getter to the probe is a low-risk follow-up.
