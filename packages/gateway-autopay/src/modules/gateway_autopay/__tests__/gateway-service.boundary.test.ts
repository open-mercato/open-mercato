import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import { clearGatewayAdapters, clearPaymentGatewayDescriptors } from '@open-mercato/shared/modules/payment_gateways/types'
import { createPaymentGatewayService } from '@open-mercato/core/modules/payment_gateways/lib/gateway-service'
import { register } from '../di'
import { deriveMessageId, sanitizeOrderId } from '../lib/autopay-client'
import { computeAutopayHash } from '../lib/hash'
import { cancelResponseXml, refundResponseXml, statusResponseXml } from './support/autopay-xml'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

const findOneMock = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

const GATEWAY_URL = 'https://testpay.autopay.eu/sciezka'
const SUCCESS_URL = 'https://shop.example.com/pay/s/success/txn'
const CANCEL_URL = 'https://shop.example.com/pay/s/cancel/txn'

type TenantFixture = {
  scope: { organizationId: string; tenantId: string }
  credentials: { serviceId: string; sharedKey: string; gatewayUrl: string }
}

const tenantA: TenantFixture = {
  scope: { organizationId: 'org_a', tenantId: 'tenant_a' },
  credentials: { serviceId: '2', sharedKey: '2test2', gatewayUrl: GATEWAY_URL },
}
const tenantB: TenantFixture = {
  scope: { organizationId: 'org_b', tenantId: 'tenant_b' },
  credentials: { serviceId: '7', sharedKey: 'tenant-b-secret', gatewayUrl: GATEWAY_URL },
}
const tenants = [tenantA, tenantB]

const PAYMENT_A = '3fa85f64-5717-4562-b3fc-2c963f66afa6'
const PAYMENT_B = '9b2c4e1a-7d3f-4c58-8a61-0e5d2b7f9c13'
const ORDER_A = sanitizeOrderId(PAYMENT_A)
const ORDER_B = sanitizeOrderId(PAYMENT_B)

type StoredRecord = Record<string, unknown> & { id: string }

function matchesWhere(record: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = record[key]
    if (expected && typeof expected === 'object' && '$lt' in expected) {
      return actual instanceof Date && actual < (expected as { $lt: Date }).$lt
    }
    return actual === expected
  })
}

function operationKey(record: { operationId?: unknown; organizationId?: unknown; tenantId?: unknown }): string {
  return `${String(record.operationId)}|${String(record.organizationId)}|${String(record.tenantId)}`
}

function entityName(entity: unknown): string | undefined {
  return (entity as { name?: string }).name
}

function buildBoundary() {
  clearGatewayAdapters()
  clearPaymentGatewayDescriptors()
  register({ register: jest.fn() } as unknown as AppContainer)

  const transactions = new Map<string, StoredRecord>()
  const operations = new Map<string, StoredRecord>()
  let sequence = 0

  const em = {
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({
      id: `${entityName(_entity) === 'GatewayTransaction' ? 'txn' : 'operation'}_${++sequence}`,
      ...data,
    })),
    persist: jest.fn((record: StoredRecord) => ({
      flush: async () => {
        if ('operationId' in record) {
          const key = operationKey(record)
          if (operations.has(key)) throw Object.assign(new Error('duplicate payment operation'), { code: '23505' })
          operations.set(key, record)
          return
        }
        transactions.set(record.id, record)
      },
    })),
    nativeUpdate: jest.fn(async (entity: unknown, where: Record<string, unknown>, update: Record<string, unknown>) => {
      const candidates = entityName(entity) === 'GatewayTransaction'
        ? [...transactions.values()]
        : [...operations.values()]
      const matched = candidates.find((candidate) => matchesWhere(candidate, where))
      if (!matched) return 0
      Object.assign(matched, update)
      return 1
    }),
    flush: jest.fn(async () => {}),
    fork: jest.fn(() => em),
    transactional: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(em)),
  }

  findOneMock.mockReset()
  findOneMock.mockImplementation(async (_em, entity, where) => {
    const name = entityName(entity)
    const criteria = where as Record<string, unknown>
    if (name === 'GatewayPaymentOperation') return (operations.get(operationKey(criteria)) ?? null) as never
    if (name === 'GatewayTransaction') {
      return ([...transactions.values()].find((record) => matchesWhere(record, criteria)) ?? null) as never
    }
    return null
  })

  const resolveCredentials = jest.fn(async (integrationId: string, scope: { tenantId: string }) => {
    if (integrationId !== 'gateway_autopay') return null
    return tenants.find((tenant) => tenant.scope.tenantId === scope.tenantId)?.credentials ?? null
  })

  const service = createPaymentGatewayService({
    em: em as never,
    integrationCredentialsService: { resolve: resolveCredentials } as never,
  })

  return { service, transactions, operations, resolveCredentials }
}

