import { EntityManager, FilterQuery, QueryOrder } from '@mikro-orm/postgresql'
import { FeatureToggle, FeatureToggleOverride } from '../data/entities'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { OverrideListResponse } from '../data/validators'

export type FeatureToggleOverrideResponse = {
    id: string
    toggleId: string
    overrideState: 'enabled' | 'disabled' | 'inherit'
    tenantName: string
    tenantId: string
    identifier: string
    name: string
    category: string
    defaultState: boolean
}

export type GetOverridesQuery = {
    category?: string
    name?: string
    identifier?: string
    defaultState?: 'enabled' | 'disabled'
    overrideState?: 'enabled' | 'disabled' | 'inherit'
    sortField?: 'identifier' | 'name' | 'category' | 'defaultState' | 'overrideState'
    sortDir?: 'asc' | 'desc'
    page?: number
    pageSize?: number
}

const SORTABLE_FIELDS = new Set<keyof FeatureToggle>(['identifier', 'name', 'category'])

type GetOverridesResult = {
    items: OverrideListResponse[]
    total: number
    totalPages: number
    page: number
    pageSize: number
    raw: {
        toggles: FeatureToggle[]
        overrides: FeatureToggleOverride[]
    }
}

export async function getOverrides(
    em: EntityManager,
    tenant: Tenant,
    query: GetOverridesQuery
): Promise<GetOverridesResult> {
    const filters: FilterQuery<FeatureToggle> = { deletedAt: null }
    if (query.category) {
        filters.category = { $ilike: `%${escapeLikePattern(query.category)}%` }
    }
    if (query.name) {
        filters.name = { $ilike: `%${escapeLikePattern(query.name)}%` }
    }
    if (query.identifier) {
        filters.identifier = { $ilike: `%${escapeLikePattern(query.identifier)}%` }
    }

    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 25
    const offset = (page - 1) * pageSize

    const direction = query.sortDir === 'desc' ? QueryOrder.DESC : QueryOrder.ASC
    const orderBy: Partial<Record<keyof FeatureToggle, QueryOrder>> = {}
    if (query.sortField && SORTABLE_FIELDS.has(query.sortField as keyof FeatureToggle)) {
        orderBy[query.sortField as keyof FeatureToggle] = direction
    }
    orderBy.id = QueryOrder.ASC

    const totalItems = await em.count(FeatureToggle, filters)

    const globalToggles = await em.find(FeatureToggle, filters, {
        orderBy,
        limit: pageSize,
        offset,
    })

    const overrides = globalToggles.length
        ? await em.find(FeatureToggleOverride, {
              tenantId: tenant.id,
              toggle: { id: { $in: globalToggles.map((toggle) => toggle.id) } },
          })
        : []

    const overridesByToggleId = new Map<string, FeatureToggleOverride>()
    for (const override of overrides) {
        overridesByToggleId.set(override.toggle.id, override)
    }

    const items: OverrideListResponse[] = globalToggles.map((toggle) => {
        const override = overridesByToggleId.get(toggle.id)
        return {
            id: override?.id ?? '',
            toggleId: toggle.id,
            tenantName: tenant.name,
            tenantId: tenant.id,
            identifier: toggle.identifier,
            name: toggle.name,
            category: toggle.category ?? '',
            isOverride: Boolean(override),
        }
    })

    const totalPages = Math.ceil(totalItems / pageSize)

    return {
        items,
        total: totalItems,
        totalPages,
        page,
        pageSize,
        raw: {
            toggles: globalToggles,
            overrides,
        },
    }
}
