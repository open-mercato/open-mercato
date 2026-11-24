import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CustomEntity } from '@open-mercato/core/modules/entities/data/entities'
import type { CustomEntitySpec } from '@open-mercato/shared/modules/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { SortDir, type QueryEngine, type QueryOptions } from '@open-mercato/shared/lib/query/types'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { relationOptionAccessKey, type RelationOptionAccess } from '@open-mercato/shared/lib/query/relationOptionAccess'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { listEntityMetadata } from '@open-mercato/shared/lib/db/entityMetadata'
import { resolveRegisteredEntityTableName } from '@open-mercato/shared/lib/query/engine'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getModules, resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { classifyRecordsEntity } from '../../lib/entityClassification'
import { assertEntityAclForRequest, resolveEntityAclRequirement } from '../../lib/entityAcl'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { getSelectedOrganizationFromRequest, resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isAllOrganizationsSelection } from '@open-mercato/core/modules/directory/constants'
import { isExplicitlyEmptyOrganizationScope } from '@open-mercato/shared/lib/auth/organizationScope'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['entities.definitions.view'] },
}

const ALLOWED_ROUTE_CONTEXT_FIELDS = new Set(['kind', 'entity_id', 'product_id'])
const RECORD_POLICY_TARGETS = new Set(['staff:staff_time_entry', 'attachments:attachment'])
const DEFAULT_LABEL_FIELDS = ['name', 'title', 'code', 'email', 'id']

const logger = createLogger('entities')

