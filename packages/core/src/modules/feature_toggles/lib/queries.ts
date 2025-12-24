import { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { FeatureToggle, FeatureToggleOverride } from '../data/entities'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'

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

type GetOverridesResult = {
    items: FeatureToggleOverrideResponse[]
    total: number
    totalPages: number
    page: number
    pageSize: number
    raw: {
        toggles: FeatureToggle[]
        overrides: FeatureToggleOverride[]
    }
}

export type GetToggleOverridesForTenantResult = {
    override: {
        id: string
        state: 'enabled' | 'disabled' | 'inherit'
        tenantName: string
        tenantId: string
    }
}

export async function getOverrides(
    em: EntityManager,
    tenant: Tenant,
    query: GetOverridesQuery
): Promise<GetOverridesResult> {
    const filters: FilterQuery<FeatureToggle>[] = []
    if (query.category) {
        filters.push({ category: { $ilike: `%${query.category}%` } })
    }
    if (query.name) {
        filters.push({ name: { $ilike: `%${query.name}%` } })
    }
    if (query.identifier) {
        filters.push({ identifier: { $ilike: `%${query.identifier}%` } })
    }
    if (query.defaultState) {
        filters.push({ defaultState: query.defaultState === 'enabled' })
    }

    const globalToggles = await em.find(FeatureToggle, filters.length > 0 ? filters : {})

    const overrides = await em.find(FeatureToggleOverride, {
        tenantId: tenant.id,
        toggle: { id: { $in: globalToggles.map((toggle) => toggle.id) } },
    })

    const response: FeatureToggleOverrideResponse[] = []

    globalToggles.forEach((toggle) => {
        const override = overrides.find((o) => o.toggle.id === toggle.id)
        if (override) {
            response.push({
                id: override.id,
                toggleId: toggle.id,
                overrideState: override.state,
                tenantName: tenant.name,
                tenantId: tenant.id,
                identifier: toggle.identifier,
                name: toggle.name,
                category: toggle.category ?? '',
                defaultState: toggle.defaultState,
            })
        } else {
            response.push({
                id: '',
                toggleId: toggle.id,
                overrideState: 'inherit',
                tenantName: tenant.name,
                tenantId: tenant.id,
                identifier: toggle.identifier,
                name: toggle.name,
                category: toggle.category ?? '',
                defaultState: toggle.defaultState,
            })
        }
    })

    if (query.sortField && query.sortDir) {
        const sortField = query.sortField
        const sortDir = query.sortDir

        response.sort((a, b) => {
            let aValue: any = a[sortField as keyof typeof a]
            let bValue: any = b[sortField as keyof typeof b]

            if (sortField === 'defaultState') {
                aValue = aValue ? 1 : 0
                bValue = bValue ? 1 : 0
            }

            if (typeof aValue === 'string' && typeof bValue === 'string') {
                const comparison = aValue.localeCompare(bValue)
                return sortDir === 'asc' ? comparison : -comparison
            }

            if (typeof aValue === 'number' && typeof bValue === 'number') {
                return sortDir === 'asc' ? aValue - bValue : bValue - aValue
            }

            return 0
        })
    }

    const totalItems = response.length
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 25
    const totalPages = Math.ceil(totalItems / pageSize)
    const startIndex = (page - 1) * pageSize
    const endIndex = startIndex + pageSize

    const paginatedItems = response.slice(startIndex, endIndex)

    return {
        items: paginatedItems,
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