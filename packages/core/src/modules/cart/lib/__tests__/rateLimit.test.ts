import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { enforceCartRateLimit } from '../rateLimit'
import { hashCartToken } from '../token'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

const allowed = { allowed: true, remainingPoints: 59, msBeforeNext: 0, consumedPoints: 1 }
const blocked = { ...allowed, allowed: false, remainingPoints: 0, msBeforeNext: 1_000 }
const request = new Request('https://store.example/api/cart/current', { headers: { 'x-forwarded-for': '192.0.2.10' } })

function createContainer(consume: jest.Mock, trustProxyDepth: number): AppContainer {
  return { resolve: () => ({ consume, trustProxyDepth }) } as unknown as AppContainer
}

it('limits the trusted source before counting an independent cart budget', async () => {
  const consume = jest.fn().mockResolvedValueOnce(allowed).mockResolvedValueOnce(allowed).mockResolvedValueOnce(blocked)
  const container = createContainer(consume, 1)

  await expect(enforceCartRateLimit(container, request, 'mutate', 'first-token', 'store-a')).resolves.toBeNull()
  const limited = await enforceCartRateLimit(container, request, 'mutate', 'second-token', 'store-a')

  expect(limited?.status).toBe(429)
  expect(limited?.headers.get('Cache-Control')).toBe('no-store')
  expect(consume.mock.calls.map(([key]) => key)).toEqual([
    'ip:192.0.2.10',
    `cart:${hashCartToken('first-token')}`,
    'ip:192.0.2.10',
  ])
})

it('bounds unattributed requests within their resolved store', async () => {
  const consume = jest.fn().mockResolvedValue(allowed)
  const container = createContainer(consume, 0)

  await enforceCartRateLimit(container, request, 'create', null, 'store-a')
  await enforceCartRateLimit(container, request, 'create', null, 'store-b')

  expect(consume.mock.calls.map(([key]) => key)).toEqual(['unattributed:store-a', 'unattributed:store-b'])
})

it('rejects a degraded decision for cart mutations', async () => {
  const consume = jest.fn().mockResolvedValue({ ...allowed, degraded: true })
  const response = await enforceCartRateLimit(createContainer(consume, 1), request, 'mutate', 'first-token', 'store-a')

  expect(response?.status).toBe(503)
  expect(consume).toHaveBeenCalledTimes(1)
})
