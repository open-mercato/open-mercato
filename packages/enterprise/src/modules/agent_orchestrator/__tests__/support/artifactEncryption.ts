import {
  decryptWithAesGcm,
  encryptWithAesGcm,
  generateDek,
  isEncryptedPayloadShape,
} from '@open-mercato/shared/lib/encryption/aes'

/**
 * A `tenantEncryptionService` stand-in that seals every string field with real
 * AES-GCM under one DEK, so artifact-store writes see genuine `<iv>:<ct>:<tag>:v1`
 * envelopes. Use `openSealedBuffer` to read back what a test upload stored.
 */
export function createTestArtifactEncryption() {
  const dek = generateDek()
  const encryptEntityPayload = async (_entityId: string, payload: Record<string, unknown>) => {
    const sealed: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(payload)) {
      sealed[key] = typeof value === 'string' ? encryptWithAesGcm(value, dek).value : value
    }
    return sealed
  }
  const decryptEntityPayload = async (_entityId: string, payload: Record<string, unknown>) => {
    const opened: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(payload)) {
      opened[key] = isEncryptedPayloadShape(value) ? decryptWithAesGcm(value, dek) : value
    }
    return opened
  }
  const openSealedBuffer = (buffer: Buffer): Record<string, string> => {
    const wrapper = JSON.parse(buffer.toString('utf8')) as Record<string, unknown>
    const opened: Record<string, string> = {}
    for (const [key, value] of Object.entries(wrapper)) {
      if (!isEncryptedPayloadShape(value)) throw new Error(`[internal] field ${key} was stored unencrypted`)
      const plaintext = decryptWithAesGcm(value, dek)
      if (plaintext === null) throw new Error(`[internal] field ${key} did not decrypt`)
      opened[key] = plaintext
    }
    return opened
  }
  return {
    service: { encryptEntityPayload, decryptEntityPayload },
    openSealedBuffer,
  }
}

/** A `tenantEncryptionService` that behaves like encryption disabled: payloads pass through unchanged. */
export const passThroughArtifactEncryption = {
  encryptEntityPayload: async (_entityId: string, payload: Record<string, unknown>) => payload,
  decryptEntityPayload: async (_entityId: string, payload: Record<string, unknown>) => payload,
}
