/**
 * Page-context hydration end to end through the REAL customers tool pack and
 * the REAL in-process AI API operation runner. Only the terminal API route
 * handlers are stubbed (no DB): each stub reads the trusted auth context the
 * runner attaches, so the test proves which caller identity, ACL and scope the
 * hydration path actually forwards, and what reaches the hydrated context
 * string when the route allows or refuses the read.
 */

const mockLoggerInstance = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(),
}
mockLoggerInstance.child.mockImplementation(() => mockLoggerInstance)

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: jest.fn(() => mockLoggerInstance),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: jest.fn() }),
}))

import { registerApiRouteManifests, type ApiRouteManifestEntry } from '@open-mercato/shared/modules/registry'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { hydrateCustomersAccountContext } from '../ai-agents-context'

const PERSON_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const COMPANY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const DEAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

type CapturedCall = {
  path: string
  include: string | null
  sub: string | null
  tenantId: string | null
  orgId: string | null
  isSuperAdmin: boolean
}

type RouteReply = { status: number; body: Record<string, unknown> }

const captured: CapturedCall[] = []
let replyFor: (path: string) => RouteReply = () => ({ status: 404, body: { error: 'Not found' } })

function stubRoute(path: string, feature: string): ApiRouteManifestEntry {
  return {
    moduleId: 'customers',
    kind: 'route-file',
    path,
    methods: ['GET'],
    load: async () => ({
      GET: async (request: Request) => {
        const auth = await getAuthFromRequest(request)
        const url = new URL(request.url)
        captured.push({
          path: url.pathname,
          include: url.searchParams.get('include'),
          sub: auth?.sub ?? null,
          tenantId: auth?.tenantId ?? null,
          orgId: auth?.orgId ?? null,
          isSuperAdmin: auth?.isSuperAdmin === true,
        })
        const reply = replyFor(url.pathname)
        return new Response(JSON.stringify(reply.body), {
          status: reply.status,
          headers: { 'content-type': 'application/json' },
        })
      },
      openApi: { tag: 'Customers', methods: { GET: {} } },
      metadata: { GET: { requireAuth: true, requireFeatures: [feature] } },
    }),
  }
}

function containerWithAcl(acl: { isSuperAdmin: boolean; features: string[] }) {
  const loadAcl = jest.fn(async () => ({ ...acl, organizations: ['org-1'] }))
  const services: Record<string, unknown> = { rbacService: { loadAcl } }
  return { loadAcl, container: { resolve: (name: string) => services[name] ?? null } }
}

const CALLER_ACL = {
  isSuperAdmin: false,
  features: ['customers.people.view', 'customers.companies.view', 'customers.deals.view'],
}

function hydrate(entityType: string, recordId: string, container: unknown) {
  return hydrateCustomersAccountContext({
    entityType,
    recordId,
    container: container as never,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
  })
}

describe('customers page-context hydration through the real tool pack and API runner', () => {
  beforeAll(() => {
    registerApiRouteManifests([
      stubRoute('/customers/people/[id]', 'customers.people.view'),
      stubRoute('/customers/companies/[id]', 'customers.companies.view'),
      stubRoute('/customers/deals/[id]', 'customers.deals.view'),
    ])
  })

  beforeEach(() => {
    captured.length = 0
    jest.clearAllMocks()
  })

  it('forwards the caller identity, loaded ACL and scope to the detail route and renders the allowed record', async () => {
    replyFor = () => ({
      status: 200,
      body: {
        person: { id: PERSON_ID, displayName: 'Taylor Sample', organizationId: 'org-1', tenantId: 'tenant-1' },
        profile: null,
        customFields: {},
        deals: [{ id: DEAL_ID, title: 'Renewal Deal' }],
      },
    })
    const { container, loadAcl } = containerWithAcl(CALLER_ACL)
    const result = await hydrate('person', PERSON_ID, container)

    expect(loadAcl).toHaveBeenCalledWith('user-1', { tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(captured).toEqual([
      expect.objectContaining({
        path: `/api/customers/people/${PERSON_ID}`,
        sub: 'user-1',
        tenantId: 'tenant-1',
        orgId: 'org-1',
        isSuperAdmin: false,
      }),
    ])
    expect(captured[0].include).toContain('deals')
    expect(result).toContain('Taylor Sample')
    expect(result).toContain(DEAL_ID)
  })

  it('never forwards a super-admin bypass the caller does not hold', async () => {
    replyFor = () => ({ status: 403, body: { error: 'Forbidden' } })
    const { container } = containerWithAcl({ isSuperAdmin: false, features: ['customers.companies.view'] })
    await hydrate('company', COMPANY_ID, container)
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({ sub: 'user-1', isSuperAdmin: false })
  })

  it.each([
    ['person', PERSON_ID, 403],
    ['person', PERSON_ID, 404],
    ['company', COMPANY_ID, 403],
    ['company', COMPANY_ID, 404],
    ['deal', DEAL_ID, 403],
    ['deal', DEAL_ID, 404],
  ])('keeps the hydrated context empty when the %s route refuses the caller with %s', async (entityType, recordId, status) => {
    replyFor = () => ({ status, body: { error: 'refused', leaked: 'Secret Record Name' } })
    const { container } = containerWithAcl(CALLER_ACL)
    const result = await hydrate(entityType, recordId, container)
    expect(captured.length).toBeGreaterThan(0)
    expect(result).toBeNull()
  })

  it('renders only the related records the detail route returned for the caller', async () => {
    replyFor = () => ({
      status: 200,
      body: {
        company: { id: COMPANY_ID, displayName: 'Acme Corp', organizationId: 'org-1', tenantId: 'tenant-1' },
        profile: null,
        customFields: {},
        people: [],
        deals: [{ id: DEAL_ID, title: 'Visible Deal' }],
      },
    })
    const { container } = containerWithAcl(CALLER_ACL)
    const result = await hydrate('company', COMPANY_ID, container)
    expect(captured[0].include).toContain('people')
    expect(result).toContain('Acme Corp')
    expect(result).toContain(DEAL_ID)
    expect(result).not.toContain(PERSON_ID)
  })

  it('skips the route entirely without a caller identity', async () => {
    const { container, loadAcl } = containerWithAcl(CALLER_ACL)
    const result = await hydrateCustomersAccountContext({
      entityType: 'person',
      recordId: PERSON_ID,
      container: container as never,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: null,
    })
    expect(result).toBeNull()
    expect(loadAcl).not.toHaveBeenCalled()
    expect(captured).toHaveLength(0)
  })
})
