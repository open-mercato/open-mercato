import { test } from '@playwright/test'

/**
 * TC-CHANNEL-EMAIL-025 — JWZ-headers fallback threading
 *
 * Verifies the `jwz-headers` strategy (Spec B § thread-matcher,
 * confidence: medium) — when an inbound reply has no `om_*` token
 * but carries `In-Reply-To` / `References` pointing at one of our
 * outbound `Message-Id`s, the matcher walks the conventional JWZ
 * algorithm against the existing `external_messages` table.
 *
 * This path is exercised end-to-end by the QA scenario markdown
 * `TC-CHANNEL-EMAIL-025-jwz-fallback.md`. The unit-level coverage
 * lives in `packages/core/.../lib/__tests__/thread-matcher.test.ts`
 * (Strategy 3 — jwz-headers describe block).
 *
 * No additional API surface to assert at the integration layer
 * beyond the smoke tests already in TC-023/024 — this spec file
 * documents the existence of the JWZ pathway for QA-tracking purposes.
 */
test.describe('TC-CHANNEL-EMAIL-025: JWZ-headers fallback', () => {
  test.skip('behavioral coverage: thread-matcher.test.ts Strategy 3 (jwz-headers). Playwright E2E is infeasible — provider mock seams are process-local (see TC-CHANNEL-EMAIL-031 / TC-CRM-EMAIL-001).', () => {})
})