function seedTransaction(
  boundary: ReturnType<typeof buildBoundary>,
  tenant: TenantFixture,
  fields: { id: string; orderId: string; status: string },
): StoredRecord {
  const record: StoredRecord = {
    id: fields.id,
    paymentId: fields.id,
    providerKey: 'autopay',
    providerSessionId: fields.orderId,
    unifiedStatus: fields.status,
    amount: '100.0000',
    capturedAmount: fields.status === 'captured' ? '100.0000' : '0.0000',
    currencyCode: 'PLN',
    gatewayMetadata: {},
    gatewayRefundId: null,
    organizationId: tenant.scope.organizationId,
    tenantId: tenant.scope.tenantId,
    deletedAt: null,
  }
  boundary.transactions.set(record.id, record)
  return record
}

type FetchHandler = (endpoint: string, body: URLSearchParams) => Response | Promise<Response>

function stubAutopay(handler: FetchHandler) {
  return jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
    const endpoint = String(url).split('/').pop() ?? ''
    return handler(endpoint, new URLSearchParams(String((init as RequestInit | undefined)?.body ?? '')))
  })
}

function bodiesFor(fetchSpy: jest.SpyInstance, endpoint: string): URLSearchParams[] {
  return fetchSpy.mock.calls
    .filter(([url]) => String(url).endsWith(endpoint))
    .map(([, init]) => new URLSearchParams(String((init as RequestInit).body)))
}

const settledStatusXml = (tenant: TenantFixture, orderId: string, remoteId = 'remote-1') => statusResponseXml(
  [{ orderID: orderId, remoteID: remoteId, amount: '100.00', currency: 'PLN', paymentDate: '20260910120000', paymentStatus: 'SUCCESS' }],
  tenant.credentials,
)

