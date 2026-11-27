import { encryptBytes, decryptBytes } from '../engine/crypto'
import type { RotationArtifactCipher } from './store'

export function createRotationArtifactCipher(recipients: string[], identities: string[]): RotationArtifactCipher {
  if (!recipients.length || !identities.length) throw new Error('[internal] ROTATION_RECOVERY_CUSTODY_REQUIRED')
  return {
    seal(plaintext) { return encryptBytes(plaintext, recipients) },
    open(ciphertext) { return decryptBytes(ciphertext, identities, 8 * 1024 * 1024) },
  }
}
