/** @jest-environment node */
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { POST } from '../../api/current/promotions/route'

const executeCommand = jest.fn()
const runAfterSuccess = jest.fn()
let limiter: RateLimiterService | null
let currentScope = { tenantId: 'tenant-a', organizationId: 'org-a', storeId: 'store-a' }

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: (key: string) => key === 'rateLimiterService' ? limiter : { execute: executeCommand } }),
}))
jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({ enforceCommandOptimisticLock: jest.fn() }))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: async () => ({ ok: true, runAfterSuccess }),
}))
jest.mock('../../commands/promotions', () => ({ applyPromotionCommand: { id: 'cart.promotions.apply' } }))
jest.mock('../currentCartRoute', () => ({
  ...jest.requireActual('../currentCartRoute'),
  resolveRouteContextOrError: async () => ({ ok: true, routeContext: currentScope }),
  buildCommandContext: jest.fn(),
  resolveCurrentCart: async (_bus: unknown, _ctx: unknown, _scope: unknown, token: string) => ({ cart: { id: token }, priceChanges: [] }),
}))
jest.mock('../rateLimit', () => ({ enforceCartRateLimit: async () => null }))
jest.mock('../cartView', () => ({ buildCartResponseEnvelope: async () => ({ ok: true }) }))

function requestFor(index: number, ip = '192.0.2.1') {
  return new Request('https://shop.test/api/cart/current/promotions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cart-token': `cart-${index}`, 'x-forwarded-for': ip },
    body: JSON.stringify({ codeString: `GUESS${index}` }),
  })
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-13T12:00:00.000Z'))
  jest.clearAllMocks()
  currentScope = { tenantId: 'tenant-a', organizationId: 'org-a', storeId: 'store-a' }
  limiter = new RateLimiterService({ enabled: true, strategy: 'memory', keyPrefix: 'test', trustProxyDepth: 1 })
  executeCommand.mockRejectedValue(new CrudHttpError(409, { code: 'code_reservation_unavailable' }))
})
afterEach(async () => {
  await limiter?.destroy()
  jest.useRealTimers()
})

it('stops guessing before command execution when cart tokens rotate from one client', async () => {
  for (let index = 0; index < 20; index += 1) expect((await POST(requestFor(index))).status).toBe(409)
  const response = await POST(requestFor(20))
  expect(response.status).toBe(429)
  expect(executeCommand).toHaveBeenCalledTimes(20)
  expect(runAfterSuccess).not.toHaveBeenCalled()
})

it('stops store-wide failures across clients and carts while preserving another store', async () => {
  for (let index = 0; index < 100; index += 1) expect((await POST(requestFor(index, `192.0.2.${index}`))).status).toBe(409)
  expect((await POST(requestFor(101, '198.51.100.1'))).status).toBe(429)
  expect(executeCommand).toHaveBeenCalledTimes(100)
  currentScope = { ...currentScope, storeId: 'store-b' }
  expect((await POST(requestFor(102, '198.51.100.1'))).status).toBe(409)
})

it('refunds successful applications while keeping failed guesses charged', async () => {
  for (let index = 0; index < 99; index += 1) await POST(requestFor(index, `192.0.2.${index}`))
  executeCommand.mockResolvedValueOnce({ result: {} })
  expect((await POST(requestFor(100, '198.51.100.1'))).status).toBe(200)
  expect(runAfterSuccess).toHaveBeenCalledTimes(1)
  expect((await POST(requestFor(101, '198.51.100.2'))).status).toBe(409)
  expect((await POST(requestFor(102, '198.51.100.3'))).status).toBe(429)
})

it('fails closed before executing the command when the limiter is unavailable', async () => {
  await limiter?.destroy()
  limiter = null
  expect((await POST(requestFor(0))).status).toBe(503)
  expect(executeCommand).not.toHaveBeenCalled()
})

it('bounds guesses when unresolved IPs and cart tokens both rotate', async () => {
  await limiter?.destroy()
  limiter = new RateLimiterService({ enabled: true, strategy: 'memory', keyPrefix: 'test', trustProxyDepth: 0 })
  for (let index = 0; index < 20; index += 1) expect((await POST(requestFor(index, `192.0.2.${index}`))).status).toBe(409)
  expect((await POST(requestFor(20, '198.51.100.1'))).status).toBe(429)
  expect(executeCommand).toHaveBeenCalledTimes(20)
})
