import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '../data/entities'

const uuidSchema = z.string().uuid()

export async function resolveUserDataSubject(
  em: EntityManager,
  auth: NonNullable<AuthContext>,
): Promise<string | null> {
  if (!auth.isApiKey) return auth.sub
  if (!uuidSchema.safeParse(auth.userId).success || !uuidSchema.safeParse(auth.tenantId).success) return null
  if (auth.orgId !== null && !uuidSchema.safeParse(auth.orgId).success) return null

  const user = await findOneWithDecryption(
    em,
    User,
    {
      id: auth.userId,
      tenantId: auth.tenantId,
      ...(auth.orgId ? { organizationId: auth.orgId } : {}),
      deletedAt: null,
    },
    undefined,
    { tenantId: auth.tenantId, organizationId: auth.orgId },
  )
  return user?.id ?? null
}
