/** @jest-environment node */
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { reserveCartPromotionAttempt } from '../promotionRateLimit'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))

const scope = { tenantId: 'tenant-a', organizationId: 'org-a', storeId: 'store-a' }
const containerFor = (limiter: unknown) => ({ resolve: () => limiter }) as unknown as AppContainer
const requestFor = (ip: string, cart = 'cart-a') => new Request('https://shop.test/api/cart/current/promotions', {
  headers: { 'x-forwarded-for': ip, 'x-cart-token': cart },
})

let limiter: RateLimiterService
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-13T12:00:00.000Z'))
  limiter = new RateLimiterService({ enabled: true, strategy: 'memory', keyPrefix: 'test', trustProxyDepth: 1 })
})
afterEach(async () => {
  await limiter.destroy()
  jest.useRealTimers()
})

it('keeps the client budget across rotating cart tokens and guessed codes', async () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    expect((await reserveCartPromotionAttempt(containerFor(limiter), requestFor('192.0.2.1', `cart-${attempt}`), scope)).ok).toBe(true)
  }
  const blocked = await reserveCartPromotionAttempt(containerFor(limiter), requestFor('192.0.2.1', 'fresh-cart'), scope)
  expect(blocked.ok).toBe(false)
  if (blocked.ok) throw new Error('[internal] expected rate limit')
  expect(blocked.response.status).toBe(429)
  expect(blocked.response.headers.get('Retry-After')).toBeTruthy()
  expect(blocked.response.headers.get('Cache-Control')).toBe('no-store')
})

it.each([0, 2])('uses one fallback budget when client IP cannot be resolved with proxy depth %s', async (trustProxyDepth) => {
  await limiter.destroy()
  limiter = new RateLimiterService({ enabled: true, strategy: 'memory', keyPrefix: 'test', trustProxyDepth })
  for (let attempt = 0; attempt < 20; attempt += 1) {
    expect((await reserveCartPromotionAttempt(containerFor(limiter), requestFor(`192.0.2.${attempt}`, `cart-${attempt}`), scope)).ok).toBe(true)
  }
  const blocked = await reserveCartPromotionAttempt(containerFor(limiter), requestFor('198.51.100.1', 'fresh-cart'), scope)
  expect(!blocked.ok && blocked.response.status).toBe(429)
})

it('bounds concurrent failed guesses from different clients per store', async () => {
  const attempts = await Promise.all(Array.from({ length: 150 }, (_, index) =>
    reserveCartPromotionAttempt(containerFor(limiter), requestFor(`192.0.2.${index}`, `cart-${index}`), scope),
  ))
  expect(attempts.filter(attempt => attempt.ok)).toHaveLength(100)
  expect(attempts.filter(attempt => !attempt.ok && attempt.response.status === 429)).toHaveLength(50)
  for (const isolated of [
    { ...scope, storeId: 'store-b' },
    { ...scope, organizationId: 'org-b' },
    { ...scope, tenantId: 'tenant-b' },
  ]) {
    expect((await reserveCartPromotionAttempt(containerFor(limiter), requestFor('192.0.2.200'), isolated)).ok).toBe(true)
  }
})

it('refunds successful applications without clearing existing failures', async () => {
  for (let index = 0; index < 99; index += 1) {
    await reserveCartPromotionAttempt(containerFor(limiter), requestFor(`192.0.2.${index}`), scope)
  }
  for (let index = 0; index < 3; index += 1) {
    const success = await reserveCartPromotionAttempt(containerFor(limiter), requestFor(`198.51.100.${index}`), scope)
    if (!success.ok) throw new Error('[internal] expected successful attempt')
    await success.succeeded()
  }
  expect((await reserveCartPromotionAttempt(containerFor(limiter), requestFor('203.0.113.1'), scope)).ok).toBe(true)
  const blocked = await reserveCartPromotionAttempt(containerFor(limiter), requestFor('203.0.113.2'), scope)
  expect(!blocked.ok && blocked.response.status).toBe(429)
})

it('does not let an old success refund failed guesses from a newer time window', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-13T12:00:59.000Z'))
  const success = await reserveCartPromotionAttempt(containerFor(limiter), requestFor('198.51.100.1'), scope)
  if (!success.ok) throw new Error('[internal] expected successful attempt')
  jest.advanceTimersByTime(1000)
  for (let index = 0; index < 100; index += 1) {
    await reserveCartPromotionAttempt(containerFor(limiter), requestFor(`192.0.2.${index}`), scope)
  }
  await success.succeeded()
  const blocked = await reserveCartPromotionAttempt(containerFor(limiter), requestFor('203.0.113.1'), scope)
  expect(!blocked.ok && blocked.response.status).toBe(429)
  jest.advanceTimersByTime(60_000)
  expect((await reserveCartPromotionAttempt(containerFor(limiter), requestFor('203.0.113.1'), scope)).ok).toBe(true)
})

it.each(['missing', 'throwing', 'degraded-client', 'degraded-store'])('rejects attempts when the limiter is %s', async (failure) => {
  const allowed = { allowed: true, remainingPoints: 20, msBeforeNext: 60_000, consumedPoints: 0 }
  const consume = jest.fn().mockResolvedValue({ ...allowed, degraded: true })
  if (failure === 'throwing') consume.mockRejectedValue(new Error('[internal] limiter unavailable'))
  if (failure === 'degraded-store') consume.mockResolvedValueOnce(allowed)
  const broken = failure === 'missing' ? null : { trustProxyDepth: 1, consume }
  const result = await reserveCartPromotionAttempt(containerFor(broken), requestFor('192.0.2.1'), scope)
  expect(!result.ok && result.response.status).toBe(503)
})

it('rejects an unregistered limiter rather than executing an uncounted guess', async () => {
  const container = { resolve: () => { throw new Error('[internal] missing registration') } } as unknown as AppContainer
  const result = await reserveCartPromotionAttempt(container, requestFor('192.0.2.1'), scope)
  expect(!result.ok && result.response.status).toBe(503)
})

it('retains the slot when refund fails without turning a successful mutation into an error', async () => {
  jest.spyOn(limiter, 'reward').mockRejectedValue(new Error('[internal] refund failed'))
  const success = await reserveCartPromotionAttempt(containerFor(limiter), requestFor('192.0.2.1'), scope)
  if (!success.ok) throw new Error('[internal] expected successful attempt')
  await expect(success.succeeded()).resolves.toBeUndefined()
})
