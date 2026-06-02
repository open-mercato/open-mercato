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
