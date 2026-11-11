import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  registerTelemetryRuntime,
  resetTelemetryRuntime,
  type TelemetryRuntime,
} from '@open-mercato/shared/lib/telemetry/runtime'
import { computeAutopayHash } from '../lib/hash'
import { createLaunchGrant } from '../lib/launch'
import { GET as launchGet } from '../api/launch/route'
import { GET as returnGet } from '../api/return/route'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/payment_gateways/data/entities', () => ({
  GatewayTransaction: class GatewayTransaction {},
}))

const mockContainer = { resolve: jest.fn() }
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

const findMock = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

const ORDER_ID = '3fa85f6457174562b3fc2c963f66afa6'
const GATEWAY_URL = 'https://testpay.autopay.eu/sciezka'
const SUCCESS_URL = 'https://shop.example.com/pay/s/success/txn-1'
const CANCEL_URL = 'https://shop.example.com/pay/s/cancel/txn-1'

type FakeTransaction = {
  id: string
  tenantId: string
  organizationId: string
  providerKey: string
  providerSessionId: string
  unifiedStatus: string
  gatewayMetadata: Record<string, unknown>
}

function makeTransaction(overrides: Partial<FakeTransaction> = {}, grant = createLaunchGrant()): FakeTransaction & { grant: typeof grant } {
  return {
    id: 'txn-1',
    tenantId: 'tenant-a',
    organizationId: 'org-a',
    providerKey: 'autopay',
    providerSessionId: ORDER_ID,
    unifiedStatus: 'pending',
    gatewayMetadata: {
      launch: grant,
      formPost: {
        url: GATEWAY_URL,
        method: 'POST',
        fields: { ServiceID: '2', OrderID: ORDER_ID, Amount: '1.50', CustomerEmail: 'buyer@example.com', Hash: 'signed' },
      },
      returnTargets: { successUrl: SUCCESS_URL, cancelUrl: CANCEL_URL },
    },
    ...overrides,
    grant,
  }
}

const credentialsByTenant: Record<string, Record<string, unknown>> = {
  'tenant-a': { serviceId: '2', sharedKey: 'key-a', gatewayUrl: GATEWAY_URL },
  'tenant-b': { serviceId: '2', sharedKey: 'key-b', gatewayUrl: GATEWAY_URL },
}

const credentialsService = {
  resolve: jest.fn(async (_integrationId: string, scope: { tenantId: string }) => credentialsByTenant[scope.tenantId] ?? null),
}
const paymentGatewayService = { getPaymentStatus: jest.fn() }
let rateLimiterService: { consume: jest.Mock; trustProxyDepth: number } | null = null

beforeEach(() => {
  jest.clearAllMocks()
  rateLimiterService = null
  mockContainer.resolve.mockImplementation((name: string) => {
    if (name === 'em') return {}
    if (name === 'integrationCredentialsService') return credentialsService
    if (name === 'paymentGatewayService') return paymentGatewayService
    if (name === 'rateLimiterService') {
      if (!rateLimiterService) throw new Error('not registered')
      return rateLimiterService
    }
    throw new Error(`unexpected dependency ${name}`)
  })
})

afterEach(() => resetTelemetryRuntime())

const launchUrl = (orderId: string, token: string) => `https://shop.example.com/api/gateway_autopay/launch?o=${orderId}&t=${token}`
const returnUrl = (query: Record<string, string>) =>
  `https://shop.example.com/api/gateway_autopay/return?${new URLSearchParams(query)}`
const signedReturn = (sharedKey: string, orderId = ORDER_ID) => ({
  ServiceID: '2',
  OrderID: orderId,
  Hash: computeAutopayHash(['2', orderId], sharedKey),
})

