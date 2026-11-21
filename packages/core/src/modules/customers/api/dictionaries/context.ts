import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer, type AppContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CacheStrategy } from '@open-mercato/cache'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customers')

export const CUSTOMER_DICTIONARY_READ_FEATURES = [
  'customers.people.view',
  'customers.companies.view',
  'customers.deals.view',
  'customers.settings.manage',
] as const

const EXTRA_KIND_READ_FEATURES: Readonly<Record<string, readonly string[]>> = {
  activity_type: ['customers.activities.view', 'customers.interactions.view'],
  interaction_status: ['customers.interactions.view', 'customers.activities.view'],
  pipeline_stage: ['customers.pipelines.view'],
  person_company_role: ['customers.roles.view'],
}

export function resolveCustomerDictionaryReadFeatures(mappedKind?: string): string[] {
  const extra = mappedKind && Object.prototype.hasOwnProperty.call(EXTRA_KIND_READ_FEATURES, mappedKind)
    ? EXTRA_KIND_READ_FEATURES[mappedKind]
    : []
  return Array.from(new Set([...CUSTOMER_DICTIONARY_READ_FEATURES, ...extra]))
}

export async function assertCustomerDictionaryReadAccess(params: {
  container: { resolve: (name: string) => unknown }
  auth: { sub?: string | null } | null | undefined
  tenantId: string
  organizationId: string | null
  translate: (key: string, fallback?: string) => string
  mappedKind?: string
}): Promise<void> {
  const requiredFeatures = resolveCustomerDictionaryReadFeatures(params.mappedKind)
  const actorId = typeof params.auth?.sub === 'string' && params.auth.sub.trim().length > 0
    ? params.auth.sub.trim()
    : null
  let rbac: Pick<RbacService, 'userHasAllFeatures'> | undefined
  try {
    rbac = params.container.resolve('rbacService') as Pick<RbacService, 'userHasAllFeatures'> | undefined
  } catch (err) {
    logger.warn('Failed to resolve rbacService for dictionary read access', { component: 'dictionaries.context', err })
    try {
      getTelemetryRuntime()?.reportError(err, {
        module: 'customers',
        code: 'customers.dictionary_rbac_resolve_failed',
      })
    } catch {}
    rbac = undefined
  }
  if (!rbac || typeof rbac.userHasAllFeatures !== 'function' || !actorId) {
    throw new CrudHttpError(403, {
      error: params.translate('api.errors.forbidden', 'Forbidden'),
      requiredFeatures,
    })
  }
  const permissionScope = {
    tenantId: params.tenantId,
    organizationId: params.organizationId,
  }
  for (const feature of requiredFeatures) {
    if (await rbac.userHasAllFeatures(actorId, [feature], permissionScope)) {
      return
    }
  }
  throw new CrudHttpError(403, {
    error: params.translate('api.errors.forbidden', 'Forbidden'),
    requiredFeatures,
  })
}

export const BUILTIN_DICTIONARY_ROUTE_KINDS = [
  'statuses',
  'sources',
  'lifecycle-stages',
  'address-types',
  'activity-types',
  'deal-statuses',
  'pipeline-stages',
  'job-titles',
  'industries',
  'temperature',
  'renewal-quarters',
  'person-company-roles',
  'interaction-statuses',
] as const

type BuiltinDictionaryRouteKind = (typeof BUILTIN_DICTIONARY_ROUTE_KINDS)[number]

const dictionaryCustomKindSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Invalid dictionary kind')

export const dictionaryKindSchema = z.union([
  z.enum(BUILTIN_DICTIONARY_ROUTE_KINDS),
  dictionaryCustomKindSchema,
])

export type DictionaryRouteParam = z.infer<typeof dictionaryKindSchema>
export type DictionaryEntityKind = string

const KIND_MAP: Record<BuiltinDictionaryRouteKind, DictionaryEntityKind> = {
  statuses: 'status',
  sources: 'source',
  'lifecycle-stages': 'lifecycle_stage',
  'address-types': 'address_type',
  'activity-types': 'activity_type',
  'deal-statuses': 'deal_status',
  'pipeline-stages': 'pipeline_stage',
  'job-titles': 'job_title',
  industries: 'industry',
  temperature: 'temperature',
  'renewal-quarters': 'renewal_quarter',
  'person-company-roles': 'person_company_role',
  'interaction-statuses': 'interaction_status',
}

