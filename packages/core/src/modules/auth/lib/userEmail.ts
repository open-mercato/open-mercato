import type { User } from '@open-mercato/core/modules/auth/data/entities'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'

type UserLike = Pick<User, 'email' | 'tenantId' | 'organizationId'>

export async function resolveUserEmail(
  user: UserLike,
  encryption?: TenantDataEncryptionService | null,
): Promise<string | null> {
  const rawEmail = typeof user.email === 'string' ? user.email : null
  if (!rawEmail) return null
  if (!encryption?.isEnabled()) return rawEmail
  try {
    const decrypted = await encryption.decryptEntityPayload(
      'auth:user',
      { email: rawEmail },
      user.tenantId ? String(user.tenantId) : null,
      user.organizationId ? String(user.organizationId) : null,
    )
    return typeof decrypted?.email === 'string' && decrypted.email.length ? decrypted.email : rawEmail
  } catch {
    return rawEmail
  }
}
