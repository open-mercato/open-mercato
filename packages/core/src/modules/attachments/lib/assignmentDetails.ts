import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import type { AttachmentAssignment } from './metadata'
import type { CustomEntitySpec } from '@open-mercato/shared/modules/entities'
import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { getModules } from '@open-mercato/shared/lib/i18n/server'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { classifyRecordsEntity } from '@open-mercato/core/modules/entities/lib/entityClassification'
import { assertEntityAclForRequest, resolveEntityAclRequirement } from '@open-mercato/core/modules/entities/lib/entityAcl'
import { RECORDS_VIEW_FEATURE } from '@open-mercato/core/modules/entities/lib/recordFeatures'
import { getApiInterceptorsForRoute } from '@open-mercato/shared/lib/crud/interceptor-registry'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { collectQuerySubscribers, entityIdToEventEntity } from '@open-mercato/shared/lib/query/query-extension-runner'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('attachments')

type AssignmentReadPolicy = { route: string; feature: string; kind?: string }

type AssignmentLinkSpec = {
  readPolicies: AssignmentReadPolicy[]
  labelFields: string[]
  extraFields?: string[]
  parent?: { entityId: string; table: string; foreignKey: string; kind?: string; route?: string }
  buildHref?: (record: Record<string, unknown>) => string | null | undefined
}

function getEntityLinkSpecs(): Record<string, AssignmentLinkSpec> {
  const E = getEntityIds(false)
  const specs: Record<string, AssignmentLinkSpec> = {}

  if (E.catalog?.catalog_product) {
    specs[E.catalog.catalog_product] = {
      readPolicies: [{ route: 'catalog/products', feature: 'catalog.products.view' }],
      labelFields: ['title', 'sku', 'handle'],
      buildHref: (record) => buildSimpleHref('/backend/catalog/products', record.id),
    }
  }
  if (E.catalog?.catalog_product_variant) {
    specs[E.catalog.catalog_product_variant] = {
      readPolicies: [{ route: 'catalog/variants', feature: 'catalog.products.view' }],
      labelFields: ['name', 'sku'],
      extraFields: ['product_id'],
      parent: { entityId: E.catalog.catalog_product, table: 'catalog_products', foreignKey: 'product_id', route: 'catalog/products' },
      buildHref: (record) => {
        const productId = readRecordValue(record, 'product_id')
        if (!productId) return null
        return `/backend/catalog/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(String(record.id ?? ''))}`
      },
    }
  }
  if (E.customers?.customer_entity) {
    specs[E.customers.customer_entity] = {
      readPolicies: [
        { route: 'customers/people', feature: 'customers.people.view', kind: 'person' },
        { route: 'customers/companies', feature: 'customers.companies.view', kind: 'company' },
      ],
      labelFields: ['display_name'],
      extraFields: ['kind'],
      buildHref: (record) => {
        const kind = String(readRecordValue(record, 'kind') || '').toLowerCase()
        if (kind === 'company') return buildSimpleHref('/backend/customers/companies', record.id)
        if (kind === 'person') return buildSimpleHref('/backend/customers/people', record.id)
        return null
      },
    }
  }
  if (E.customers?.customer_person_profile) {
    specs[E.customers.customer_person_profile] = {
      readPolicies: [{ route: 'customers/people', feature: 'customers.people.view' }],
      labelFields: ['preferred_name'],
      extraFields: ['entity_id', 'first_name', 'last_name'],
      parent: { entityId: E.customers.customer_entity, table: 'customer_entities', foreignKey: 'entity_id', kind: 'person' },
      buildHref: (record) => {
        const entityId = readRecordValue(record, 'entity_id')
        return entityId ? buildSimpleHref('/backend/customers/people', entityId) : null
      },
    }
  }
  if (E.customers?.customer_company_profile) {
    specs[E.customers.customer_company_profile] = {
      readPolicies: [{ route: 'customers/companies', feature: 'customers.companies.view' }],
      labelFields: ['brand_name', 'legal_name'],
      extraFields: ['entity_id'],
      parent: { entityId: E.customers.customer_entity, table: 'customer_entities', foreignKey: 'entity_id', kind: 'company' },
      buildHref: (record) => {
        const entityId = readRecordValue(record, 'entity_id')
        return entityId ? buildSimpleHref('/backend/customers/companies', entityId) : null
      },
    }
  }
  if (E.customers?.customer_deal) {
    specs[E.customers.customer_deal] = {
      readPolicies: [{ route: 'customers/deals', feature: 'customers.deals.view' }],
      labelFields: ['title'],
      buildHref: (record) => buildSimpleHref('/backend/customers/deals', record.id),
    }
  }
  if (E.sales?.sales_channel) {
    specs[E.sales.sales_channel] = {
      readPolicies: [{ route: 'sales/channels', feature: 'sales.channels.view' }],
      labelFields: ['name'],
      buildHref: (record) => buildSimpleHref('/backend/sales/channels', record.id, '/edit'),
    }
  }

  return specs
}