describe('GET /api/gateway_autopay/launch', () => {
  it('renders the signed POST form for a valid token and keeps it out of caches', async () => {
    const transaction = makeTransaction()
    findMock.mockResolvedValue([transaction] as never)

    const response = await launchGet(new Request(launchUrl(ORDER_ID, transaction.grant.token)))
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain(`method="POST" action="${GATEWAY_URL}"`)
    expect(html).toContain('name="CustomerEmail" value="buyer@example.com"')
    expect(html).toContain('name="Hash" value="signed"')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(response.headers.get('Content-Security-Policy')).toContain('form-action https:')
  })

  it('looks the candidate up by provider and order id only', async () => {
    const transaction = makeTransaction()
    findMock.mockResolvedValue([transaction] as never)

    await launchGet(new Request(launchUrl(ORDER_ID, transaction.grant.token)))

    expect(findMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { providerKey: 'autopay', providerSessionId: ORDER_ID, deletedAt: null },
      expect.objectContaining({ limit: 10 }),
    )
  })

  it.each([
    ['a missing token', `https://shop.example.com/api/gateway_autopay/launch?o=${ORDER_ID}`],
    ['a malformed token', launchUrl(ORDER_ID, 'short')],
    ['a malformed order id', launchUrl('bad id!', createLaunchGrant().token)],
    ['no parameters', 'https://shop.example.com/api/gateway_autopay/launch'],
  ])('answers 404 without touching the database for %s', async (_label, url) => {
    const response = await launchGet(new Request(url))

    expect(response.status).toBe(404)
    expect(findMock).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain('<form')
  })

  it('refuses a token that does not belong to the order', async () => {
    findMock.mockResolvedValue([makeTransaction()] as never)

    const response = await launchGet(new Request(launchUrl(ORDER_ID, createLaunchGrant().token)))

    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('buyer@example.com')
  })

  it('refuses an expired token', async () => {
    const expired = makeTransaction({}, createLaunchGrant(Date.now() - 31 * 60 * 1000))
    findMock.mockResolvedValue([expired] as never)

    const response = await launchGet(new Request(launchUrl(ORDER_ID, expired.grant.token)))

    expect(response.status).toBe(404)
  })

  it.each(['captured', 'failed', 'cancelled', 'authorized'])('refuses to restart a payment that is already %s', async (status) => {
    const transaction = makeTransaction({ unifiedStatus: status })
    findMock.mockResolvedValue([transaction] as never)

    const response = await launchGet(new Request(launchUrl(ORDER_ID, transaction.grant.token)))

    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('<form')
  })

  it('refuses a stored gateway host that is not a documented Autopay host, and reports it', async () => {
    const reportError = jest.fn()
    registerTelemetryRuntime({ reportError } as unknown as TelemetryRuntime)
    const transaction = makeTransaction()
    transaction.gatewayMetadata.formPost = { url: 'https://evil.example.com/pay', method: 'POST', fields: { A: '1' } }
    findMock.mockResolvedValue([transaction] as never)

    const response = await launchGet(new Request(launchUrl(ORDER_ID, transaction.grant.token)))

    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('evil.example.com')
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), {
      module: 'gateway_autopay',
      code: 'gateway_autopay.launch_failed',
    })
  })

  it('answers with the rate limiter response when the caller is throttled', async () => {
    rateLimiterService = {
      trustProxyDepth: 0,
      consume: jest.fn(async () => ({ allowed: false, msBeforeNext: 2000, remainingPoints: 0, degraded: false })),
    }

    const response = await launchGet(new Request(launchUrl(ORDER_ID, createLaunchGrant().token)))

    expect(response.status).toBe(429)
    expect(findMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/gateway_autopay/return', () => {
  it('verifies the signature, reads the canonical status and sends a paid payer to the success page', async () => {
    findMock.mockResolvedValue([makeTransaction()] as never)
    paymentGatewayService.getPaymentStatus.mockResolvedValue({ status: 'captured' })

    const response = await returnGet(new Request(returnUrl(signedReturn('key-a'))))

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe(SUCCESS_URL)
    expect(paymentGatewayService.getPaymentStatus).toHaveBeenCalledWith('txn-1', {
      organizationId: 'org-a',
      tenantId: 'tenant-a',
    })
  })

  it.each(['failed', 'cancelled', 'expired'])('sends a %s payment to the cancel page', async (status) => {
    findMock.mockResolvedValue([makeTransaction()] as never)
    paymentGatewayService.getPaymentStatus.mockResolvedValue({ status })

    const response = await returnGet(new Request(returnUrl(signedReturn('key-a'))))

    expect(response.headers.get('Location')).toBe(CANCEL_URL)
  })

  it('rejects a return that is not signed with the tenant shared key, without any status call', async () => {
    findMock.mockResolvedValue([makeTransaction()] as never)

    const response = await returnGet(new Request(returnUrl(signedReturn('not-the-key'))))

    expect(response.status).toBe(400)
    expect(response.headers.get('Location')).toBeNull()
    expect(paymentGatewayService.getPaymentStatus).not.toHaveBeenCalled()
  })

  it.each([
    ['no parameters', {}],
    ['a missing hash', { ServiceID: '2', OrderID: ORDER_ID }],
    ['a malformed order id', { ServiceID: '2', OrderID: 'bad id!', Hash: 'x' }],
  ])('answers 400 for %s without touching the database', async (_label, query) => {
    const response = await returnGet(new Request(returnUrl(query as Record<string, string>)))

    expect(response.status).toBe(400)
    expect(findMock).not.toHaveBeenCalled()
  })

  it('isolates tenants: only the candidate whose own credentials verify the signature is used', async () => {
    const tenantA = makeTransaction({ id: 'txn-a', tenantId: 'tenant-a', organizationId: 'org-a' })
    const tenantB = makeTransaction({ id: 'txn-b', tenantId: 'tenant-b', organizationId: 'org-b' })
    tenantB.gatewayMetadata.returnTargets = { successUrl: 'https://other.example.com/s', cancelUrl: 'https://other.example.com/c' }
    findMock.mockResolvedValue([tenantA, tenantB] as never)
    paymentGatewayService.getPaymentStatus.mockResolvedValue({ status: 'captured' })

    const response = await returnGet(new Request(returnUrl(signedReturn('key-b'))))

    expect(credentialsService.resolve).toHaveBeenCalledWith('gateway_autopay', { organizationId: 'org-a', tenantId: 'tenant-a' })
    expect(credentialsService.resolve).toHaveBeenCalledWith('gateway_autopay', { organizationId: 'org-b', tenantId: 'tenant-b' })
    expect(response.headers.get('Location')).toBe('https://other.example.com/s')
    expect(paymentGatewayService.getPaymentStatus).toHaveBeenCalledTimes(1)
    expect(paymentGatewayService.getPaymentStatus).toHaveBeenCalledWith('txn-b', { organizationId: 'org-b', tenantId: 'tenant-b' })
  })

  it('fails closed when more than one candidate verifies the signature', async () => {
    const first = makeTransaction({ id: 'txn-1' })
    const second = makeTransaction({ id: 'txn-2' })
    findMock.mockResolvedValue([first, second] as never)

    const response = await returnGet(new Request(returnUrl(signedReturn('key-a'))))

    expect(response.status).toBe(400)
    expect(paymentGatewayService.getPaymentStatus).not.toHaveBeenCalled()
  })

  it('falls back to the stored status and reports when the canonical status read fails', async () => {
    const reportError = jest.fn()
    registerTelemetryRuntime({ reportError } as unknown as TelemetryRuntime)
    findMock.mockResolvedValue([makeTransaction()] as never)
    paymentGatewayService.getPaymentStatus.mockRejectedValue(new Error('Autopay unreachable'))

    const response = await returnGet(new Request(returnUrl(signedReturn('key-a'))))

    expect(response.headers.get('Location')).toBe(SUCCESS_URL)
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), {
      module: 'gateway_autopay',
      code: 'gateway_autopay.return_failed',
    })
  })

  it('never redirects to an address taken from the request', async () => {
    findMock.mockResolvedValue([makeTransaction()] as never)
    paymentGatewayService.getPaymentStatus.mockResolvedValue({ status: 'captured' })

    const response = await returnGet(new Request(returnUrl({
      ...signedReturn('key-a'),
      redirect: 'https://evil.example.com',
      returnUrl: 'https://evil.example.com',
      successUrl: 'https://evil.example.com',
    })))

    expect(response.headers.get('Location')).toBe(SUCCESS_URL)
  })

  it('shows a neutral page instead of redirecting to an unsafe stored address', async () => {
    const transaction = makeTransaction()
    transaction.gatewayMetadata.returnTargets = { successUrl: 'javascript:alert(1)', cancelUrl: null }
    findMock.mockResolvedValue([transaction] as never)
    paymentGatewayService.getPaymentStatus.mockResolvedValue({ status: 'captured' })

    const response = await returnGet(new Request(returnUrl(signedReturn('key-a'))))

    expect(response.status).toBe(200)
    expect(response.headers.get('Location')).toBeNull()
  })

  it('answers 429 when the caller is throttled', async () => {
    rateLimiterService = {
      trustProxyDepth: 0,
      consume: jest.fn(async () => ({ allowed: false, msBeforeNext: 1000, remainingPoints: 0, degraded: false })),
    }

    const response = await returnGet(new Request(returnUrl(signedReturn('key-a'))))

    expect(response.status).toBe(429)
    expect(findMock).not.toHaveBeenCalled()
  })
})
