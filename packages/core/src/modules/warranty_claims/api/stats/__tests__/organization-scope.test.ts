/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

const whereCalls: unknown[][] = []

function createQuery() {
  const query: Record<string, (...args: unknown[]) => unknown> = {}
  for (const method of ['select', 'groupBy']) {
    query[method] = () => query
  }
  query.where = (...args: unknown[]) => {
    whereCalls.push(args)
    return query
  }
  query.execute = async () => []
  query.executeTakeFirst = async () => undefined
  return query
}

const db = { selectFrom: jest.fn(() => createQuery()) }
const em = {
  fork: jest.fn(() => em),
  getKysely: jest.fn(() => db),
}
const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    throw new Error(`Unexpected service: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'user-1', tenantId, orgId: organizationId })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    selectedId: null,
    filterIds: [],
    allowedIds: [],
    tenantId,
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

jest.mock('../../../lib/settings', () => ({
  resolveEffectiveWarrantyClaimSettings: jest.fn(async () => ({ slaAtRiskThresholdPct: 75 })),
}))

import { GET } from '../route'

describe('warranty claims stats organization scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    whereCalls.length = 0
  })

  it('adds an always-false predicate for empty scope instead of using auth.orgId', async () => {
    const response = await GET(new Request('http://localhost/api/warranty_claims/stats'))

    expect(response.status).toBe(200)
    const falsePredicates = whereCalls
      .map((args) => args[0])
      .filter((value): value is { toOperationNode: () => unknown } =>
        typeof (value as { toOperationNode?: unknown })?.toOperationNode === 'function')
      .map((value) => JSON.stringify(value.toOperationNode()))
      .filter((node) => node.includes('false'))
    expect(falsePredicates.length).toBeGreaterThan(0)
    expect(JSON.stringify(await response.json())).not.toContain(organizationId)
  })
})
