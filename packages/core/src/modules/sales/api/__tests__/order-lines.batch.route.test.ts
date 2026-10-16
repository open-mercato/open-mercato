import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import {
  bridgeLegacyGuard,
  type MutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { SALES_ORDER_LINE_BULK_ISSUE_KEYS } from '../../data/validators'
import { POST } from '../order-lines/batch/route'

const mockCommandBus = { execute: jest.fn() }
const mockRbacService = { getGrantedFeatures: jest.fn(async () => ['sales.orders.manage']) }
const registeredGuards: MutationGuard[] = []

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'commandBus') return mockCommandBus
      if (token === 'rbacService') return mockRbacService
      return null
    },
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  })),
}))

// The route must run every registered guard, not just the legacy DI bridge, so
// the registry store is the thing to fake here — `runMutationGuards` itself is
// the real implementation.
jest.mock('@open-mercato/shared/lib/crud/mutation-guard-store', () => ({
  getAllMutationGuardInstances: jest.fn(() => registeredGuards),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard-registry', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/crud/mutation-guard-registry')
  return { ...actual, bridgeLegacyGuard: jest.fn(() => null) }
})

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const HOME_ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const SELECTED_ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333'
const ORDER_ID = '44444444-4444-4444-8444-444444444444'
const LINE_ID = '55555555-5555-4555-8555-555555555555'
const OTHER_LINE_ID = '66666666-6666-4666-8666-666666666666'

function makeRequest(organizationId?: string, selection = '__all__') {
  return new Request('http://localhost/api/sales/order-lines/batch', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `om_selected_org=${selection}`,
    },
    body: JSON.stringify({
      orderId: ORDER_ID,
      lines: [{ name: 'Batch line', currencyCode: 'USD', quantity: 1, unitPriceNet: 1, unitPriceGross: 1 }],
      ...(organizationId ? { organizationId } : {}),
    }),
  })
}

describe('batch order-line organization context', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    registeredGuards.length = 0
    jest.mocked(getAuthFromRequest).mockResolvedValue({
      sub: 'user-1',
      tenantId: TENANT_ID,
      orgId: HOME_ORGANIZATION_ID,
    })
    jest.mocked(resolveOrganizationScopeForRequest).mockResolvedValue({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId: TENANT_ID,
    })
    mockCommandBus.execute.mockResolvedValue({ result: { orderId: ORDER_ID, lineIds: [LINE_ID] } })
  })

  it.each([HOME_ORGANIZATION_ID, null])(
    'rejects All organizations when the home organization is %s',
    async (organizationId) => {
      jest.mocked(getAuthFromRequest).mockResolvedValue({
        sub: 'user-1', tenantId: TENANT_ID, orgId: organizationId,
      })

      const response = await POST(makeRequest())

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Organization context is required' })
      expect(bridgeLegacyGuard).not.toHaveBeenCalled()
      expect(mockCommandBus.execute).not.toHaveBeenCalled()
    },
  )

  it('rejects a payload organization override when All organizations is selected', async () => {
    const response = await POST(makeRequest(HOME_ORGANIZATION_ID))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Organization context is required' })
    expect(mockCommandBus.execute).not.toHaveBeenCalled()
  })

  it.each([HOME_ORGANIZATION_ID, SELECTED_ORGANIZATION_ID])(
    'writes under the resolved selected organization %s',
    async (organizationId) => {
      jest.mocked(resolveOrganizationScopeForRequest).mockResolvedValue({
        selectedId: organizationId,
        filterIds: [organizationId],
        allowedIds: null,
        tenantId: TENANT_ID,
      })

      const response = await POST(makeRequest(undefined, organizationId))

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ orderId: ORDER_ID, lineIds: [LINE_ID] })
      expect(mockCommandBus.execute).toHaveBeenCalledWith(
        'sales.orders.lines.upsert_many',
        expect.objectContaining({
          input: {
            body: expect.objectContaining({ organizationId, tenantId: TENANT_ID, orderId: ORDER_ID }),
          },
          ctx: expect.objectContaining({ selectedOrganizationId: organizationId }),
        }),
      )
    },
  )
})

/**
 * The route is a custom write route, so `packages/core/AGENTS.md` § API Routes
 * applies: it must run every registered mutation guard, honour a returned
 * `modifiedPayload`, and keep an `afterSuccess` failure from turning a committed
 * write into a reported failure.
 */
