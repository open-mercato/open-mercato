import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const TRUSTED_TENANT = '33333333-3333-4333-8333-333333333333'
const TRUSTED_ORG = '11111111-1111-4111-8111-111111111111'
const FORGED_TENANT = '99999999-9999-4999-8999-999999999999'
const FORGED_ORG = '88888888-8888-4888-8888-888888888888'

const mockResolveWidgetScope = jest.fn()
const mockFind = jest.fn()

jest.mock('@open-mercato/core/modules/dashboards/lib/widgetScope', () => ({
  resolveWidgetScope: (...args: unknown[]) => mockResolveWidgetScope(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('../../../../lib/interactionFeatureFlags', () => ({
  resolveCustomerInteractionFeatureFlags: jest.fn(async () => ({ unified: true })),
}))

jest.mock('../../../../lib/todoCompatibility', () => ({
  listLegacyTodoRows: jest.fn(async () => []),
  listCanonicalTodoRows: jest.fn(async () => ({ items: [], bridgeIds: new Set<string>() })),
  sortTodoRows: jest.fn((rows: unknown[]) => rows),
}))

import { GET as getNewDeals } from '../new-deals/route'
import { GET as getNewCustomers } from '../new-customers/route'
import { GET as getNextInteractions } from '../next-interactions/route'
import { GET as getCustomerTodos } from '../customer-todos/route'

// Every customers dashboard widget accepts `tenantId` / `organizationId` query
// parameters. They are caller-controlled, so each route must hand them to
// `resolveWidgetScope` as a *request* and then read exclusively from the scope
// that helper authorizes — never from the raw query values (issue #5175).
const ROUTES: { name: string; handler: (req: Request) => Promise<Response> }[] = [
  { name: 'new-deals', handler: getNewDeals },
  { name: 'new-customers', handler: getNewCustomers },
  { name: 'next-interactions', handler: getNextInteractions },
  { name: 'customer-todos', handler: getCustomerTodos },
]

function forgedRequest(route: string): Request {
  return new Request(
    `http://localhost/api/customers/dashboard/widgets/${route}?limit=5&tenantId=${FORGED_TENANT}&organizationId=${FORGED_ORG}`,
  )
}

describe('customers dashboard widgets reject forged tenant/organization scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFind.mockResolvedValue([])
    mockResolveWidgetScope.mockResolvedValue({
      container: {
        resolve: (name: string) => {
          if (name === 'queryEngine') return { kind: 'query-engine' }
          throw new Error(`Unexpected container resolve: ${name}`)
        },
      },
      em: { find: mockFind },
      tenantId: TRUSTED_TENANT,
      organizationIds: [TRUSTED_ORG],
    })
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

    const { listLegacyTodoRows, listCanonicalTodoRows } = jest.requireMock('../../../../lib/todoCompatibility')
    const scopedCalls =
      name === 'customer-todos'
        ? [...listLegacyTodoRows.mock.calls, ...listCanonicalTodoRows.mock.calls]
        : mockFind.mock.calls

    expect(scopedCalls.length).toBeGreaterThan(0)
    const serialized = JSON.stringify(scopedCalls)
    expect(serialized).toContain(TRUSTED_TENANT)
    expect(serialized).not.toContain(FORGED_TENANT)
    expect(serialized).not.toContain(FORGED_ORG)
  })

  it.each(ROUTES)('$name surfaces the helper\'s 403 instead of serving data', async ({ name, handler }) => {
    mockResolveWidgetScope.mockRejectedValue(
      new CrudHttpError(403, { error: 'Requested scope is not accessible' }),
    )

    const res = await handler(forgedRequest(name))

    expect(res.status).toBe(403)
    expect(mockFind).not.toHaveBeenCalled()
  })
})
