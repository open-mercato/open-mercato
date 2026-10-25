import type { InterceptorContext, InterceptorRequest } from '@open-mercato/shared/lib/crud/api-interceptor'
import { interceptors } from '../interceptors'

const mockAuth = jest.fn()
const mockScope = jest.fn()
const mockResolveVocabulary = jest.fn()
const mockResolveFilterVocabulary = jest.fn()
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: (...args: unknown[]) => mockAuth(...args) }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({ resolveOrganizationScopeForRequest: (...args: unknown[]) => mockScope(...args) }))
jest.mock('../../lib/dealStatusVocabulary', () => ({ resolveDealStatusVocabulary: (...args: unknown[]) => mockResolveVocabulary(...args) }))
jest.mock('../../lib/dealStatusFilters', () => ({
  ...jest.requireActual('../../lib/dealStatusFilters'),
  resolveDealStatusFilterVocabulary: (...args: unknown[]) => mockResolveFilterVocabulary(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))

const vocabulary = { won: ['Signed'], lost: ['Declined'], closed: ['Archived'] }
const context = { userId: 'user-a', tenantId: 'tenant-a', organizationId: 'org-a', container: {}, em: {} } as unknown as InterceptorContext
const request = (filters: unknown[], entityType = 'customers:deals'): InterceptorRequest => ({
  method: 'POST', url: 'https://example.test/api/dashboards/widgets/data', headers: {},
  body: { entityType, filters, metric: { field: 'valueAmount', aggregate: 'sum' }, dateRange: { field: 'createdAt', preset: 'last_30_days' }, comparison: { preset: 'previous_period' } },
})

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ sub: 'user-a', tenantId: 'tenant-a', orgId: 'org-a' })
  mockScope.mockResolvedValue({ tenantId: 'tenant-a', filterIds: ['org-a'] })
  mockResolveVocabulary.mockResolvedValue({ vocabulary })
  mockResolveFilterVocabulary.mockResolvedValue({ ...vocabulary, won: ['Signed', '  sIgNeD  '] })
})

it('rewrites only recognized status literals before dashboard cache/SQL and retains the request', async () => {
  const original = request([
    { field: 'status', operator: 'neq', value: 'Signed' },
    { field: 'status', operator: 'eq', value: 'Custom Review' },
    { field: 'closureOutcome', operator: 'is_null' },
  ])
  const result = await interceptors[0].before!(original, context)
  expect(result).toMatchObject({ ok: true, body: { ...original.body, filters: [
    { field: 'status', operator: 'not_in', value: ['Signed', '  sIgNeD  '] },
    { field: 'status', operator: 'eq', value: 'Custom Review' },
    { field: 'closureOutcome', operator: 'is_null' },
  ] } })
  expect(mockResolveFilterVocabulary).toHaveBeenCalledWith(expect.objectContaining({ organizationScope: { tenantId: 'tenant-a', filterIds: ['org-a'] } }), vocabulary)
})

it('preserves mixed set filters, unrelated entities and arbitrary statuses', async () => {
  const result = await interceptors[0].before!(request([{ field: 'status', operator: 'in', value: ['Signed', 'Custom Review'] }]), context)
  expect(result.body?.filters).toEqual([{ field: 'status', operator: 'in', value: ['Signed', '  sIgNeD  ', 'Custom Review'] }])
  mockResolveFilterVocabulary.mockClear()
  expect(await interceptors[0].before!(request([{ field: 'status', operator: 'eq', value: 'Custom Review' }]), context)).toEqual({ ok: true })
  expect(await interceptors[0].before!(request([{ field: 'status', operator: 'eq', value: 'Signed' }], 'customers:entities'), context)).toEqual({ ok: true })
  expect(mockResolveFilterVocabulary).not.toHaveBeenCalled()
})

it('denies mismatched authenticated scope before the status lookup and propagates failures', async () => {
  mockScope.mockResolvedValueOnce({ tenantId: 'tenant-b', filterIds: ['org-b'] })
  expect(await interceptors[0].before!(request([{ field: 'status', operator: 'neq', value: 'Signed' }]), context)).toMatchObject({ ok: false, statusCode: 403 })
  expect(mockResolveFilterVocabulary).not.toHaveBeenCalled()
  mockResolveFilterVocabulary.mockRejectedValueOnce(new Error('database unavailable'))
  await expect(interceptors[0].before!(request([{ field: 'status', operator: 'neq', value: 'Signed' }]), context)).rejects.toThrow('database unavailable')
})
