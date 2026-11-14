import type { EntityData, EntityManager, EntityName, FilterQuery } from '@mikro-orm/postgresql'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

export type ExclusiveFlagRow = { id: string }

export type ExclusiveFlagConfig<T extends ExclusiveFlagRow> = {
  entity: EntityName<T>
  flag: 'isPrimary' | 'isDefault'
  constraint: string
}

export type ExclusiveFlagScope = Record<string, string>

const PROMOTION_ATTEMPTS = 3

function flaggedRowsWhere<T extends ExclusiveFlagRow>(
  config: ExclusiveFlagConfig<T>,
  scope: ExclusiveFlagScope,
  keepId: string | null,
): FilterQuery<T> {
  const where: Record<string, unknown> = { ...scope, [config.flag]: true, deletedAt: null }
  if (keepId) where.id = { $ne: keepId }
  return where as FilterQuery<T>
}

function ownRowWhere<T extends ExclusiveFlagRow>(scope: ExclusiveFlagScope, id: string): FilterQuery<T> {
  return { ...scope, id, deletedAt: null } as FilterQuery<T>
}

function flagData<T extends ExclusiveFlagRow>(config: ExclusiveFlagConfig<T>, value: boolean, now?: Date): EntityData<T> {
  const data: Record<string, unknown> = { [config.flag]: value }
  if (now) data.updatedAt = now
  return data as EntityData<T>
}

export async function clearExclusiveFlag<T extends ExclusiveFlagRow>(
  em: EntityManager,
  config: ExclusiveFlagConfig<T>,
  scope: ExclusiveFlagScope,
  keepId: string | null,
): Promise<T[]> {
  const where = flaggedRowsWhere(config, scope, keepId)
  const cleared = await findWithDecryption(em, config.entity, where, undefined, {
    tenantId: scope.tenantId ?? null,
    organizationId: scope.organizationId ?? null,
  })
  if (!cleared.length) return []
  await em.nativeUpdate(config.entity, where, flagData(config, false, new Date()))
  return cleared
}

export async function promoteExclusiveFlag<T extends ExclusiveFlagRow>(
  em: EntityManager,
  config: ExclusiveFlagConfig<T>,
  scope: ExclusiveFlagScope,
  id: string,
  now: Date,
): Promise<{ promoted: boolean; cleared: T[] }> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const cleared = await em.transactional(async (tem) => {
        const rows = await clearExclusiveFlag(tem, config, scope, id)
        await tem.nativeUpdate(config.entity, ownRowWhere<T>(scope, id), flagData(config, true, now))
        return rows
      })
      return { promoted: true, cleared }
    } catch (err) {
      if (!isUniqueViolation(err, config.constraint)) throw err
      if (attempt >= PROMOTION_ATTEMPTS) return { promoted: false, cleared: [] }
    }
  }
}

export async function assignExclusiveFlag<T extends ExclusiveFlagRow>(
  em: EntityManager,
  config: ExclusiveFlagConfig<T>,
  scope: ExclusiveFlagScope,
  id: string,
  toConflict: () => unknown,
): Promise<T[]> {
  try {
    const cleared = await clearExclusiveFlag(em, config, scope, id)
    await em.nativeUpdate(config.entity, ownRowWhere<T>(scope, id), flagData(config, true))
    return cleared
  } catch (err) {
    if (isUniqueViolation(err, config.constraint)) throw toConflict()
    throw err
  }
}
