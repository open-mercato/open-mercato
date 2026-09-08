import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const TRUSTED_TENANT = '33333333-3333-4333-8333-333333333333'
const TRUSTED_ORG = '11111111-1111-4111-8111-111111111111'
const FORGED_TENANT = '99999999-9999-4999-8999-999999999999'
const FORGED_ORG = '88888888-8888-4888-8888-888888888888'

const mockResolveWidgetScope = jest.fn()
const mockFindAndCountWithDecryption = jest.fn()
const mockResolveDateRange = jest.fn()

jest.mock('@open-mercato/core/modules/dashboards/lib/widgetScope', () => ({
  resolveWidgetScope: (...args: unknown[]) => mockResolveWidgetScope(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findAndCountWithDecryption: (...args: unknown[]) => mockFindAndCountWithDecryption(...args),
}))

jest.mock('@open-mercato/ui/backend/date-range', () => ({
  resolveDateRange: (...args: unknown[]) => mockResolveDateRange(...args),
}))

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: async (_tenantId: string | null, fn: () => unknown) => await fn(),
}))

import { GET as getNewOrders } from '../new-orders/route'
import { GET as getNewQuotes } from '../new-quotes/route'

// Both sales widgets are built by the shared `makeDashboardWidgetRoute` factory,
// which accepts caller-controlled `tenantId` / `organizationId` query parameters.
// They must reach `resolveWidgetScope` as a request and never reach the ORM read
// or the cache key unless that helper authorized them (issue #5175).
const ROUTES: { name: string; handler: (req: Request) => Promise<Response> }[] = [
  { name: 'new-orders', handler: getNewOrders },
  { name: 'new-quotes', handler: getNewQuotes },
]

function forgedRequest(route: string): Request {
  return new Request(
    `http://localhost/api/sales/dashboard/widgets/${route}?limit=5&tenantId=${FORGED_TENANT}&organizationId=${FORGED_ORG}`,
  )
}

describe('sales dashboard widgets reject forged tenant/organization scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveWidgetScope.mockResolvedValue({
      container: { resolve: () => { throw new Error('cache unavailable') } },
      em: { marker: 'em' },
      tenantId: TRUSTED_TENANT,
      organizationIds: [TRUSTED_ORG],
    })
    mockResolveDateRange.mockReturnValue({
      start: new Date('2026-02-01T00:00:00.000Z'),
      end: new Date('2026-02-07T23:59:59.999Z'),
    })
    mockFindAndCountWithDecryption.mockResolvedValue([[], 0])
  })

  it.each(ROUTES)('$name delegates the requested scope to resolveWidgetScope', async ({ name, handler }) => {
    const res = await handler(forgedRequest(name))

    expect(res.status).toBe(200)
    expect(mockResolveWidgetScope).toHaveBeenCalledTimes(1)
    expect(mockResolveWidgetScope.mock.calls[0][2]).toEqual({
      tenantId: FORGED_TENANT,
      organizationId: FORGED_ORG,
    })
  })

  it.each(ROUTES)('$name reads only the authorized scope, never the requested one', async ({ name, handler }) => {
    await handler(forgedRequest(name))

    expect(mockFindAndCountWithDecryption).toHaveBeenCalledTimes(1)
    const [, , where, , decryptionScope] = mockFindAndCountWithDecryption.mock.calls[0]

    expect(where).toMatchObject({ tenantId: TRUSTED_TENANT, organizationId: TRUSTED_ORG })
    expect(decryptionScope).toMatchObject({ tenantId: TRUSTED_TENANT, organizationId: TRUSTED_ORG })
    expect(JSON.stringify([where, decryptionScope])).not.toContain(FORGED_TENANT)
    expect(JSON.stringify([where, decryptionScope])).not.toContain(FORGED_ORG)
  })

  it.each(ROUTES)('$name surfaces the helper\'s 403 instead of serving data', async ({ name, handler }) => {
    mockResolveWidgetScope.mockRejectedValue(
      new CrudHttpError(403, { error: 'Requested scope is not accessible' }),
    )

    const res = await handler(forgedRequest(name))

    expect(res.status).toBe(403)
    expect(mockFindAndCountWithDecryption).not.toHaveBeenCalled()
  })
})
