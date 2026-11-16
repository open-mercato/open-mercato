import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CustomEntity } from '@open-mercato/core/modules/entities/data/entities'
import type { CustomEntitySpec } from '@open-mercato/shared/modules/entities'
import type { EntityMetadata } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { resolveRegisteredEntityTableName } from '@open-mercato/shared/lib/query/engine'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getModules, resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { classifyRecordsEntity } from '../../lib/entityClassification'
import { assertEntityAclForRequest, resolveEntityAclRequirement } from '../../lib/entityAcl'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['entities.definitions.view'] },
}

const ALLOWED_ROUTE_CONTEXT_FIELDS = new Set(['kind', 'entity_id', 'product_id'])

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

  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? null }
  const classification = await classifyRecordsEntity(em, entityId, scope)
  const declared = getModules().flatMap((entry) => entry.customEntities ?? []).find((entry) => entry.id === entityId) as CustomEntitySpec | undefined
  const requirement = resolveEntityAclRequirement(entityId)
  const registeredTable = resolveRegisteredEntityTableName(em, entityId)
  const forbidden = () => NextResponse.json({ error: translate('api.errors.forbidden', 'Forbidden') }, { status: 403 })

  if (requirement?.platformOnly || (classification.kind === 'system' && !requirement && !declared)) return forbidden()
  if (classification.kind === 'unknown' || (classification.kind === 'system' && !registeredTable)) {
    logger.warn('Relation options requested for an unresolvable entity id', { entityId })
    return NextResponse.json({ items: [] })
  }

  const rbac = container.resolve('rbacService') as RbacService
  if (classification.kind === 'custom' && !(await rbac.userHasAllFeatures(
    auth.sub,
    ['entities.records.view'],
    { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null },
  ))) return forbidden()

  try {
    await assertEntityAclForRequest({
      auth,
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
      { tenantId: auth.tenantId, organizationId: auth.orgId ?? null },
      { tenantId: auth.tenantId, organizationId: null },
      { tenantId: null, organizationId: null },
    ],
  }, { orderBy: { tenantId: 'desc nulls last', organizationId: 'desc nulls last' } }, scope)
  const declaredLabel = declared?.labelField
  const configuredLabel = classification.kind === 'custom' ? customEntity?.labelField : undefined
  const labelCandidates = Array.from(new Set(['name', 'title', 'code', 'email', 'id', declaredLabel, configuredLabel].filter((field): field is string => Boolean(field)).flatMap((field) => [field, field.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()])))
  if (requestedLabelField && !labelCandidates.includes(requestedLabelField)) {
    return NextResponse.json({ error: translate('api.errors.badRequest', 'Bad request') }, { status: 400 })
  }
  const metadata = registeredTable
    ? (Object.values(em.getMetadata().getAll()) as EntityMetadata[]).find((entry) => entry.tableName === registeredTable)
    : undefined
  const fieldsInMetadata = new Set(Object.values(metadata?.properties ?? {}).flatMap((property) => [property.name, ...(property.fieldNames ?? [])]))
  const labelField = requestedLabelField || configuredLabel || declaredLabel || labelCandidates.find((field) => fieldsInMetadata.has(field)) || 'id'
  const filters: Record<string, unknown> = {}
  if (ids.length === 1) filters.id = ids[0]
  else if (ids.length > 1) filters.id = { $in: ids }
  if (q) filters[labelField] = { $ilike: `%${escapeLikePattern(q)}%` }
  const fields = Array.from(new Set(['id', labelField, ...routeContextFields]))
  const res = await qe.query<Record<string, unknown>>(entityId, {
    tenantId: auth.tenantId ?? undefined,
    ...(auth.orgId ? { organizationId: auth.orgId } : {}),
    fields,
    filters,
    ...(classification.kind === 'custom' ? { forceCustomEntityStorage: true } : {}),
    page: { page: 1, pageSize: Math.min(ids.length || 50, 100) },
  })
  const items = (res.items || []).map((it: Record<string, unknown>) => {
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
