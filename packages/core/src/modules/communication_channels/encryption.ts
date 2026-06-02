import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

/**
 * Per-entity encryption maps for the communication_channels module.
 *
 * Credential encryption for `IntegrationCredentials.credentials` is owned by
 * the `integrations` module (see packages/core/src/modules/integrations/encryption.ts).
 *
 * `ChannelIngestDeadLetter.raw_body` holds truncated MIME bodies of
 * permanently-failed inbound messages. MIME bodies routinely contain PII
 * (sender/recipient addresses, quoted prior emails, attachments), so the
 * column is encrypted at rest. Reads use `findWithDecryption` per the
 * `packages/core/AGENTS.md` Encryption section.
 *
 * At-rest posture for the OTHER PII-bearing hub columns (deliberate, reviewed):
 *   - The canonical email content is already encrypted in its PRIMARY stores —
 *     `messages.message` (subject/body/external_email+hash; see
 *     messages/encryption.ts) and `customers.customer_interaction` (title/body).
 *   - The hub keeps SECONDARY copies that are currently PLAINTEXT at rest:
 *     `external_messages.sender_identifier`/`sender_display_name`,
 *     `external_conversations.subject`, and `message_channel_links.channel_payload`.
 *     The per-user access-control layer governs who can READ these; at-rest
 *     encryption is a separate concern tracked as a follow-up (it requires
 *     auditing every read path — the `_channelPayload` enricher and the
 *     channel-payload renderer read these — to route through `findWithDecryption`).
 *   - `message_channel_links.channel_metadata` MUST stay plaintext: the thread
 *     matcher and sent-folder dedup query `channel_metadata->>'messageId'` BY
 *     VALUE, and an encrypted column is not queryable by value (§16 footgun).
 *   - `external_messages.sender_identifier` similarly needs a deterministic
 *     `*_hash` blind-index column before it can be encrypted, because inbound
 *     contact resolution looks addresses up by value (see the address blind-index
 *     follow-up in customers/lib/findPeopleByAddresses.ts).
 *
 * See `.ai/specs/2026-05-27-email-integration-inbound-reliability-and-threading.md`
 * (§ 3 Encryption posture).
 */
export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'communication_channels:channel_ingest_dead_letter',
    fields: [{ field: 'raw_body' }],
  },
]

export default defaultEncryptionMaps
