import { test } from '@playwright/test'

/**
 * TC-CHANNEL-EMAIL-027 — Auto-recovery from `status='error'`
 *
 * Spec B § Phase B5 — `poll-tick.ts` enumerates two channel pools per
 * tick: (a) `status='connected'` and due for polling, (b) `status='error'`
 * whose `lastFailureAt` is older than `OM_CHANNEL_AUTO_RECOVER_MINUTES`
 * (default 30). A successful poll in pool (b) flips status back to
 * 'connected' via `poll-channel.ts`.
 *
 * Unit-tested in `packages/core/.../workers/__tests__/poll-tick.test.ts`
 * (auto-recovery describe block). Full E2E (force a transient error →
 * fast-forward 30 min → next tick recovers) is in the QA scenario.
 */
test.describe('TC-CHANNEL-EMAIL-027: Auto-recovery sweep', () => {
  test.skip('behavioral coverage: workers/__tests__/poll-tick.test.ts (auto-recovery sweep). Playwright E2E is infeasible — provider mock seams are process-local + needs scheduler fast-forward.', () => {})
})
