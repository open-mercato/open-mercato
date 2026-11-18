import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type {
  SearchBuildContext,
  SearchIndexSource,
  SearchModuleConfig,
  SearchResultLink,
  SearchResultPresenter,
} from '@open-mercato/shared/modules/search'
import { E } from '#generated/entities.ids.generated'
import { MANAGE_ALL_BUILDINGS_FEATURE } from './lib/buildingAccess'

const logger = createLogger('property_management')

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length) return value.trim()
  }
  return null
}

async function loadField(
  ctx: SearchBuildContext,
  entityId: string,
  filters: Record<string, unknown>,
  field: string,
): Promise<string | null> {
  const queryEngine = ctx.queryEngine as QueryEngine | undefined
  if (!queryEngine || typeof ctx.tenantId !== 'string') return null
  try {
    const result = await queryEngine.query<Record<string, unknown>>(entityId, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId ?? undefined,
      filters,
      fields: ['id', field],
      page: { page: 1, pageSize: 1 },
    })
    const row = result.items[0]
    return row ? readString(row, field) : null
  } catch (err) {
    logger.warn('Search source lookup failed', { entityId, field, err })
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.search_source_lookup_failed' })
    return null
  }
}

async function loadName(ctx: SearchBuildContext, entityId: string, id: string | null, field: string): Promise<string | null> {
  return id ? loadField(ctx, entityId, { id: { $eq: id } }, field) : null
}

async function loadUnitProductName(ctx: SearchBuildContext, record: Record<string, unknown>): Promise<string | null> {
  const unitId = readString(record, 'id')
  const periodName = unitId
    ? await loadField(ctx, E.property_management.unit_product_period, { unit_id: { $eq: unitId }, valid_to: { $exists: false } }, 'product_name')
    : null
  return periodName ?? loadName(ctx, E.catalog.catalog_product, readString(record, 'catalog_product_id', 'catalogProductId'), 'title')
}

function buildingUrl(record: Record<string, unknown>): string | null {
  const id = readString(record, 'id')
  return id ? `/backend/property_management/buildings/${id}` : null
}

function unitUrl(record: Record<string, unknown>): string | null {
  const id = readString(record, 'id')
  return id ? `/backend/property_management/units/${id}` : null
}

function leaseUrl(record: Record<string, unknown>): string | null {
  const id = readString(record, 'id')
  return id ? `/backend/property_management/leases/${id}` : null
}

function buildingPresenter(record: Record<string, unknown>): SearchResultPresenter {
  return {
    title: readString(record, 'name') ?? 'Building',
    subtitle: readString(record, 'address') ?? undefined,
    icon: 'building',
  }
}

function linksFor(url: string | null, label: string): SearchResultLink[] {
  return url ? [{ href: url, label, kind: 'primary' }] : []
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: E.property_management.building,
      enabled: true,
      priority: 30,
      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        const record = ctx.record
        const lines = [readString(record, 'name'), readString(record, 'address')].filter((line): line is string => Boolean(line))
        if (!lines.length) return null
        const presenter = buildingPresenter(record)
        return {
          text: lines,
          presenter,
          links: linksFor(buildingUrl(record), presenter.title),
          checksumSource: { record },
        }
      },
      formatResult: (ctx: SearchBuildContext) => buildingPresenter(ctx.record),
      resolveUrl: (ctx: SearchBuildContext) => buildingUrl(ctx.record),
      fieldPolicy: {
        searchable: ['name', 'address'],
        excluded: ['tenant_id', 'organization_id', 'deleted_at'],
      },
      aclFeatures: [MANAGE_ALL_BUILDINGS_FEATURE],
    },
    {
      entityId: E.property_management.unit,
      enabled: true,
      priority: 25,
      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        const record = ctx.record
        const name = readString(record, 'name')
        if (!name) return null
        const [buildingName, floorName, productName] = await Promise.all([
          loadName(ctx, E.property_management.building, readString(record, 'building_id', 'buildingId'), 'name'),
          loadName(ctx, E.property_management.floor, readString(record, 'floor_id', 'floorId'), 'name'),
          loadUnitProductName(ctx, record),
        ])
        const lines = [name, buildingName, floorName, productName].filter((line): line is string => Boolean(line))
        const presenter: SearchResultPresenter = {
          title: name,
          subtitle: [buildingName, floorName].filter(Boolean).join(' · ') || undefined,
          icon: 'square',
          badge: productName ?? undefined,
        }
        return {
          text: lines,
          presenter,
          links: linksFor(unitUrl(record), name),
          checksumSource: { record, buildingName, floorName, productName },
        }
      },
      formatResult: (ctx: SearchBuildContext) => ({
        title: readString(ctx.record, 'name') ?? 'Unit',
        icon: 'square',
      }),
      resolveUrl: (ctx: SearchBuildContext) => unitUrl(ctx.record),
      fieldPolicy: {
        searchable: ['name'],
        hashOnly: ['building_id', 'floor_id', 'space_id', 'catalog_product_id', 'catalog_category_id'],
        excluded: ['tenant_id', 'organization_id', 'deleted_at'],
      },
      aclFeatures: [MANAGE_ALL_BUILDINGS_FEATURE],
    },
    {
      entityId: E.property_management.lease,
      enabled: true,
      priority: 20,
      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        const record = ctx.record
        const reference = readString(record, 'reference')
        if (!reference) return null
        const unitName = await loadName(ctx, E.property_management.unit, readString(record, 'unit_id', 'unitId'), 'name')
        const lines = [reference, unitName].filter((line): line is string => Boolean(line))
        const presenter: SearchResultPresenter = {
          title: reference,
          subtitle: unitName ?? undefined,
          icon: 'file-signature',
          badge: readString(record, 'status') ?? undefined,
        }
        return {
          text: lines,
          presenter,
          links: linksFor(leaseUrl(record), reference),
          checksumSource: { record, unitName },
        }
      },
      formatResult: (ctx: SearchBuildContext) => ({
        title: readString(ctx.record, 'reference') ?? 'Lease',
        icon: 'file-signature',
      }),
      resolveUrl: (ctx: SearchBuildContext) => leaseUrl(ctx.record),
      fieldPolicy: {
        searchable: ['reference'],
        hashOnly: ['unit_id', 'building_id', 'customer_company_id', 'primary_contact_person_id', 'sales_order_id'],
        excluded: ['tenant_id', 'organization_id', 'deleted_at', 'pending_change', 'last_billing_refusal', 'hold_token'],
      },
      aclFeatures: [MANAGE_ALL_BUILDINGS_FEATURE],
    },
  ],
}

export default searchConfig