export async function GET(req: Request) {
  const url = new URL(req.url)
  const entityId = url.searchParams.get('entityId') || ''
  const requestedLabelField = url.searchParams.get('labelField') || ''
  const q = url.searchParams.get('q') || ''
  const ids = Array.from(
    new Set(
      (url.searchParams.get('ids') || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  )
  const routeContextFields = Array.from(
    new Set(
      (url.searchParams.get('routeContextFields') || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => ALLOWED_ROUTE_CONTEXT_FIELDS.has(entry)),
    ),
  )
  const { translate } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId || (!auth.orgId && !auth.isSuperAdmin)) return NextResponse.json({ error: translate('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  if (!entityId) return NextResponse.json({ items: [] })
  const parsed = relationOptionsQuerySchema.safeParse({
    entityId,
    labelField: requestedLabelField,
    q,
    ids: url.searchParams.get('ids') ?? undefined,
    routeContextFields: url.searchParams.get('routeContextFields') ?? undefined,
  })
  if (!parsed.success) return NextResponse.json({ error: translate('api.errors.badRequest', 'Bad request') }, { status: 400 })

  const container = await createRequestContainer()
  const qe = container.resolve('queryEngine') as QueryEngine
  const em = container.resolve('em') as EntityManager

  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const forbidden = () => NextResponse.json({ error: translate('api.errors.forbidden', 'Forbidden') }, { status: 403 })
  if (!organizationScope.tenantId || organizationScope.selectionRejected || isExplicitlyEmptyOrganizationScope(organizationScope)) return forbidden()
  const requestedOrganizationId = getSelectedOrganizationFromRequest(req)?.trim()
  if (requestedOrganizationId && !isAllOrganizationsSelection(requestedOrganizationId) && organizationScope.selectedId !== requestedOrganizationId) return forbidden()
  const scope = { tenantId: organizationScope.tenantId, organizationId: organizationScope.selectedId }
  const scopedAuth = { ...auth, tenantId: scope.tenantId, orgId: scope.organizationId }
  const classification = await classifyRecordsEntity(em, entityId, scope)
  const declared = getModules().flatMap((entry) => entry.customEntities ?? []).find((entry) => entry.id === entityId) as CustomEntitySpec | undefined
  const requirement = resolveEntityAclRequirement(entityId)
  const registeredTable = resolveRegisteredEntityTableName(em, entityId)

  if (requirement?.platformOnly || (classification.kind === 'system' && !requirement && !declared)) return forbidden()
  if (classification.kind === 'unknown' || (classification.kind === 'system' && !registeredTable)) {
    logger.warn('Relation options requested for an unresolvable entity id', { entityId })
    return NextResponse.json({ items: [] })
  }

  const rbac = container.resolve('rbacService') as RbacService
  if (classification.kind === 'custom' && !(await rbac.userHasAllFeatures(
    auth.sub,
    ['entities.records.view'],
    scope,
  ))) return forbidden()

  try {
    await assertEntityAclForRequest({
      auth: scopedAuth,
      entityId,
      action: 'view',
      isCustomEntity: classification.kind === 'custom',
      isRestricted: classification.restricted || declared?.accessRestricted === true,
      rbac,
    })
  } catch (error) {
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    throw error
  }

  const customEntity = await findOneWithDecryption(em, CustomEntity, {
    entityId,
    isActive: true,
    deletedAt: null,
    $or: [
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
      { tenantId: scope.tenantId, organizationId: null },
      { tenantId: null, organizationId: null },
    ],
  }, { orderBy: { tenantId: 'desc nulls last', organizationId: 'desc nulls last' } }, scope)
  const declaredLabel = declared?.labelField
  const configuredLabel = classification.kind === 'custom' ? customEntity?.labelField : undefined
  const labelCandidates = [declaredLabel, configuredLabel, ...DEFAULT_LABEL_FIELDS]
    .filter((field): field is string => Boolean(field))
  const metadata = registeredTable
    ? listEntityMetadata(em).find((entry) => entry.tableName === registeredTable)
    : undefined
  const columnsByLabel = new Map<string, string>()
  for (const property of Object.values(metadata?.properties ?? {})) {
    if (property.fieldNames?.length !== 1) continue
    const [column] = property.fieldNames
    if (!labelCandidates.includes(property.name) && !labelCandidates.includes(column)) continue
    columnsByLabel.set(property.name, column)
    columnsByLabel.set(column, column)
  }
  const customLabelAliases = classification.kind === 'custom'
    ? labelCandidates.map((field) => field.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase())
    : []
  if (requestedLabelField && !labelCandidates.includes(requestedLabelField) &&
    !columnsByLabel.has(requestedLabelField) && !customLabelAliases.includes(requestedLabelField)) {
    return NextResponse.json({ error: translate('api.errors.badRequest', 'Bad request') }, { status: 400 })
  }
  const systemLabel = [requestedLabelField, ...labelCandidates]
    .map((field) => columnsByLabel.get(field))
    .find((column) => column !== undefined)
  const labelField = classification.kind === 'custom'
    ? requestedLabelField || configuredLabel || declaredLabel || 'id'
    : systemLabel ?? 'id'
  const filters: Record<string, unknown> = {}
  if (ids.length === 1) filters.id = ids[0]
  else if (ids.length > 1) filters.id = { $in: ids }
  if (q) filters[labelField] = { $ilike: `%${escapeLikePattern(q)}%` }
  const fields = Array.from(new Set(['id', labelField, ...routeContextFields]))
  const pageSize = Math.min(ids.length || 50, 100)
  const queryOptions: QueryOptions = {
    tenantId: scope.tenantId,
    ...(scope.organizationId
      ? { organizationId: scope.organizationId }
      : Array.isArray(organizationScope.filterIds) ? { organizationIds: organizationScope.filterIds } : {}),
    fields,
    filters,
    ...(classification.kind === 'custom' ? { forceCustomEntityStorage: true } : {}),
    page: { page: 1, pageSize },
  }
  let rows: Record<string, unknown>[]
  if (classification.kind === 'system' && RECORD_POLICY_TARGETS.has(entityId)) {
    const resolveAccess = container.resolve<RelationOptionAccess>(relationOptionAccessKey(entityId), { allowUnregistered: true })
    if (!resolveAccess) return forbidden()
    const tenantId = scope.tenantId
    const organizationIds = scope.organizationId
      ? [scope.organizationId]
      : organizationScope.filterIds ?? (await findWithDecryption(
        em, Organization, { tenant: tenantId, deletedAt: null }, { fields: ['id'] }, { tenantId },
      )).map((organization) => organization.id)
    rows = []
    try {
      for (const organizationId of organizationIds) {
        if (requirement && !(await rbac.userHasAllFeatures(auth.sub, requirement.view, { tenantId, organizationId }))) continue
        const access = await resolveAccess({ auth: scopedAuth, container, tenantId, organizationId })
        if (!access) continue
        const scopedOptions = {
          ...queryOptions,
          organizationId,
          organizationIds: undefined,
          omitAutomaticTenantOrgScope: true,
        }
        const scopeFilters = { tenant_id: tenantId, organization_id: organizationId }
        const remaining = pageSize - rows.length
        if (access.authorizeIds) {
          const candidateFilters = ids.length ? { id: { $in: ids } } : {}
          let lastId: string | undefined
          while (rows.length < pageSize) {
            const candidates = await qe.query<{ id: string }>(entityId, {
              ...scopedOptions,
              fields: ['id'],
              filters: { $and: [scopeFilters, candidateFilters, ...(lastId ? [{ id: { $gt: lastId } }] : [])] },
              sort: [{ field: 'id', dir: SortDir.Asc }],
              page: { page: 1, pageSize: 100 },
            })
            if (candidates.items.length === 0) break
            const authorizedIds = await access.authorizeIds(candidates.items.map(({ id }) => id))
            if (authorizedIds.length) {
              const result = await qe.query<Record<string, unknown>>(entityId, {
                ...scopedOptions,
                filters: { $and: [scopeFilters, filters, { id: { $in: authorizedIds } }] },
                page: { page: 1, pageSize: pageSize - rows.length },
              })
              rows.push(...result.items)
            }
            if (candidates.items.length < 100) break
            lastId = candidates.items.at(-1)?.id
          }
        } else if (access.filters) {
          const result = await qe.query<Record<string, unknown>>(entityId, {
            ...scopedOptions,
            filters: { $and: [scopeFilters, filters, access.filters] },
            page: { page: 1, pageSize: remaining },
          })
          rows.push(...result.items)
        }
        if (rows.length >= pageSize) break
      }
    } catch (error) {
      if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
      throw error
    }
  } else {
    rows = (await qe.query<Record<string, unknown>>(entityId, queryOptions)).items ?? []
  }
  const items = rows.map((it) => {
    const routeContext = routeContextFields.reduce<Record<string, unknown>>((acc, field) => {
      if (it[field] !== undefined) {
        acc[field] = it[field]
      }
      return acc
    }, {})
    return {
      value: String(it.id),
      label: String(it[labelField] ?? it.id),
      ...(Object.keys(routeContext).length > 0 ? { routeContext } : {}),
    }
  })
  return NextResponse.json({ items })
}

const relationOptionsQuerySchema = z.object({
  entityId: z.string().min(1),
  labelField: z.string().optional(),
  q: z.string().optional(),
  ids: z.string().optional(),
  routeContextFields: z.string().optional(),
})

const relationOptionsResponseSchema = z.object({
  items: z.array(
    z.object({
      value: z.string(),
      label: z.string(),
      routeContext: z.record(z.string(), z.unknown()).optional(),
    })
  ),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Entities',
  summary: 'Relation options lookup',
  methods: {
    GET: {
      summary: 'List relation options',
      description: 'Returns up to 100 option entries for populating relation dropdowns, requiring target read access and accepting only declared or fixed safe label fields. An entityId that matches neither an active custom entity nor a registered ORM entity yields an empty option list.',
      query: relationOptionsQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Option list',
          schema: relationOptionsResponseSchema,
        },
        {
          status: 400,
          description: 'Unsafe label selector',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 403,
          description: 'Target entity access denied',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 401,
          description: 'Missing authentication',
          schema: z.object({ error: z.string() }),
        },
      ],
    },
  },
}
