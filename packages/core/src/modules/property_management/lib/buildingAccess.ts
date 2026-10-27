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
}

export type PermittedBuildings = string[] | null

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

export async function canManageAllBuildings(input: BuildingAccessInput): Promise<boolean> {
  const { auth } = input
  if (!auth) return false
  const rbac = resolveRbac(input.container)
  if (!rbac) return false
  return rbac.userHasAllFeatures(auth.sub, [MANAGE_ALL_BUILDINGS_FEATURE], {
    tenantId: input.tenantId ?? auth.tenantId ?? null,
    organizationId: input.organizationId ?? auth.orgId ?? null,
  })
}

export async function permittedBuildingIds(input: BuildingAccessInput): Promise<PermittedBuildings> {
  const { auth } = input
  if (!auth) return null
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
