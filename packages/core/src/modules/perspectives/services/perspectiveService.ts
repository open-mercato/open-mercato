import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import { Perspective, RolePerspective } from '../data/entities'
import type {
  PerspectiveSettings,
  PerspectiveSaveInput,
  RolePerspectiveSaveInput,
} from '../data/validators'

export type PerspectiveScope = {
  userId: string
  tenantId?: string | null
  organizationId?: string | null
}

export type ResolvedPerspective = {
  id: string
  name: string
  tableId: string
  settings: PerspectiveSettings
  isDefault: boolean
  createdAt: string
  updatedAt?: string | null
}

export type ResolvedRolePerspective = {
  id: string
  roleId: string
  tableId: string
  name: string
  settings: PerspectiveSettings
  isDefault: boolean
  tenantId: string | null
  organizationId: string | null
  createdAt: string
  updatedAt?: string | null
}

export type PerspectivesState = {
  tableId: string
  personal: ResolvedPerspective[]
  personalDefaultId: string | null
  rolePerspectives: ResolvedRolePerspective[]
}

const CACHE_TTL_MS = 5 * 60 * 1000

const nullish = <T extends string | null | undefined>(value: T): string | null =>
  value == null ? null : value

const scopeKey = (scope: PerspectiveScope) =>
  `${scope.userId}:${scope.tenantId ?? 'null'}:${scope.organizationId ?? 'null'}`

const userCacheKey = (scope: PerspectiveScope, tableId: string, roleIds: string[]) =>
  `perspectives:user-state:${scopeKey(scope)}:${tableId}:${roleIds.sort().join(',')}`

const userTag = (scope: PerspectiveScope, tableId?: string) =>
  tableId
    ? `perspectives:user:${scopeKey(scope)}:${tableId}`
    : `perspectives:user:${scopeKey(scope)}`

const roleTag = (roleId: string, tableId?: string, tenantId?: string | null) => {
  const tenant = tenantId ?? 'null'
  return tableId ? `perspectives:role:${roleId}:${tenant}:${tableId}` : `perspectives:role:${roleId}:${tenant}`
}

function toResolvedPerspective(entity: Perspective): ResolvedPerspective {
  return {
    id: entity.id,
    name: entity.name,
    tableId: entity.tableId,
    isDefault: !!entity.isDefault,
    settings: (entity.settingsJson ?? {}) as PerspectiveSettings,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt ? entity.updatedAt.toISOString() : null,
  }
}

function toResolvedRolePerspective(entity: RolePerspective): ResolvedRolePerspective {
  return {
    id: entity.id,
    roleId: entity.roleId,
    tableId: entity.tableId,
    name: entity.name,
    isDefault: !!entity.isDefault,
    settings: (entity.settingsJson ?? {}) as PerspectiveSettings,
    tenantId: nullish(entity.tenantId),
    organizationId: nullish(entity.organizationId),
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt ? entity.updatedAt.toISOString() : null,
  }
}

export async function loadPerspectivesState(
  em: EntityManager,
  cache: CacheStrategy | null | undefined,
  options: { scope: PerspectiveScope; tableId: string; roleIds?: string[] },
): Promise<PerspectivesState> {
  const { scope, tableId } = options
  const roleIds = Array.isArray(options.roleIds) ? options.roleIds.filter((id) => id && id.length > 0) : []
  const uniqueRoles = Array.from(new Set(roleIds))
  const cacheKey = cache && uniqueRoles.length <= 16 ? userCacheKey(scope, tableId, uniqueRoles) : null

  if (cache && cacheKey) {
    const cached = await cache.get<PerspectivesState>(cacheKey)
    if (cached) return cached
  }

  const tenantId = scope.tenantId ?? null
  const organizationId = scope.organizationId ?? null

  const [personal, roleRecords] = await Promise.all([
    em.find(Perspective, {
      userId: scope.userId,
      tenantId,
      organizationId,
      tableId,
      deletedAt: null,
    }, { orderBy: { updatedAt: 'desc' } }),
    uniqueRoles.length
      ? em.find(RolePerspective, {
          roleId: { $in: uniqueRoles as any },
          tableId,
          deletedAt: null,
          $and: [
            { $or: [{ tenantId }, { tenantId: null }] },
            { $or: [{ organizationId }, { organizationId: null }] },
          ],
        } as any, { orderBy: { updatedAt: 'desc' } })
      : [],
  ])

  const personalResolved = personal.map(toResolvedPerspective)
  const personalDefaultId = personalResolved.find((p) => p.isDefault)?.id ?? null
  const roleResolved = roleRecords.map(toResolvedRolePerspective)

  const state: PerspectivesState = {
    tableId,
    personal: personalResolved,
    personalDefaultId,
    rolePerspectives: roleResolved,
  }

  if (cache && cacheKey) {
    await cache.set(cacheKey, state, {
      ttl: CACHE_TTL_MS,
      tags: [
        userTag(scope, tableId),
        ...uniqueRoles.map((roleId) => roleTag(roleId, tableId, tenantId)),
      ],
    })
  }

  return state
}

