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
  /**
   * Spec C § Phase C1 — Microsoft Graph `clientState` is the per-channel
   * anti-tampering nonce echoed back in every change notification. We store
   * it encrypted at rest on `CommunicationChannel.client_state_encrypted`
   * (separate column rather than inside the plaintext `channel_state` JSONB
   * blob — see the spec's "encryption decision" section).
   */
  {
    entityId: 'communication_channels:communication_channel',
    fields: [{ field: 'client_state_encrypted' }],
  },
]

export default defaultEncryptionMaps
