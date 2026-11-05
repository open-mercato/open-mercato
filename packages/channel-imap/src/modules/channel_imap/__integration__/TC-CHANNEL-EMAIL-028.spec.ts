import { test } from '@playwright/test'

/**
 * TC-CHANNEL-EMAIL-028 — Malformed MIME → dead-letter, cursor advances
 *
 * Spec B § Phase B4 — `poll-channel.ts` classifies per-message ingest
 * failures: transient failures abort the loop without advancing the
 * cursor (idempotent retry on next tick), permanent failures write the
 * raw MIME blob + error metadata to `ChannelIngestDeadLetter`
 * (encrypted at rest via `defaultEncryptionMaps`) and the cursor
 * advances anyway so the bad blob never re-stalls the channel.
 *
 * Unit-tested via the `ChannelIngestDeadLetter row shape (Spec B § B4)`
 * describe in `ingest-inbound-message.test.ts` plus the implementation
 * paths in `poll-channel.test.ts`. Full E2E in the QA scenario.
 */
test.describe('TC-CHANNEL-EMAIL-028: Malformed MIME → dead-letter', () => {
  test.skip('behavioral coverage: workers/__tests__/poll-channel.test.ts (permanent ingest failure → dead-letter + cursor advances; transient → cursor held). Playwright E2E is infeasible — provider mock seams are process-local.', () => {})
})