describe('Autopay through the payment gateway service', () => {
  beforeAll(() => {
    setGlobalEventBus({ emit: async () => {} })
  })

  afterEach(() => {
    jest.restoreAllMocks()
    clearGatewayAdapters()
    clearPaymentGatewayDescriptors()
  })

  describe('session creation', () => {
    it('persists a pending transaction whose redirect keeps the payer data out of the URL', async () => {
      const boundary = buildBoundary()

      const { transaction, session } = await boundary.service.createPaymentSession({
        providerKey: 'autopay',
        paymentId: PAYMENT_A,
        amount: 12.34,
        currencyCode: 'PLN',
        description: 'Order 42',
        successUrl: SUCCESS_URL,
        cancelUrl: CANCEL_URL,
        metadata: { customerEmail: 'buyer@example.com' },
        ...tenantA.scope,
      })

      expect(session.sessionId).toBe(ORDER_A)
      expect(transaction.providerSessionId).toBe(ORDER_A)
      expect(transaction.unifiedStatus).toBe('pending')
      expect(transaction.redirectUrl).toMatch(
        new RegExp(`^https://shop\\.example\\.com/api/gateway_autopay/launch\\?o=${ORDER_A}&t=[A-Za-z0-9_-]{43}$`),
      )
      expect(transaction.redirectUrl).not.toContain('buyer@example.com')
      expect(transaction.redirectUrl).not.toContain('autopay.eu')
      expect(boundary.transactions.get(transaction.id)).toBe(transaction)
    })

    it('stores everything the launch and return routes need, signed with the tenant own credentials', async () => {
      const boundary = buildBoundary()

      const { transaction } = await boundary.service.createPaymentSession({
        providerKey: 'autopay',
        paymentId: PAYMENT_B,
        amount: 12.34,
        currencyCode: 'PLN',
        description: 'Order 43',
        successUrl: SUCCESS_URL,
        cancelUrl: CANCEL_URL,
        metadata: { customerEmail: 'buyer@example.com' },
        ...tenantB.scope,
      })

      const metadata = transaction.gatewayMetadata as {
        formPost: { url: string; fields: Record<string, string> }
        launch: { token: string; expiresAt: string }
        returnTargets: { successUrl: string; cancelUrl: string }
      }
      expect(boundary.resolveCredentials).toHaveBeenCalledWith('gateway_autopay', tenantB.scope)
      expect(metadata.formPost.url).toBe(GATEWAY_URL)
      expect(metadata.formPost.fields.ServiceID).toBe('7')
      expect(metadata.formPost.fields.Hash).toBe(computeAutopayHash(
        ['7', ORDER_B, '12.34', 'Order 43', undefined, 'PLN', 'buyer@example.com'],
        'tenant-b-secret',
      ))
      expect(metadata.returnTargets).toEqual({ successUrl: SUCCESS_URL, cancelUrl: CANCEL_URL })
      expect(Date.parse(metadata.launch.expiresAt)).toBeGreaterThan(Date.now())
    })

    it('does not persist anything when the payer email is missing', async () => {
      const boundary = buildBoundary()

      await expect(boundary.service.createPaymentSession({
        providerKey: 'autopay',
        paymentId: PAYMENT_A,
        amount: 12.34,
        currencyCode: 'PLN',
        ...tenantA.scope,
      })).rejects.toThrow(/customerEmail/)

      expect(boundary.transactions.size).toBe(0)
    })

    it('rejects a non-PLN session before any transaction is stored', async () => {
      const boundary = buildBoundary()

      await expect(boundary.service.createPaymentSession({
        providerKey: 'autopay',
        paymentId: PAYMENT_A,
        amount: 12.34,
        currencyCode: 'EUR',
        metadata: { customerEmail: 'buyer@example.com' },
        ...tenantA.scope,
      })).rejects.toThrow(/PLN/)

      expect(boundary.transactions.size).toBe(0)
    })
  })

  describe('cancellation and reconciliation', () => {
    it('persists a confirmed full cancellation and replays it without another provider call', async () => {
      const boundary = buildBoundary()
      const transaction = seedTransaction(boundary, tenantA, { id: 'txn-cancel', orderId: ORDER_A, status: 'pending' })
      const fetchSpy = stubAutopay((endpoint, body) => new Response(
        cancelResponseXml({ confirmation: 'CONFIRMED', reason: 'CANCELED_FULLY', messageId: body.get('MessageID') ?? '' }),
        { status: 200 },
      ))

      const first = await boundary.service.cancelPayment('txn-cancel', 'customer request', tenantA.scope, 'cancel-op-1')
      const second = await boundary.service.cancelPayment('txn-cancel', 'customer request', tenantA.scope, 'cancel-op-1')

      expect(first.status).toBe('cancelled')
      expect(transaction.unifiedStatus).toBe('cancelled')
      expect(second).toEqual(first)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('reconciles a partial cancellation to the settled payment instead of reporting a cancel', async () => {
      const boundary = buildBoundary()
      const transaction = seedTransaction(boundary, tenantA, { id: 'txn-partial', orderId: ORDER_A, status: 'pending' })
      stubAutopay((endpoint, body) => (
        endpoint === 'transactionCancel'
          ? new Response(
            cancelResponseXml({ confirmation: 'CONFIRMED', reason: 'CANCELED_PARTIALLY', messageId: body.get('MessageID') ?? '' }),
            { status: 200 },
          )
          : new Response(settledStatusXml(tenantA, ORDER_A), { status: 200 })
      ))

      const result = await boundary.service.cancelPayment('txn-partial', undefined, tenantA.scope, 'cancel-op-partial')

      expect(result.status).toBe('captured')
      expect(transaction.unifiedStatus).toBe('captured')
    })

    it('fails closed on a partial cancellation with no settled payment and leaves the transaction pending', async () => {
      const boundary = buildBoundary()
      const transaction = seedTransaction(boundary, tenantA, { id: 'txn-stuck', orderId: ORDER_A, status: 'pending' })
      stubAutopay((endpoint, body) => (
        endpoint === 'transactionCancel'
          ? new Response(
            cancelResponseXml({ confirmation: 'CONFIRMED', reason: 'CANCELED_PARTIALLY', messageId: body.get('MessageID') ?? '' }),
            { status: 200 },
          )
          : new Response(statusResponseXml([], tenantA.credentials), { status: 200 })
      ))

      await expect(boundary.service.cancelPayment('txn-stuck', undefined, tenantA.scope, 'cancel-op-stuck'))
        .rejects.toThrow(/partially cancelled/)

      expect(transaction.unifiedStatus).toBe('pending')
    })

    it('keeps the transaction untouched when Autopay answers with a signed refusal', async () => {
      const boundary = buildBoundary()
      const transaction = seedTransaction(boundary, tenantA, { id: 'txn-settled', orderId: ORDER_A, status: 'pending' })
      stubAutopay((endpoint, body) => new Response(
        cancelResponseXml({ confirmation: 'NOTCONFIRMED', reason: 'ALREADY_SETTLED', messageId: body.get('MessageID') ?? '' }),
        { status: 200 },
      ))

      await expect(boundary.service.cancelPayment('txn-settled', undefined, tenantA.scope, 'cancel-op-refused'))
        .rejects.toThrow(/could not cancel/)

      expect(transaction.unifiedStatus).toBe('pending')
    })

    it('rejects an unsigned cancel acknowledgment and leaves the transaction untouched', async () => {
      const boundary = buildBoundary()
      const transaction = seedTransaction(boundary, tenantA, { id: 'txn-forged', orderId: ORDER_A, status: 'pending' })
      stubAutopay(() => new Response(
        '<?xml version="1.0"?><transaction><serviceID>2</serviceID><messageID>m1</messageID><confirmation>CONFIRMED</confirmation><reason>CANCELED_FULLY</reason><hash>forged</hash></transaction>',
        { status: 200 },
      ))

      await expect(boundary.service.cancelPayment('txn-forged', undefined, tenantA.scope, 'cancel-op-forged'))
        .rejects.toThrow(/hash verification/)

      expect(transaction.unifiedStatus).toBe('pending')
    })
  })

  describe('refunds', () => {
    const refundHandler: FetchHandler = (endpoint, body) => (
      endpoint === 'transactionStatus'
        ? new Response(settledStatusXml(tenantA, ORDER_A), { status: 200 })
        : new Response(refundResponseXml({ messageId: body.get('MessageID') ?? '' }), { status: 200 })
    )

    it('acknowledges an asynchronous refund and replays it without refunding a second time', async () => {
      const boundary = buildBoundary()
      const transaction = seedTransaction(boundary, tenantA, { id: 'txn-refund', orderId: ORDER_A, status: 'captured' })
      const fetchSpy = stubAutopay(refundHandler)

      const first = await boundary.service.refundPayment('txn-refund', 30, 'return', tenantA.scope, 'refund-op-1')
      const providerCallsAfterFirst = fetchSpy.mock.calls.length
      const second = await boundary.service.refundPayment('txn-refund', 30, 'return', tenantA.scope, 'refund-op-1')

      expect(first.status).toBe('captured')
      expect(first.refundedAmount).toBe(0)
      expect(first.providerData).toMatchObject({ refundStatus: 'pending', requestedAmount: 30 })
      expect(second).toEqual(first)
      expect(fetchSpy.mock.calls.length).toBe(providerCallsAfterFirst)
      expect(bodiesFor(fetchSpy, 'transactionRefund')).toHaveLength(1)
      expect(transaction.unifiedStatus).toBe('captured')
      expect(transaction.gatewayRefundId).toBe(first.refundId)
    })

    it('retries a timed-out refund with the same MessageID so Autopay can deduplicate it', async () => {
      const boundary = buildBoundary()
      seedTransaction(boundary, tenantA, { id: 'txn-retry', orderId: ORDER_A, status: 'captured' })
      let refundAttempts = 0
      const fetchSpy = stubAutopay((endpoint, body) => {
        if (endpoint === 'transactionRefund' && ++refundAttempts === 1) throw new Error('socket timeout')
        return refundHandler(endpoint, body)
      })

      await expect(boundary.service.refundPayment('txn-retry', 30, 'return', tenantA.scope, 'refund-op-retry'))
        .rejects.toThrow()
      const retried = await boundary.service.refundPayment('txn-retry', 30, 'return', tenantA.scope, 'refund-op-retry')

      const [firstAttempt, secondAttempt] = bodiesFor(fetchSpy, 'transactionRefund')
      expect(firstAttempt.get('MessageID')).toMatch(/^[a-f0-9]{32}$/)
      expect(secondAttempt.get('MessageID')).toBe(firstAttempt.get('MessageID'))
      expect(retried.refundId).toBe(secondAttempt.get('MessageID'))
    })

    it('uses a different MessageID for a different refund operation', async () => {
      const boundary = buildBoundary()
      seedTransaction(boundary, tenantA, { id: 'txn-two', orderId: ORDER_A, status: 'captured' })
      const fetchSpy = stubAutopay(refundHandler)

      await boundary.service.refundPayment('txn-two', 10, 'first', tenantA.scope, 'refund-op-a')
      await boundary.service.refundPayment('txn-two', 10, 'second', tenantA.scope, 'refund-op-b')

      const [first, second] = bodiesFor(fetchSpy, 'transactionRefund')
      expect(first.get('MessageID')).not.toBe(second.get('MessageID'))
      expect(first.get('MessageID')).toHaveLength(deriveMessageId('x').length)
    })

    it('refuses to refund a payment that Autopay has not settled and keeps it pending', async () => {
      const boundary = buildBoundary()
      const transaction = seedTransaction(boundary, tenantA, { id: 'txn-unpaid', orderId: ORDER_A, status: 'captured' })
      const fetchSpy = stubAutopay((endpoint) => new Response(
        statusResponseXml(
          [{ orderID: ORDER_A, remoteID: 'remote-1', amount: '100.00', currency: 'PLN', paymentDate: '20260910120000', paymentStatus: 'PENDING' }],
          tenantA.credentials,
        ),
        { status: 200 },
      ))

      await expect(boundary.service.refundPayment('txn-unpaid', 30, 'return', tenantA.scope, 'refund-op-unpaid'))
        .rejects.toThrow(/no captured transaction/)

      expect(bodiesFor(fetchSpy, 'transactionRefund')).toHaveLength(0)
      expect(transaction.unifiedStatus).toBe('captured')
    })
  })

  describe('tenant isolation', () => {
    it('does not let one tenant act on another tenant payment, and never calls the provider', async () => {
      const boundary = buildBoundary()
      seedTransaction(boundary, tenantA, { id: 'txn-of-a', orderId: ORDER_A, status: 'captured' })
      const fetchSpy = stubAutopay(() => new Response('', { status: 500 }))

      await expect(boundary.service.refundPayment('txn-of-a', 10, undefined, tenantB.scope, 'op-cross'))
        .rejects.toThrow(/Transaction not found/)
      await expect(boundary.service.cancelPayment('txn-of-a', undefined, tenantB.scope, 'op-cross-cancel'))
        .rejects.toThrow(/Transaction not found/)

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(boundary.resolveCredentials).not.toHaveBeenCalled()
    })

    it("signs each tenant's requests with that tenant's own service id and shared key", async () => {
      const boundary = buildBoundary()
      seedTransaction(boundary, tenantA, { id: 'txn-a', orderId: ORDER_A, status: 'captured' })
      seedTransaction(boundary, tenantB, { id: 'txn-b', orderId: ORDER_B, status: 'captured' })
      const fetchSpy = stubAutopay((endpoint, body) => {
        const tenant = body.get('ServiceID') === tenantB.credentials.serviceId ? tenantB : tenantA
        const orderId = tenant === tenantB ? ORDER_B : ORDER_A
        return endpoint === 'transactionStatus'
          ? new Response(settledStatusXml(tenant, orderId), { status: 200 })
          : new Response(refundResponseXml({ messageId: body.get('MessageID') ?? '', ...tenant.credentials }), { status: 200 })
      })

      await boundary.service.refundPayment('txn-a', 10, undefined, tenantA.scope, 'op-a')
      await boundary.service.refundPayment('txn-b', 10, undefined, tenantB.scope, 'op-b')

      expect(boundary.resolveCredentials).toHaveBeenCalledWith('gateway_autopay', tenantA.scope)
      expect(boundary.resolveCredentials).toHaveBeenCalledWith('gateway_autopay', tenantB.scope)
      const statusBodies = bodiesFor(fetchSpy, 'transactionStatus')
      expect(statusBodies.map((body) => body.get('ServiceID'))).toEqual(['2', '7'])
      expect(statusBodies[1].get('Hash')).toBe(computeAutopayHash(['7', ORDER_B], 'tenant-b-secret'))
    })

    it("rejects a response signed with another tenant's shared key", async () => {
      const boundary = buildBoundary()
      const transaction = seedTransaction(boundary, tenantB, { id: 'txn-b', orderId: ORDER_B, status: 'captured' })
      stubAutopay(() => new Response(settledStatusXml({ ...tenantB, credentials: { ...tenantB.credentials, sharedKey: tenantA.credentials.sharedKey } }, ORDER_B), { status: 200 }))

      await expect(boundary.service.refundPayment('txn-b', 10, undefined, tenantB.scope, 'op-b-cross'))
        .rejects.toThrow(/hash verification/)

      expect(transaction.unifiedStatus).toBe('captured')
    })
  })

  describe('status polling', () => {
    it('applies the canonical status Autopay reports and keeps the launch data intact', async () => {
      const boundary = buildBoundary()
      const transaction = seedTransaction(boundary, tenantA, { id: 'txn-poll', orderId: ORDER_A, status: 'pending' })
      transaction.gatewayMetadata = { launch: { token: 'keep-me' }, returnTargets: { successUrl: SUCCESS_URL, cancelUrl: CANCEL_URL } }
      stubAutopay(() => new Response(settledStatusXml(tenantA, ORDER_A), { status: 200 }))

      const status = await boundary.service.getPaymentStatus('txn-poll', tenantA.scope)

      expect(status.status).toBe('captured')
      expect(transaction.unifiedStatus).toBe('captured')
      expect(transaction.gatewayMetadata).toMatchObject({
        launch: { token: 'keep-me' },
        returnTargets: { successUrl: SUCCESS_URL, cancelUrl: CANCEL_URL },
      })
    })
  })
})