const LIBRARY_ENTITY_ID = 'attachments:library'
const DEFAULT_LABEL_FIELDS = [
  'label',
  'title',
  'name',
  'display_name',
  'displayName',
  'subject',
  'sku',
  'handle',
  'order_number',
  'quote_number',
  'invoice_number',
  'email',
  'company_name',
  'legal_name',
  'brand_name',
]

export type AssignmentEnrichment = {
  label?: string
  href?: string
}

export type AssignmentEnrichmentMap = Map<string, AssignmentEnrichment>

function camelToSnake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
}

function snakeToCamel(value: string): string {
  return value.replace(/[_-](\w)/g, (_, c: string) => c.toUpperCase())
}

function normalizeValue(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length ? trimmed : null
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return null
}

function readRecordValue(record: Record<string, unknown>, field: string): string | null {
  if (!field) return null
  if (record[field] !== undefined) return normalizeValue(record[field])
  const snake = camelToSnake(field)
  if (snake !== field && record[snake] !== undefined) return normalizeValue(record[snake])
  const camel = snakeToCamel(field)
  if (camel !== field && record[camel] !== undefined) return normalizeValue(record[camel])
  return null
}

function buildSimpleHref(base: string, idValue: unknown, suffix: string = ''): string | null {
  const id = normalizeValue(idValue)
  if (!id) return null
  return `${base}/${encodeURIComponent(id)}${suffix}`
}

function isUuid(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())
}

function hasReadHooks(route: string): boolean {
  return getApiInterceptorsForRoute(route, 'GET').length > 0
}

function hasQueryHooks(entityId: string): boolean {
  const eventEntity = entityIdToEventEntity(entityId)
  return collectQuerySubscribers(`${eventEntity}.querying`).length > 0
    || collectQuerySubscribers(`${eventEntity}.queried`).length > 0
}

type AssignmentAuthorizationContext = {
  auth: NonNullable<AuthContext>
  container: AwilixContainer
}