export const paramsSchema = z.object({
  kind: dictionaryKindSchema,
})

export type DictionaryRouteContext = {
  auth: Awaited<ReturnType<typeof getAuthFromRequest>>
  translate: (key: string, fallback?: string) => string
  em: EntityManager
  organizationId: string | null
  tenantId: string
  readableOrganizationIds: string[]
  cache?: CacheStrategy
  container: AppContainer
  ctx: CommandRuntimeContext
}

export function resolveDictionaryActorId(
  auth: Awaited<ReturnType<typeof getAuthFromRequest>>,
): string {
  if (auth && typeof auth.sub === 'string' && auth.sub.trim().length > 0) return auth.sub
  if (auth && typeof auth.userId === 'string' && auth.userId.trim().length > 0) return auth.userId
  if (auth && typeof auth.keyId === 'string' && auth.keyId.trim().length > 0) return auth.keyId
  return 'system'
}

export function mapDictionaryKind(kind: string | undefined) {
  const parsed = paramsSchema.parse({ kind })
  const mappedKind = Object.prototype.hasOwnProperty.call(KIND_MAP, parsed.kind)
    ? KIND_MAP[parsed.kind as BuiltinDictionaryRouteKind]
    : parsed.kind
  return {
    kind: parsed.kind,
    mappedKind,
  }
}

export async function resolveDictionaryRouteContext(
  req: Request,
  options?: { selectedId?: string | null },
): Promise<DictionaryRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('customers.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({
    container,
    auth,
    request: req,
    selectedId: options?.selectedId,
  })
  const em = (container.resolve('em') as EntityManager)
  const tenantId = scope?.tenantId ?? auth.tenantId
  const organizationId = resolveSingleOrganizationIdOrDeny(scope, auth) ?? null

  const normalizeId = (value: unknown): string | null => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  const candidateIds = new Set<string>()
  const pushCandidate = (value: unknown) => {
    const normalized = normalizeId(value)
    if (normalized) candidateIds.add(normalized)
  }

  pushCandidate(organizationId)
  pushCandidate(auth.orgId ?? null)
  if (Array.isArray(scope?.filterIds)) {
    for (const id of scope.filterIds) pushCandidate(id)
  }
  if (Array.isArray(scope?.allowedIds)) {
    for (const id of scope.allowedIds) pushCandidate(id)
  }

  let cache: CacheStrategy | undefined
  try {
    cache = (container.resolve('cache') as CacheStrategy)
  } catch {}

  const readableOrganizationIds = new Set<string>()
  try {
    const shouldLoadAll = candidateIds.size === 0
    const organizations = await em.find(
      Organization,
      {
        tenant: tenantId as any,
        deletedAt: null,
        ...(shouldLoadAll ? {} : { id: { $in: Array.from(candidateIds) } }),
      } as any,
      { fields: ['id', 'ancestorIds'] },
    )
    for (const organization of organizations) {
      const id = normalizeId(organization.id)
      if (id) readableOrganizationIds.add(id)
      if (Array.isArray(organization.ancestorIds)) {
        for (const ancestorId of organization.ancestorIds) {
          const normalized = normalizeId(ancestorId)
          if (normalized) readableOrganizationIds.add(normalized)
        }
      }
    }
    if (!shouldLoadAll && readableOrganizationIds.size === 0) {
      for (const id of candidateIds) readableOrganizationIds.add(id)
    }
  } catch (err) {
    logger.warn('Failed to resolve ancestor organizations', { component: 'dictionaries.context', err })
    for (const id of candidateIds) readableOrganizationIds.add(id)
  }

  const commandContext: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }

  return {
    auth,
    translate,
    em,
    organizationId,
    tenantId,
    readableOrganizationIds: Array.from(readableOrganizationIds),
    cache,
    container,
    ctx: commandContext,
  }
}
