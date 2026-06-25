import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  buildOptimisticLockConflictBody,
  enforceCommandOptimisticLock,
  enforceRecordGoneIsConflict,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
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

type ExpectedUpdatedAtById = Record<string, string | Date | null | undefined>

const PERSPECTIVE_RESOURCE_KIND = 'perspectives.perspective'
const ROLE_PERSPECTIVE_RESOURCE_KIND = 'perspectives.role_perspective'

function resolveRoleLockInput(
  expectedUpdatedAtByRoleId: ExpectedUpdatedAtById | null | undefined,
  roleId: string,
  request: Request | Headers | null | undefined,
): Pick<Parameters<typeof enforceCommandOptimisticLock>[0], 'expected' | 'request'> {
  if (expectedUpdatedAtByRoleId && Object.prototype.hasOwnProperty.call(expectedUpdatedAtByRoleId, roleId)) {
    return { expected: expectedUpdatedAtByRoleId[roleId] ?? null, request: null }
  }
  return { expected: undefined, request: request ?? null }
}

function resolveRoleRecordLockInput(
  expectedUpdatedAtByPerspectiveId: ExpectedUpdatedAtById | null | undefined,
  expectedUpdatedAtByRoleId: ExpectedUpdatedAtById | null | undefined,
  record: RolePerspective,
  request: Request | Headers | null | undefined,
): Pick<Parameters<typeof enforceCommandOptimisticLock>[0], 'expected' | 'request'> {
  if (expectedUpdatedAtByPerspectiveId && Object.prototype.hasOwnProperty.call(expectedUpdatedAtByPerspectiveId, record.id)) {
    return { expected: expectedUpdatedAtByPerspectiveId[record.id] ?? null, request: null }
  }
  return resolveRoleLockInput(expectedUpdatedAtByRoleId, record.roleId, request)
}

