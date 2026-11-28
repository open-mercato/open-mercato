/** @jest-environment node */
// Read routes follow the ledger GET routes' policy for the organization
// filter: the selected organization when there is one; a superadmin with no
// organization selected lists every organization of their own tenant; the
// single-row settings resource refuses without an organization instead.
const ORG = '11111111-1111-4111-8111-111111111111'
const SELECTED_ORG = '33333333-3333-4333-8333-333333333333'
const TENANT = '22222222-2222-4222-8222-222222222222'

type Auth = { sub: string; tenantId: string; orgId: string | null; isSuperAdmin?: boolean }
type Scope = { tenantId: string; selectedId: string | null; filterIds: string[] | null } | null

const mockFindAndCount = jest.fn(async () => [[], 0])
const mockFindOne = jest.fn(async () => null)
let currentAuth: Auth = { sub: 'user-1', tenantId: TENANT, orgId: ORG }
let currentScope: Scope = null

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn(() => ({ POST: jest.fn(), PUT: jest.fn(), DELETE: jest.fn() })),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: jest.fn((token: string) => (token === 'em' ? { findAndCount: mockFindAndCount, findOne: mockFindOne } : undefined)),
  })),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => currentAuth),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => currentScope),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (key: string) => key })),
}))

import { GET as listCostCenters } from '../cost-centers/route'
import { GET as listRules } from '../default-account-posting-rules/route'
import { GET as getSettings } from '../settings/route'

const lastFilter = () => (mockFindAndCount.mock.calls.at(-1) as unknown[] | undefined)?.[1] as Record<string, unknown>

describe.each([
  ['cost-centers', listCostCenters],
  ['default-account-posting-rules', listRules],
])('GET /api/posting_rules/%s organization filter', (path, handler) => {
  const list = () => handler(new Request(`http://localhost/api/posting_rules/${path}`))

  beforeEach(() => jest.clearAllMocks())

  it('filters by the selected organization, not the home organization', async () => {
    currentAuth = { sub: 'user-1', tenantId: TENANT, orgId: ORG }
    currentScope = { tenantId: TENANT, selectedId: SELECTED_ORG, filterIds: [SELECTED_ORG] }
    expect((await list()).status).toBe(200)
    expect(lastFilter()).toMatchObject({ tenantId: TENANT, organizationId: SELECTED_ORG })
  })

  it('falls back to the home organization when none is selected', async () => {
    currentAuth = { sub: 'user-1', tenantId: TENANT, orgId: ORG }
    currentScope = { tenantId: TENANT, selectedId: null, filterIds: null }
    await list()
    expect(lastFilter()).toMatchObject({ tenantId: TENANT, organizationId: ORG })
  })

  it('lists the whole tenant, never another tenant, for a superadmin with no organization', async () => {
    currentAuth = { sub: 'admin', tenantId: TENANT, orgId: null, isSuperAdmin: true }
    currentScope = { tenantId: TENANT, selectedId: null, filterIds: null }
    expect((await list()).status).toBe(200)
    expect(lastFilter().tenantId).toBe(TENANT)
    expect(lastFilter()).not.toHaveProperty('organizationId')
  })

  it('refuses a non-superadmin without any organization', async () => {
    currentAuth = { sub: 'user-1', tenantId: TENANT, orgId: null }
    currentScope = null
    expect((await list()).status).toBe(401)
    expect(mockFindAndCount).not.toHaveBeenCalled()
  })
})

describe('GET /api/posting_rules/settings organization filter', () => {
  beforeEach(() => jest.clearAllMocks())

  it('refuses a superadmin with no organization selected (one row per organization)', async () => {
    currentAuth = { sub: 'admin', tenantId: TENANT, orgId: null, isSuperAdmin: true }
    currentScope = { tenantId: TENANT, selectedId: null, filterIds: null }
    const response = await getSettings(new Request('http://localhost/api/posting_rules/settings'))
    expect(response.status).toBe(400)
    expect(mockFindOne).not.toHaveBeenCalled()
  })

  it('reads the selected organization row', async () => {
    currentAuth = { sub: 'user-1', tenantId: TENANT, orgId: ORG }
    currentScope = { tenantId: TENANT, selectedId: SELECTED_ORG, filterIds: [SELECTED_ORG] }
    const response = await getSettings(new Request('http://localhost/api/posting_rules/settings'))
    expect(response.status).toBe(200)
    expect(mockFindOne).toHaveBeenCalledWith(expect.anything(), { tenantId: TENANT, organizationId: SELECTED_ORG })
  })
})
