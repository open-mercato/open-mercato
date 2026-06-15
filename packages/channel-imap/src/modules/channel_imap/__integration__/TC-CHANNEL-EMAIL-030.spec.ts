import { test } from '@playwright/test'

/**
 * TC-CHANNEL-EMAIL-030 — Sent-folder dedup
 *
 * Spec B § Phase B3 — `ingest-inbound-message.ts` short-circuits when
 * the inbound message's `messageId` matches an outbound
 * `MessageChannelLink.channelMetadata.messageId` we already sent. This
 * prevents IMAP polls of the Sent folder from creating duplicate
 * inbound rows for every outbound the user sent.
 *
 * Contract unit-tested in `ingest-inbound-message.test.ts` (sent-folder
 * dedup describe block). Full E2E in the QA scenario markdown — send
 * an outbound, observe Sent folder surfaces it, confirm no duplicate
 * `MessageChannelLink` row appears for the inbound direction.
 */
test.describe('TC-CHANNEL-EMAIL-030: Sent-folder dedup', () => {
  test.skip('behavioral coverage: ingest-inbound-message.test.ts (sent-folder dedup contract + dedup → status=duplicate). Playwright E2E is infeasible — provider mock seams are process-local.', () => {})
})