function firstExpectedUpdatedAt(expectedUpdatedAtById: ExpectedUpdatedAtById | null | undefined): string | Date | null {
  if (!expectedUpdatedAtById) return null
  for (const value of Object.values(expectedUpdatedAtById)) {
    if (value instanceof Date) return value
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return null
}

function throwMissingRoleRecordVersionConflict(record: RolePerspective): never {
  const current = record.updatedAt instanceof Date && Number.isFinite(record.updatedAt.getTime())
    ? record.updatedAt.toISOString()
    : new Date(0).toISOString()
  throw new CrudHttpError(409, buildOptimisticLockConflictBody(current, current))
}

const CACHE_TTL_MS = 5 * 60 * 1000

const nullish = <T extends string | null | undefined>(value: T): string | null =>
  value == null ? null : value

const scopeKey = (scope: PerspectiveScope) =>
  `${scope.userId}:${scope.tenantId ?? 'null'}:${scope.organizationId ?? 'null'}`

const userCacheKey = (scope: PerspectiveScope, tableId: string, roleIds: string[]) =>
  `perspectives:user-state:${scopeKey(scope)}:${tableId}:${roleIds.sort((a, b) => a.localeCompare(b)).join(',')}`

const userTag = (scope: PerspectiveScope, tableId?: string) =>
  tableId
    ? `perspectives:user:${scopeKey(scope)}:${tableId}`
    : `perspectives:user:${scopeKey(scope)}`

const roleTag = (roleId: string, tableId?: string, tenantId?: string | null) => {
  const tenant = tenantId ?? 'null'
  return tableId ? `perspectives:role:${roleId}:${tenant}:${tableId}` : `perspectives:role:${roleId}:${tenant}`
}

function isResolvedPerspective(value: unknown): value is ResolvedPerspective {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<ResolvedPerspective>
  return typeof record.id === 'string'
    && typeof record.name === 'string'
    && typeof record.tableId === 'string'
    && typeof record.isDefault === 'boolean'
    && typeof record.createdAt === 'string'
}

function isResolvedRolePerspective(value: unknown): value is ResolvedRolePerspective {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<ResolvedRolePerspective>
  return typeof record.id === 'string'
    && typeof record.roleId === 'string'
    && typeof record.tableId === 'string'
    && typeof record.name === 'string'
    && typeof record.isDefault === 'boolean'
    && typeof record.createdAt === 'string'
}

function isPerspectivesState(value: unknown): value is PerspectivesState {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<PerspectivesState>
  if (typeof record.tableId !== 'string') return false
  if (!Array.isArray(record.personal) || record.personal.some((item) => !isResolvedPerspective(item))) return false
  if (record.personalDefaultId !== null && typeof record.personalDefaultId !== 'string') return false
  if (!Array.isArray(record.rolePerspectives) || record.rolePerspectives.some((item) => !isResolvedRolePerspective(item))) return false
  return true
}

/**
 * Defensive migration for legacy filter state shapes captured before the
 * advanced-filter tree (SPEC-048). Existing perspectives only store either
 * advanced-filter URL params (tree shape with `v:2` or a `root` key) or
 * undefined — this helper is a safety net for legacy `FilterValues`-shaped
 * records (flat key/value records of column filters) that could only appear
 * if old saved-view JSON were imported.
 *
 * - Tree-shaped state (`v:2` or `root` key) is passed through unchanged.
 * - Undefined / null filters are passed through unchanged.
 * - Legacy `FilterValues`-shaped records are dropped (set to `undefined`)
 *   because there is no reliable mapping back to the new operator model;
 *   the user sees an empty tree and can recreate.
 */
export function maybeMigrateLegacyFilterValues(settings: PerspectiveSettings): PerspectiveSettings {
  const filters = settings.filters
  if (!filters || typeof filters !== 'object') return settings
  const record = filters as Record<string, unknown>
  if ('v' in record && record.v === 2) return settings
  if ('root' in record) return settings
  if (typeof console !== 'undefined') {
    console.warn('[perspectives] Dropping legacy filterValues shape; please re-create the perspective with the new filter UI.')
  }
  return { ...settings, filters: undefined }
}

function toResolvedPerspective(entity: Perspective): ResolvedPerspective {
  const settings = maybeMigrateLegacyFilterValues((entity.settingsJson ?? {}) as PerspectiveSettings)
  return {
    id: entity.id,
    name: entity.name,
    tableId: entity.tableId,
    isDefault: !!entity.isDefault,
    settings,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt ? entity.updatedAt.toISOString() : null,
  }
}

function toResolvedRolePerspective(entity: RolePerspective): ResolvedRolePerspective {
  const settings = maybeMigrateLegacyFilterValues((entity.settingsJson ?? {}) as PerspectiveSettings)
  return {
    id: entity.id,
    roleId: entity.roleId,
    tableId: entity.tableId,
    name: entity.name,
    isDefault: !!entity.isDefault,
    settings,
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
    const cached = await cache.get(cacheKey)
    if (cached && isPerspectivesState(cached)) return cached
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
  options: {
    scope: PerspectiveScope
    tableId: string
    input: PerspectiveSaveInput
    request?: Request | Headers | null
  },
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
    enforceCommandOptimisticLock({
      resourceKind: PERSPECTIVE_RESOURCE_KIND,
      resourceId: entity.id,
      current: entity.updatedAt ?? null,
      request: options.request ?? null,
    })
    if (entity.name !== input.name) {
      const duplicate = await em.findOne(Perspective, {
        userId: scope.userId,
        tenantId,
        organizationId,
        tableId,
        name: input.name,
        id: { $ne: entity.id } as any,
        deletedAt: null,
      })
      if (duplicate) {
        throw new CrudHttpError(409, {
          error: 'A view with this name already exists.',
          code: 'duplicate_name',
        })
      }
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
  options: {
    scope: PerspectiveScope
    tableId: string
    perspectiveId: string
    request?: Request | Headers | null
  },
): Promise<boolean> {
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
  if (!existing) {
    enforceRecordGoneIsConflict({
      resourceKind: PERSPECTIVE_RESOURCE_KIND,
      resourceId: perspectiveId,
      request: options.request ?? null,
    })
    return false
  }

  enforceCommandOptimisticLock({
    resourceKind: PERSPECTIVE_RESOURCE_KIND,
    resourceId: existing.id,
    current: existing.updatedAt ?? null,
    request: options.request ?? null,
  })

  existing.deletedAt = new Date()
  existing.isDefault = false
  await em.flush()

  if (cache?.deleteByTags) {
    await cache.deleteByTags([userTag(scope, tableId)])
  }

  return true
}

export async function saveRolePerspectives(
  em: EntityManager,
  cache: CacheStrategy | null | undefined,
  options: {
    tableId: string
    tenantId?: string | null
    organizationId?: string | null
    input: RolePerspectiveSaveInput
    expectedUpdatedAtByRoleId?: ExpectedUpdatedAtById
    expectedUpdatedAtByPerspectiveId?: ExpectedUpdatedAtById
    request?: Request | Headers | null
  },
): Promise<ResolvedRolePerspective[]> {
  const { tableId, input } = options
  const tenantId = options.tenantId ?? null
  const organizationId = options.organizationId ?? null
  const now = new Date()
  const touchedRoleIds = new Set<string>()

  const resultRecords: RolePerspective[] = []

  // Prefetch every matching role perspective in a single query, then index by role id
  // so the loop resolves create/update without a lookup per role.
  const recordByRole = new Map<string, RolePerspective>()
  if (input.roleIds.length) {
    const existingRecords = await em.find(RolePerspective, {
      roleId: { $in: input.roleIds },
      tableId,
      tenantId,
      organizationId,
      name: input.name,
      deletedAt: null,
    })
    for (const existing of existingRecords) recordByRole.set(existing.roleId, existing)
  }
  const defaultRecordsByRole = new Map<string, RolePerspective[]>()
  if (input.setDefault === true && input.roleIds.length) {
    const existingDefaultRecords = await em.find(RolePerspective, {
      roleId: { $in: input.roleIds },
      tableId,
      tenantId,
      organizationId,
      isDefault: true,
      deletedAt: null,
    })
    for (const existing of existingDefaultRecords) {
      const records = defaultRecordsByRole.get(existing.roleId) ?? []
      records.push(existing)
      defaultRecordsByRole.set(existing.roleId, records)
    }
  }

  for (const roleId of input.roleIds) {
    let record = recordByRole.get(roleId) ?? null
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
      recordByRole.set(roleId, record)
    } else {
      enforceCommandOptimisticLock({
        resourceKind: ROLE_PERSPECTIVE_RESOURCE_KIND,
        resourceId: record.id,
        current: record.updatedAt ?? null,
        ...resolveRoleRecordLockInput(
          options.expectedUpdatedAtByPerspectiveId,
          options.expectedUpdatedAtByRoleId,
          record,
          options.request ?? null,
        ),
      })
      record.settingsJson = input.settings
      record.updatedAt = now
      if (input.setDefault === true) record.isDefault = true
      if (input.setDefault === false) record.isDefault = false
    }

    if (input.setDefault === true) {
      for (const defaultRecord of defaultRecordsByRole.get(roleId) ?? []) {
        if (defaultRecord.id === record.id) continue
        enforceCommandOptimisticLock({
          resourceKind: ROLE_PERSPECTIVE_RESOURCE_KIND,
          resourceId: defaultRecord.id,
          current: defaultRecord.updatedAt ?? null,
          ...resolveRoleRecordLockInput(
            options.expectedUpdatedAtByPerspectiveId,
            options.expectedUpdatedAtByRoleId,
            defaultRecord,
            options.request ?? null,
          ),
        })
      }
      await em.nativeUpdate(
        RolePerspective,
        {
          roleId,
          tableId,
          tenantId,
          organizationId,
          id: { $ne: record.id } as any,
          isDefault: true,
          deletedAt: null,
        },
        { isDefault: false, updatedAt: now },
      )
      record.isDefault = true
    }

    touchedRoleIds.add(roleId)
    resultRecords.push(record)
  }

  if (input.roleIds.length) {
    await em.flush()
  }

  if (cache?.deleteByTags && touchedRoleIds.size > 0) {
    const tags = Array.from(touchedRoleIds).map((roleId) => roleTag(roleId, tableId, tenantId))
    await cache.deleteByTags(tags)
  }

  return resultRecords.map(toResolvedRolePerspective)
}

export async function clearRolePerspectives(
  em: EntityManager,
  cache: CacheStrategy | null | undefined,
  options: {
    tableId: string
    tenantId?: string | null
    organizationId?: string | null
    roleIds: string[]
    expectedUpdatedAtByRoleId?: ExpectedUpdatedAtById
    expectedUpdatedAtByPerspectiveId?: ExpectedUpdatedAtById
    request?: Request | Headers | null
  },
): Promise<number> {
  const { tableId, roleIds } = options
  const tenantId = options.tenantId ?? null
  const organizationId = options.organizationId ?? null
  if (!roleIds.length) return 0

  const existingRecords = await em.find(RolePerspective, {
    roleId: { $in: roleIds as any },
    tableId,
    tenantId,
    organizationId,
    deletedAt: null,
  })
  const recordsByRole = new Map<string, RolePerspective[]>()
  for (const record of existingRecords) {
    const records = recordsByRole.get(record.roleId) ?? []
    records.push(record)
    recordsByRole.set(record.roleId, records)
  }

  for (const roleId of roleIds) {
    const records = recordsByRole.get(roleId) ?? []
    const lockInput = resolveRoleLockInput(options.expectedUpdatedAtByRoleId, roleId, options.request ?? null)
    if (!records.length) {
      const expected = firstExpectedUpdatedAt(options.expectedUpdatedAtByPerspectiveId)
      enforceRecordGoneIsConflict({
        resourceKind: ROLE_PERSPECTIVE_RESOURCE_KIND,
        resourceId: roleId,
        expected: expected ?? lockInput.expected,
        request: expected ? null : lockInput.request,
      })
      continue
    }
    for (const record of records) {
      if (
        options.expectedUpdatedAtByPerspectiveId
        && !Object.prototype.hasOwnProperty.call(options.expectedUpdatedAtByPerspectiveId, record.id)
      ) {
        throwMissingRoleRecordVersionConflict(record)
      }
      enforceCommandOptimisticLock({
        resourceKind: ROLE_PERSPECTIVE_RESOURCE_KIND,
        resourceId: record.id,
        current: record.updatedAt ?? null,
        ...resolveRoleRecordLockInput(
          options.expectedUpdatedAtByPerspectiveId,
          options.expectedUpdatedAtByRoleId,
          record,
          options.request ?? null,
        ),
      })
    }
  }

  const affected = await em.nativeUpdate(
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

  return affected
}
