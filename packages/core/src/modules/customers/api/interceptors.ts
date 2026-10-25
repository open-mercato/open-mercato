import { z } from 'zod'
import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isClosedDealStatus } from '../lib/dealStatus'
import { resolveDealStatusVocabulary } from '../lib/dealStatusVocabulary'
import { expandDealStatusFilterLiteral, resolveDealStatusFilterVocabulary } from '../lib/dealStatusFilters'

const statusFilterSchema = z.object({
  field: z.literal('status'),
  operator: z.enum(['eq', 'neq', 'in', 'not_in']),
  value: z.union([z.string(), z.array(z.string())]),
}).passthrough()

export const interceptors: ApiInterceptor[] = [{
  id: 'customers.deal-status-vocabulary.analytics-filters',
  targetRoute: 'dashboards/widgets/data',
  methods: ['POST'],
  async before(request, context) {
    const body = request.body
    if (body?.entityType !== 'customers:deals' || !Array.isArray(body.filters)) return { ok: true }
    const filters = body.filters.map((filter) => statusFilterSchema.safeParse(filter))
    if (!filters.some((filter) => filter.success)) return { ok: true }
    const { vocabulary } = await resolveDealStatusVocabulary(context.container, context.tenantId)
    if (!filters.some((filter) => filter.success && [filter.data.value].flat().some((value) => isClosedDealStatus(value, vocabulary)))) return { ok: true }
    const nativeRequest = new Request(request.url, { headers: request.headers })
    const auth = await getAuthFromRequest(nativeRequest)
    const scope = auth ? await resolveOrganizationScopeForRequest({ container: context.container, auth, request: nativeRequest }) : null
    if (!auth || auth.sub !== context.userId || !scope || scope.tenantId !== context.tenantId) {
      const { translate } = await resolveTranslations()
      return { ok: false, statusCode: 403, message: translate('customers.errors.access_denied', 'Access denied') }
    }
    const expandedVocabulary = await resolveDealStatusFilterVocabulary({
      container: context.container, auth, organizationScope: scope,
      selectedOrganizationId: context.organizationId || null, organizationIds: scope.filterIds,
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
  },
}]