describe('batch order-line mutation guards', () => {
  function resolveSelectedOrganization() {
    jest.mocked(resolveOrganizationScopeForRequest).mockResolvedValue({
      selectedId: SELECTED_ORGANIZATION_ID,
      filterIds: [SELECTED_ORGANIZATION_ID],
      allowedIds: null,
      tenantId: TENANT_ID,
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    registeredGuards.length = 0
    jest.mocked(getAuthFromRequest).mockResolvedValue({
      sub: 'user-1',
      tenantId: TENANT_ID,
      orgId: HOME_ORGANIZATION_ID,
    })
    mockRbacService.getGrantedFeatures.mockResolvedValue(['sales.orders.manage'])
    mockCommandBus.execute.mockResolvedValue({ result: { orderId: ORDER_ID, lineIds: [LINE_ID] } })
    resolveSelectedOrganization()
  })

  it('refuses the batch when a registered guard rejects, without executing the command', async () => {
    registeredGuards.push({
      id: 'test.record-lock',
      targetEntity: 'sales.order',
      operations: ['update'],
      validate: async () => ({ ok: false, status: 423, body: { error: 'Record locked', code: 'RECORD_LOCKED' } }),
    })

    const response = await POST(makeRequest(undefined, SELECTED_ORGANIZATION_ID))

    expect(response.status).toBe(423)
    expect(await response.json()).toEqual({ error: 'Record locked', code: 'RECORD_LOCKED' })
    expect(mockCommandBus.execute).not.toHaveBeenCalled()
  })

  it('runs registered guards even when the legacy DI bridge is absent', async () => {
    const validate = jest.fn(async () => ({ ok: true }))
    registeredGuards.push({
      id: 'test.observer',
      targetEntity: '*',
      operations: ['update'],
      validate,
    })

    const response = await POST(makeRequest(undefined, SELECTED_ORGANIZATION_ID))

    expect(bridgeLegacyGuard).toHaveBeenCalled()
    expect(response.status).toBe(200)
    expect(validate).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceKind: 'sales.order',
        resourceId: ORDER_ID,
        operation: 'update',
        mutationPayload: expect.objectContaining({ orderId: ORDER_ID }),
      }),
    )
  })

  it('checks a guard feature gate against RBAC rather than the token claim', async () => {
    mockRbacService.getGrantedFeatures.mockResolvedValue([])
    const validate = jest.fn(async () => ({ ok: false, status: 423, body: { error: 'Record locked' } }))
    registeredGuards.push({
      id: 'test.feature-gated',
      targetEntity: 'sales.order',
      operations: ['update'],
      features: ['sales.orders.manage'],
      validate,
    })

    const response = await POST(makeRequest(undefined, SELECTED_ORGANIZATION_ID))

    // The gate is not satisfied, so the guard never runs — but the decision came
    // from RBAC, not from anything the caller could put in their own token.
    expect(validate).not.toHaveBeenCalled()
    expect(mockRbacService.getGrantedFeatures).toHaveBeenCalledWith('user-1', {
      tenantId: TENANT_ID,
      organizationId: SELECTED_ORGANIZATION_ID,
    })
    expect(response.status).toBe(200)
  })

  it('applies a payload modification returned by a guard before executing the command', async () => {
    registeredGuards.push({
      id: 'test.rewrites-deletes',
      targetEntity: 'sales.order',
      operations: ['update'],
      validate: async () => ({ ok: true, modifiedPayload: { deleteIds: [OTHER_LINE_ID] } }),
    })

    const response = await POST(makeRequest(undefined, SELECTED_ORGANIZATION_ID))

    expect(response.status).toBe(200)
    expect(mockCommandBus.execute).toHaveBeenCalledWith(
      'sales.orders.lines.upsert_many',
      expect.objectContaining({
        input: { body: expect.objectContaining({ deleteIds: [OTHER_LINE_ID] }) },
      }),
    )
  })

  it('keeps the committed success response when an afterSuccess callback throws', async () => {
    const afterSuccess = jest.fn(async () => {
      throw new Error('[internal] lock release failed')
    })
    registeredGuards.push({
      id: 'test.after-success-fails',
      targetEntity: 'sales.order',
      operations: ['update'],
      validate: async () => ({ ok: true, shouldRunAfterSuccess: true }),
      afterSuccess,
    })

    const response = await POST(makeRequest(undefined, SELECTED_ORGANIZATION_ID))

    // The batch committed. Reporting 400 here would make the caller retry, and
    // entries without an id would append a second time.
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ orderId: ORDER_ID, lineIds: [LINE_ID] })
    expect(afterSuccess).toHaveBeenCalledTimes(1)
    expect(mockCommandBus.execute).toHaveBeenCalledTimes(1)
  })

  it('runs every afterSuccess callback even when an earlier one throws', async () => {
    const second = jest.fn(async () => {})
    registeredGuards.push(
      {
        id: 'test.first-throws',
        targetEntity: 'sales.order',
        operations: ['update'],
        priority: 10,
        validate: async () => ({ ok: true, shouldRunAfterSuccess: true }),
        afterSuccess: async () => {
          throw new Error('[internal] first callback failed')
        },
      },
      {
        id: 'test.second-runs',
        targetEntity: 'sales.order',
        operations: ['update'],
        priority: 20,
        validate: async () => ({ ok: true, shouldRunAfterSuccess: true }),
        afterSuccess: second,
      },
    )

    const response = await POST(makeRequest(undefined, SELECTED_ORGANIZATION_ID))

    expect(response.status).toBe(200)
    expect(second).toHaveBeenCalledTimes(1)
  })
})

