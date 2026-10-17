import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { Role, RoleAcl, User, UserAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'

/**
 * An in-memory EntityManager for the RBAC loaders: it answers the MikroORM query shapes
 * `loadAclWithEntityManager`, `listSuperAdminUserIds` and `previewRoleAclChange` use (equality,
 * `$in`, `null`, relation ids and one level of relation properties such as `role: { tenantId }`)
 * over plain rows, so both sides of a parity test read exactly the same data. Writes are spies
 * that must never be called by a preview.
 */
export type FakeRole = { id: string; tenantId: string; name: string; deletedAt: Date | null }

export type FakeRows = {
  roles: FakeRole[]
  roleAcls: Array<{ id: string; role: FakeRole; tenantId: string; isSuperAdmin: boolean; featuresJson: string[] | null; organizationsJson: string[] | null; updatedAt?: Date | null }>
  users: Array<{ id: string; tenantId: string | null; organizationId: string | null; email: string; name: string | null; deletedAt: Date | null }>
  userRoles: Array<{ id: string; user: { id: string }; role: FakeRole }>
  userAcls: Array<{ id: string; user: { id: string }; tenantId: string; isSuperAdmin: boolean; featuresJson: string[] | null; organizationsJson: string[] | null }>
  apiKeys: Array<{ id: string; tenantId: string | null; organizationId: string | null; rolesJson: string[] | null; deletedAt: Date | null; expiresAt: Date | null; sessionUserId: string | null; name: string; keyPrefix: string }>
  organizations: Array<{ id: string; tenant: { id: string }; tenantId: string; name: string; ancestorIds: string[]; deletedAt: Date | null }>
}

export function emptyRows(): FakeRows {
  return { roles: [], roleAcls: [], users: [], userRoles: [], userAcls: [], apiKeys: [], organizations: [] }
}

type Row = Record<string, unknown>

function idOf(value: unknown): unknown {
  if (value && typeof value === 'object' && 'id' in value) return (value as { id: unknown }).id
  return value
}

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (expected === null) return actual === null || actual === undefined
  if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
    const condition = expected as Record<string, unknown>
    if ('$in' in condition) {
      const list = (condition.$in as unknown[]).map((entry) => String(idOf(entry)).toLowerCase())
      return list.includes(String(idOf(actual)).toLowerCase())
    }
    if ('id' in condition && Object.keys(condition).length === 1) return matchesValue(idOf(actual), condition.id)
    if (!actual || typeof actual !== 'object') return false
    return matchesWhere(actual as Row, condition)
  }
  const left = idOf(actual)
  if (typeof left === 'string' && typeof expected === 'string') return left.toLowerCase() === expected.toLowerCase()
  return left === expected
}

function matchesWhere(row: Row, where: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(where)) {
    if (!matchesValue(row[key], expected)) return false
  }
  return true
}

export type FakeEntityManager = {
  find: jest.Mock
  findOne: jest.Mock
  fork: jest.Mock
  persist: jest.Mock
  flush: jest.Mock
  nativeUpdate: jest.Mock
  nativeDelete: jest.Mock
  insert: jest.Mock
  remove: jest.Mock
  create: jest.Mock
  transactional: jest.Mock
  rows: FakeRows
}

export function createFakeEntityManager(rows: FakeRows): FakeEntityManager {
  const tableOf = (entity: unknown): Row[] => {
    if (entity === Role) return rows.roles as unknown as Row[]
    if (entity === RoleAcl) return rows.roleAcls as unknown as Row[]
    if (entity === User) return rows.users as unknown as Row[]
    if (entity === UserRole) return rows.userRoles as unknown as Row[]
    if (entity === UserAcl) return rows.userAcls as unknown as Row[]
    if (entity === ApiKey) return rows.apiKeys as unknown as Row[]
    if (entity === Organization) return rows.organizations as unknown as Row[]
    throw new Error(`[internal] unexpected entity ${String((entity as { name?: string })?.name ?? entity)}`)
  }
  const em: FakeEntityManager = {
    rows,
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => tableOf(entity).filter((row) => matchesWhere(row, where ?? {}))),
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => tableOf(entity).find((row) => matchesWhere(row, where ?? {})) ?? null),
    fork: jest.fn(() => em),
    persist: jest.fn(),
    flush: jest.fn(),
    nativeUpdate: jest.fn(),
    nativeDelete: jest.fn(),
    insert: jest.fn(),
    remove: jest.fn(),
    create: jest.fn(),
    transactional: jest.fn(),
  }
  return em
}

/** A deterministic PRNG (mulberry32) for property-style scenarios. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function uuidOf(prefix: number, index: number): string {
  const hex = (prefix * 4096 + index).toString(16).padStart(12, '0')
  return `00000000-0000-4000-8000-${hex}`
}
