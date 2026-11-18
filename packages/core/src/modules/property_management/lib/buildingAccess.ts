import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { BuildingManager } from '../data/entities'

export const MANAGE_ALL_BUILDINGS_FEATURE = 'property_management.buildings.manage_all'
export const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000'

type RbacLike = {
  userHasAllFeatures: (
    userId: string,
    features: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

export type BuildingAccessInput = {
  container: AwilixContainer
  auth: AuthContext | null
  tenantId: string | null
  organizationId: string | null
  system?: boolean
  request?: Request | null
}

export type PermittedBuildings = string[] | null

type RequestMemo<T> = WeakMap<Request, Map<string, Promise<T>>>

const manageAllByRequest: RequestMemo<boolean> = new WeakMap()
const permittedByRequest: RequestMemo<PermittedBuildings> = new WeakMap()

function accessMemoKey(input: BuildingAccessInput): string {
  const { auth } = input
  return [
    auth?.sub ?? '',
    auth?.userId ?? '',
    input.tenantId ?? auth?.tenantId ?? '',
    input.organizationId ?? auth?.orgId ?? '',
    input.system === true ? 'system' : '',
  ].join('|')
}

function memoizePerRequest<T>(memo: RequestMemo<T>, input: BuildingAccessInput, load: () => Promise<T>): Promise<T> {
  const request = input.request
  if (!request) return load()
  let entries = memo.get(request)
  if (!entries) {
    entries = new Map()
    memo.set(request, entries)
  }
  const key = accessMemoKey(input)
  const cached = entries.get(key)
  if (cached) return cached
  const pending = load()
  const store = entries
  store.set(key, pending)
  pending.catch(() => {
    if (store.get(key) === pending) store.delete(key)
  })
  return pending
}

function resolveActorUserId(auth: NonNullable<AuthContext>): string | null {
  const candidate = typeof auth.userId === 'string' && auth.userId.length ? auth.userId : auth.sub
  if (typeof candidate !== 'string' || !candidate.length || candidate.startsWith('api_key:')) return null
  return candidate
}

function resolveRbac(container: AwilixContainer): RbacLike | null {
  try {
    return container.resolve('rbacService') as RbacLike
  } catch {
    return null
  }
}

export function canManageAllBuildings(input: BuildingAccessInput): Promise<boolean> {
  return memoizePerRequest(manageAllByRequest, input, () => resolveManageAll(input))
}

async function resolveManageAll(input: BuildingAccessInput): Promise<boolean> {
  const { auth } = input
  if (!auth) return false
  const rbac = resolveRbac(input.container)
  if (!rbac) return false
  return rbac.userHasAllFeatures(auth.sub, [MANAGE_ALL_BUILDINGS_FEATURE], {
    tenantId: input.tenantId ?? auth.tenantId ?? null,
    organizationId: input.organizationId ?? auth.orgId ?? null,
  })
}

export function permittedBuildingIds(input: BuildingAccessInput): Promise<PermittedBuildings> {
  return memoizePerRequest(permittedByRequest, input, () => resolvePermittedBuildings(input))
}

async function resolvePermittedBuildings(input: BuildingAccessInput): Promise<PermittedBuildings> {
  const { auth } = input
  if (!auth) return input.system === true ? null : []
  if (await canManageAllBuildings(input)) return null
  const userId = resolveActorUserId(auth)
  const tenantId = input.tenantId ?? auth.tenantId ?? null
  const organizationId = input.organizationId ?? auth.orgId ?? null
  if (!userId || !tenantId || !organizationId) return []
  const em = (input.container.resolve('em') as EntityManager).fork()
  const rows = await findWithDecryption(
    em,
    BuildingManager,
    { userId, tenantId, organizationId },
    undefined,
    { tenantId, organizationId },
  )
  return Array.from(new Set(rows.map((row) => row.buildingId)))
}

export function isBuildingPermitted(permitted: PermittedBuildings, buildingId: string): boolean {
  return permitted === null || permitted.includes(buildingId)
}

export function buildingIdFilter(permitted: PermittedBuildings): { $in: string[] } | null {
  if (permitted === null) return null
  return { $in: permitted.length ? permitted : [NO_MATCH_ID] }
}

export async function assertBuildingPermitted(permitted: PermittedBuildings, buildingId: string): Promise<void> {
  if (isBuildingPermitted(permitted, buildingId)) return
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(404, { error: translate('property_management.errors.buildingNotFound', 'Building not found.') })
}