/**
 * The schema runs outside a request, so it tags each of its own refusals with a
 * translation key and the route resolves it. These assert the refusal text comes
 * from the catalogue rather than from the English literal in the schema.
 */
describe('batch order-line refusal localization', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    registeredGuards.length = 0
    jest.mocked(getAuthFromRequest).mockResolvedValue({
      sub: 'user-1',
      tenantId: TENANT_ID,
      orgId: HOME_ORGANIZATION_ID,
    })
    jest.mocked(resolveOrganizationScopeForRequest).mockResolvedValue({
      selectedId: SELECTED_ORGANIZATION_ID,
      filterIds: [SELECTED_ORGANIZATION_ID],
      allowedIds: null,
      tenantId: TENANT_ID,
    })
    mockRbacService.getGrantedFeatures.mockResolvedValue(['sales.orders.manage'])
    // Stand in for a non-English catalogue: every key resolves to a marked value,
    // so a hardcoded English string is visible as an unresolved one.
    jest.mocked(resolveTranslations).mockResolvedValue({
      translate: (key: string) => `pl:${key}`,
    } as never)
  })

  // `clearAllMocks` keeps implementations, so the stub above would otherwise
  // leak into any describe that runs after this one.
  afterEach(() => {
    jest.mocked(resolveTranslations).mockImplementation(async () => ({
      translate: (key: string, fallback?: string) => fallback ?? key,
    }) as never)
  })

  function emptyBatchRequest() {
    return new Request('http://localhost/api/sales/order-lines/batch', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `om_selected_org=${SELECTED_ORGANIZATION_ID}`,
      },
      body: JSON.stringify({ orderId: ORDER_ID, lines: [], deleteIds: [] }),
    })
  }

  it('returns the empty-batch refusal from the locale catalogue', async () => {
    const response = await POST(emptyBatchRequest())

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string; details: Array<{ message: string }> }
    expect(body.error).toBe('pl:sales.documents.items.bulk.errorInvalidInput')
    expect(body.details.map((issue) => issue.message)).toContain(
      `pl:${SALES_ORDER_LINE_BULK_ISSUE_KEYS.empty}`,
    )
    expect(mockCommandBus.execute).not.toHaveBeenCalled()
  })

  it('returns the upsert/delete-conflict refusal from the locale catalogue', async () => {
    const response = await POST(
      new Request('http://localhost/api/sales/order-lines/batch', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `om_selected_org=${SELECTED_ORGANIZATION_ID}`,
        },
        body: JSON.stringify({
          orderId: ORDER_ID,
          lines: [
            { id: LINE_ID, name: 'Batch line', currencyCode: 'USD', quantity: 1, unitPriceNet: 1, unitPriceGross: 1 },
          ],
          deleteIds: [LINE_ID],
        }),
      }),
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as { details: Array<{ message: string }> }
    expect(body.details.map((issue) => issue.message)).toContain(
      `pl:${SALES_ORDER_LINE_BULK_ISSUE_KEYS.upsertDeleteConflict}`,
    )
  })

  it("leaves zod's own built-in issues untouched", async () => {
    const response = await POST(
      new Request('http://localhost/api/sales/order-lines/batch', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `om_selected_org=${SELECTED_ORGANIZATION_ID}`,
        },
        // A valid line, so the only refusal is zod's own uuid check on orderId.
        body: JSON.stringify({
          orderId: 'not-a-uuid',
          lines: [
            { name: 'Batch line', currencyCode: 'USD', quantity: 1, unitPriceNet: 1, unitPriceGross: 1 },
          ],
        }),
      }),
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as { details: Array<{ message: string }> }
    expect(body.details.length).toBeGreaterThan(0)
    expect(body.details.every((issue) => !issue.message.startsWith('pl:'))).toBe(true)
  })
})
