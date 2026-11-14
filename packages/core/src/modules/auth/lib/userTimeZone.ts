import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { canonicalizeTimeZone } from '@open-mercato/shared/lib/date/timezone'
import type { UserTimeZoneLookup } from '@open-mercato/shared/lib/date-locale/types'
import { User } from '../data/entities'

export function createUserTimeZoneLookup(em: EntityManager): UserTimeZoneLookup {
  return async ({ userId, tenantId }) => {
    const user = await findOneWithDecryption(
      em,
      User,
      { id: userId, tenantId, deletedAt: null },
      { fields: ['id', 'timezone'] },
      { tenantId },
    )
    return canonicalizeTimeZone(user?.timezone)
  }
}
