import { z } from 'zod'
import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isClosedDealStatus } from '../lib/dealStatus'
import { resolveDealStatusVocabulary } from '../lib/dealStatusVocabulary'
import { expandDealStatusFilterLiteral, resolveDealStatusFilterVocabulary } from '../lib/dealStatusFilters'

const statusFilterSchema = z.object({
  field: z.literal('status'),
  operator: z.enum(['eq', 'neq', 'in', 'not_in']),
  value: z.union([z.string(), z.array(z.string())]),
}).passthrough()

const before: NonNullable<ApiInterceptor['before']> = async (request, context) => {
  const body = request.body
  if (body?.entityType !== 'customers:deals' || !Array.isArray(body.filters)) return { ok: true }
  const filters = body.filters.map((filter) => statusFilterSchema.safeParse(filter))
  if (!filters.some((filter) => filter.success)) return { ok: true }
  const { vocabulary } = await resolveDealStatusVocabulary(context.container, context.tenantId)
  if (!filters.some((filter) => filter.success && [filter.data.value].flat().some((value) => isClosedDealStatus(value, vocabulary)))) return { ok: true }
  const trustedScope = context.metadata?.authenticatedScope as Pick<CrudCtx, 'auth' | 'organizationScope' | 'selectedOrganizationId' | 'organizationIds'> | undefined
  if (!trustedScope || trustedScope.auth?.sub !== context.userId || trustedScope.auth?.tenantId !== context.tenantId || (trustedScope.organizationScope?.tenantId ?? trustedScope.auth.tenantId) !== context.tenantId) {
    const { translate } = await resolveTranslations()
    return { ok: false, statusCode: 403, message: translate('customers.errors.access_denied', 'Access denied') }
  }
  const expandedVocabulary = await resolveDealStatusFilterVocabulary({
    ...trustedScope, container: context.container,
  }, vocabulary)
  return {
    ok: true,
    body: {
      ...body,
      filters: body.filters.map((filter, index) => {
        const parsed = filters[index]
        if (!parsed.success) return filter
        const values = [parsed.data.value].flat()
        if (!values.some((value) => isClosedDealStatus(value, vocabulary))) return filter
        const operator = parsed.data.operator === 'eq' ? 'in' : parsed.data.operator === 'neq' ? 'not_in' : parsed.data.operator
        return { ...parsed.data, operator, value: Array.from(new Set(values.flatMap((value) => expandDealStatusFilterLiteral(value, expandedVocabulary)))) }
      }),
    },
  }
}

export const interceptors: ApiInterceptor[] = [
  { id: 'customers.deal-status-vocabulary.analytics-filters', targetRoute: 'dashboards/widgets/data', methods: ['POST'], before },
  { id: 'customers.deal-status-vocabulary.analytics-batch-filters', targetRoute: 'dashboards/widgets/data/batch', methods: ['POST'], before },
]
