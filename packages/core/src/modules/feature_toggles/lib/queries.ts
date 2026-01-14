import { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
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
    const filters: FilterQuery<FeatureToggle>[] = []
    if (query.category) {
        filters.push({ category: { $ilike: `%${escapeLikePattern(query.category)}%` } })
    }
    if (query.name) {
        filters.push({ name: { $ilike: `%${escapeLikePattern(query.name)}%` } })
    }
    if (query.identifier) {
        filters.push({ identifier: { $ilike: `%${escapeLikePattern(query.identifier)}%` } })
    }

    const globalToggles = await em.find(FeatureToggle, filters.length > 0 ? filters : {})

    const overrides = await em.find(FeatureToggleOverride, {
        tenantId: tenant.id,
        toggle: { id: { $in: globalToggles.map((toggle) => toggle.id) } },
    })

    const response: OverrideListResponse[] = []

    globalToggles.forEach((toggle) => {
        const override = overrides.find((o) => o.toggle.id === toggle.id)
        if (override) {
            response.push({
                id: override?.id ?? '',
                toggleId: toggle.id,
                tenantName: tenant.name,
                tenantId: tenant.id,
                identifier: toggle.identifier,
                name: toggle.name,
                category: toggle.category ?? '',
                isOverride: true,
            })
        } else {
            response.push({
                id: '',
                toggleId: toggle.id,
                tenantName: tenant.name,
                tenantId: tenant.id,
                identifier: toggle.identifier,
                name: toggle.name,
                category: toggle.category ?? '',
                isOverride: false,
            })
        }
    })

    if (query.sortField && query.sortDir) {
        const sortField = query.sortField
        const sortDir = query.sortDir

        response.sort((a, b) => {
            let aValue: any = a[sortField as keyof typeof a]
            let bValue: any = b[sortField as keyof typeof b]



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
