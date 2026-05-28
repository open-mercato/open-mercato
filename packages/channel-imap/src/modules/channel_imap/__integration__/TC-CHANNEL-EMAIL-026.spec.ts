import { test } from '@playwright/test'

/**
 * TC-CHANNEL-EMAIL-026 — Subject + participants fallback threading
 *
 * Last-ditch matcher strategy: when neither `om_*` token nor JWZ
 * headers are present, the matcher normalises the inbound subject
 * (`Re:`, `Fwd:`, `[EXTERNAL]` stripped) and checks for an existing
 * thread whose participants overlap >= 50% with the inbound's
 * sender/to/cc. Confidence: low.
 *
 * Unit-tested in `packages/core/.../lib/__tests__/thread-matcher.test.ts`
 * (Strategy 4 — subject-participants). End-to-end is the QA scenario
 * markdown.
 */
test.describe('TC-CHANNEL-EMAIL-026: Subject + participants fallback', () => {
  test.skip('full E2E covered by QA scenario markdown (manual)', () => {})
})
