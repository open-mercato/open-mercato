# Checkpoint 1 — Steps 0.1 .. 2.2

**Completed:** 2026-05-28T11:24:00Z
**Step range:** 0.1 .. 2.2 (5 commits)
**SHA range:** a762bca68 .. de1746a97
**Touched packages:** `@open-mercato/ui` (single package)

## Steps covered

| Step | Commit | Summary |
|------|--------|---------|
| 0.1 | a762bca68 (seed) | Seed run folder + spec |
| 1.1 | c17e8907d | LoadTranscriptResult discriminated union + caller update |
| 1.2 | abde12fbb | Unit tests for loadAiServerTranscript 200/404/503/403/throw |
| 2.1 | 636b37d0e | Scoped storage key + scope-change subscription |
| 2.2 | de1746a97 | Unit tests for tenant/org scope isolation |

## Validation outcomes

| Check | Result | Notes |
|-------|--------|-------|
| `yarn workspace @open-mercato/ai-assistant build` | pass | Required to unblock AiChat unit tests (pre-existing dependency on built dist). |
| `yarn workspace @open-mercato/ui test` (full suite) | pass | 142 suites, 1105 tests, 0 failures |
| `yarn workspace @open-mercato/ui jest src/ai/__tests__/conversation-store.test.ts` | pass | 7/7 (1 existing + 6 new) |
| `yarn workspace @open-mercato/ui jest src/ai/__tests__/AiChatSessions.test.tsx` | pass | 5/5 (new file) |
| `yarn workspace @open-mercato/ui jest src/ai` | pass | 22 suites, 143 tests |

## UI verification (skipped at this checkpoint)

No UI primitives, pages, or visible chrome were touched in this window. The changes are pure state/types/persistence-layer plumbing; their UI effect (no stale tabs after scope change) is exercised by the new AiChatSessions.test.tsx scope-change tests via the React DOM. Playwright + screenshots therefore add no signal at this checkpoint.

## Notes / risks observed

- `yarn workspace @open-mercato/ui typecheck` (standalone) reports two pre-existing errors in `packages/core/src/generated-shims/entities.ids.generated.ts` (missing `#generated/entities.ids.generated` module). This is a clean-checkout artefact (those files are produced by `yarn generate`), unrelated to this run. Final-gate `yarn typecheck` will run `yarn generate` first so this clears.
- No localStorage migration of `om-ai-chat-sessions-v1` is intentional. The legacy key remains dormant; documented in spec.