export async function saveUserPerspective(
  em: EntityManager,
  cache: CacheStrategy | null | undefined,
  options: { scope: PerspectiveScope; tableId: string; input: PerspectiveSaveInput },
): Promise<ResolvedPerspective> {
  const { scope, tableId, input } = options
  const tenantId = scope.tenantId ?? null
  const organizationId = scope.organizationId ?? null

  let entity: Perspective | null = null
  if (input.perspectiveId) {
    entity = await em.findOne(Perspective, {
      id: input.perspectiveId,
      userId: scope.userId,
      tenantId,
      organizationId,
      tableId,
      deletedAt: null,
    })
    if (!entity) {
      throw Object.assign(new Error('Perspective not found'), { code: 'NOT_FOUND' })
    }
  } else {
    entity = await em.findOne(Perspective, {
      userId: scope.userId,
      tenantId,
      organizationId,
      tableId,
      name: input.name,
      deletedAt: null,
    })
  }

  const now = new Date()
  if (!entity) {
    entity = em.create(Perspective, {
      userId: scope.userId,
      tenantId,
      organizationId,
      tableId,
      name: input.name,
      settingsJson: input.settings,
      isDefault: Boolean(input.isDefault),
      createdAt: now,
      updatedAt: now,
    })
    em.persist(entity)
  } else {
    entity.name = input.name
    entity.settingsJson = input.settings
    entity.updatedAt = now
    if (input.isDefault === true) entity.isDefault = true
    if (input.isDefault === false) entity.isDefault = false
  }

  if (input.isDefault === true) {
    await em.nativeUpdate(
      Perspective,
      {
        userId: scope.userId,
        tenantId,
        organizationId,
        tableId,
        id: { $ne: entity.id } as any,
        deletedAt: null,
      },
      { isDefault: false, updatedAt: now },
    )
    entity.isDefault = true
  }

  await em.flush()

  if (cache?.deleteByTags) {
    await cache.deleteByTags([userTag(scope, tableId)])
  }

  return toResolvedPerspective(entity)
}

export async function deleteUserPerspective(
  em: EntityManager,
  cache: CacheStrategy | null | undefined,
  options: { scope: PerspectiveScope; tableId: string; perspectiveId: string },
): Promise<void> {
  const { scope, tableId, perspectiveId } = options
  const tenantId = scope.tenantId ?? null
  const organizationId = scope.organizationId ?? null

  const existing = await em.findOne(Perspective, {
    id: perspectiveId,
    userId: scope.userId,
    tenantId,
    organizationId,
    tableId,
    deletedAt: null,
  })
  if (!existing) return

  existing.deletedAt = new Date()
  existing.isDefault = false
  await em.flush()

  if (cache?.deleteByTags) {
    await cache.deleteByTags([userTag(scope, tableId)])
  }
}

export async function saveRolePerspectives(
  em: EntityManager,
  cache: CacheStrategy | null | undefined,
  options: {
    tableId: string
    tenantId?: string | null
    organizationId?: string | null
    input: RolePerspectiveSaveInput
  },
): Promise<ResolvedRolePerspective[]> {
  const { tableId, input } = options
  const tenantId = options.tenantId ?? null
  const organizationId = options.organizationId ?? null
  const now = new Date()
  const touchedRoleIds = new Set<string>()

  const results: ResolvedRolePerspective[] = []

  for (const roleId of input.roleIds) {
    let record = await em.findOne(RolePerspective, {
      roleId,
      tableId,
      tenantId,
      organizationId,
      name: input.name,
      deletedAt: null,
    })
    if (!record) {
      record = em.create(RolePerspective, {
        roleId,
        tableId,
        tenantId,
        organizationId,
        name: input.name,
        settingsJson: input.settings,
        isDefault: Boolean(input.setDefault),
        createdAt: now,
        updatedAt: now,
      })
      em.persist(record)
    } else {
      record.settingsJson = input.settings
      record.updatedAt = now
      if (input.setDefault === true) record.isDefault = true
      if (input.setDefault === false) record.isDefault = false
    }

    if (input.setDefault === true) {
      await em.nativeUpdate(
        RolePerspective,
        {
          roleId,
          tableId,
          tenantId,
          organizationId,
          id: { $ne: record.id } as any,
          deletedAt: null,
        },
        { isDefault: false, updatedAt: now },
      )
      record.isDefault = true
    }

    touchedRoleIds.add(roleId)
    results.push(toResolvedRolePerspective(record))
  }

  if (input.roleIds.length) {
    await em.flush()
  }

  if (cache?.deleteByTags && touchedRoleIds.size > 0) {
    const tags = Array.from(touchedRoleIds).map((roleId) => roleTag(roleId, tableId, tenantId))
    await cache.deleteByTags(tags)
  }

  return results
}

export async function clearRolePerspectives(
  em: EntityManager,
  cache: CacheStrategy | null | undefined,
  options: {
    tableId: string
    tenantId?: string | null
    organizationId?: string | null
    roleIds: string[]
  },
): Promise<void> {
  const { tableId, roleIds } = options
  const tenantId = options.tenantId ?? null
  const organizationId = options.organizationId ?? null
  if (!roleIds.length) return

  await em.nativeUpdate(
    RolePerspective,
    {
      roleId: { $in: roleIds as any },
      tableId,
      tenantId,
      organizationId,
      deletedAt: null,
    },
    { deletedAt: new Date(), isDefault: false },
  )

  if (cache?.deleteByTags) {
    const tags = roleIds.map((roleId) => roleTag(roleId, tableId, tenantId))
    await cache.deleteByTags(tags)
  }
}