export async function resolveAssignmentEnrichments(
  assignments: AttachmentAssignment[],
  opts: {
    queryEngine?: QueryEngine | null
    tenantId: string
    organizationId: string | null
    authorization?: AssignmentAuthorizationContext
  },
): Promise<AssignmentEnrichmentMap> {
  const map: AssignmentEnrichmentMap = new Map()
  const { queryEngine, tenantId, organizationId, authorization } = opts
  if (!assignments.length || !queryEngine || !organizationId || !authorization) return map
  const { auth, container } = authorization
  if (!auth?.sub || !tenantId || auth.tenantId !== tenantId || auth.orgId !== organizationId) return map

  const grouped = new Map<string, Set<string>>()
  for (const assignment of assignments) {
    const type = assignment?.type?.trim()
    const id = assignment?.id?.trim()
    if (!type || type === LIBRARY_ENTITY_ID || !isUuid(id)) continue
    if (assignment.label && assignment.href) continue
    const ids = grouped.get(type) ?? new Set<string>()
    ids.add(id)
    grouped.set(type, ids)
  }
  if (!grouped.size) return map

  try {
    const em = container.resolve<EntityManager>('em')
    const rbac = container.resolve<RbacService>('rbacService')
    const scope = { tenantId, organizationId }
    const acl = await rbac.loadAcl(auth.sub, scope)
    if (!acl.isSuperAdmin && acl.organizations
      && !acl.organizations.includes(organizationId) && !acl.organizations.includes('__all__')) return map
    const hasFeature = (feature: string) => authorizeFeatures([feature], {
      grantedFeatures: acl.features,
      unrestricted: acl.isSuperAdmin,
    })
    const modules = getModules()
    const entitySpecs = new Map<string, CustomEntitySpec>()
    for (const moduleEntry of modules) {
      for (const spec of (moduleEntry.customEntities ?? []) as CustomEntitySpec[]) {
        if (!entitySpecs.has(spec.id)) entitySpecs.set(spec.id, spec)
      }
    }
    const moduleIds = new Set(modules.map((moduleEntry) => moduleEntry.id))
    const entityLinkSpecs = getEntityLinkSpecs()
    for (const [entityId, ids] of grouped) {
      try {
        const linkSpec = Object.hasOwn(entityLinkSpecs, entityId) ? entityLinkSpecs[entityId] : undefined
        const parent = linkSpec?.parent
        if (parent && (hasQueryHooks(parent.entityId) || (parent.route && hasReadHooks(parent.route)))) continue
        const declaredRequirement = resolveEntityAclRequirement(entityId)
        if (declaredRequirement?.platformOnly) continue
        const readPolicies = linkSpec?.readPolicies.filter(({ route, feature }) => (
          !hasReadHooks(route) && hasFeature(feature)
        )) ?? []
        if (linkSpec && (!readPolicies.length || !moduleIds.has(entityId.split(':')[0]))) continue
        if (!linkSpec && (!hasFeature(RECORDS_VIEW_FEATURE) || !moduleIds.has('entities')
          || !moduleIds.has('query_index') || queryEngine instanceof BasicQueryEngine
          || hasReadHooks('entities/records'))) continue
        // These reads do not participate in the source endpoint's query pipeline.
        if (hasQueryHooks(entityId)) continue
        const classification = await classifyRecordsEntity(em, entityId, scope)
        if (linkSpec ? classification.kind !== 'system' : classification.kind !== 'custom') continue
        if (!linkSpec || declaredRequirement) {
          await assertEntityAclForRequest({
            auth, entityId, action: 'view', rbac,
            isCustomEntity: !linkSpec, isRestricted: classification.restricted,
          })
        }

        if (parent) {
          // The engine drops predicates for missing joined columns. Validate the
          // actual parent table before allowing it to participate in the lookup.
          await em.getKysely<Record<string, Record<string, unknown>>>()
            .selectFrom(parent.table)
            .select(['id', 'tenant_id', 'organization_id', 'deleted_at', ...(parent.kind ? ['kind'] : [])])
            .limit(0)
            .execute()
        }
        const kinds = readPolicies.flatMap((policy) => policy.kind ? [policy.kind] : [])
        const customLabel = entitySpecs.get(entityId)?.labelField
        const candidates = linkSpec?.labelFields ?? [...(customLabel ? [customLabel] : []), ...DEFAULT_LABEL_FIELDS]
        const fields = [...new Set(['id', ...candidates, ...(linkSpec?.extraFields ?? [])])]
        const allowedIds = [...ids]
        for (let offset = 0; offset < allowedIds.length; offset += 100) {
          const batch = allowedIds.slice(offset, offset + 100)
          const result = await queryEngine.query<Record<string, unknown>>(entityId, {
            ...scope,
            fields,
            filters: {
              id: { $in: batch },
              ...(kinds.length ? { 'base.kind': { $in: kinds } } : {}),
              // Qualified base predicates cannot fall back to an index field or
              // silently disappear when a scope column is missing.
              ...(linkSpec ? { 'base.tenant_id': tenantId, 'base.organization_id': organizationId } : {}),
              ...(parent ? {
                'parent.tenant_id': tenantId,
                'parent.organization_id': organizationId,
                'parent.deleted_at': null,
                ...(parent.kind ? { 'parent.kind': parent.kind } : {}),
              } : {}),
            },
            ...(parent ? {
              joins: [{ alias: 'parent', table: parent.table, from: { field: parent.foreignKey }, to: { field: 'id' }, type: 'inner' }],
            } : {}),
            ...(linkSpec ? { omitAutomaticTenantOrgScope: true } : { forceCustomEntityStorage: true }),
            page: { pageSize: batch.length },
          })
          for (const record of result.items ?? []) {
            const recordId = normalizeValue(record.id)
            if (!recordId || !batch.includes(recordId) || (kinds.length && !kinds.includes(String(record.kind)))) continue
            const label = candidates.map((field) => readRecordValue(record, field)).find((value): value is string => Boolean(value))
              ?? ([readRecordValue(record, 'first_name'), readRecordValue(record, 'last_name')].filter(Boolean).join(' ') || undefined)
            const href = linkSpec?.buildHref?.(record) ?? undefined
            if (label || href) map.set(`${entityId}:${recordId}`, { label, href })
          }
        }
      } catch (error) {
        if (isCrudHttpError(error) && error.status === 403) continue
        reportAssignmentEnrichmentFailure(error)
      }
    }
  } catch (error) {
    reportAssignmentEnrichmentFailure(error)
  }
  return map
}

function reportAssignmentEnrichmentFailure(error: unknown): void {
  const failure = new Error('[internal] Failed to resolve authorized assignment details')
  getTelemetryRuntime()?.reportError(failure, {
    module: 'attachments', code: 'attachments.assignment_enrichment_failed',
  })
  logger.warn(failure.message, { errorType: error instanceof Error ? error.name : typeof error })
}

export function applyAssignmentEnrichments(
  assignments: AttachmentAssignment[],
  enrichments: AssignmentEnrichmentMap,
): AttachmentAssignment[] {
  if (!enrichments.size) return assignments
  return assignments.map((assignment) => {
    if (!assignment || !assignment.type || !assignment.id) return assignment
    const key = `${assignment.type}:${assignment.id}`
    const detail = enrichments.get(key)
    if (!detail) return assignment
    const next: AttachmentAssignment = { ...assignment }
    if (!next.label && detail.label) next.label = detail.label
    if (!next.href && detail.href) next.href = detail.href
    return next
  })
}
