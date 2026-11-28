/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import { withCartLineMutationLock } from '../lineMutationLock'
import { POST as addLine, openApi as addLineOpenApi } from '../../api/current/lines/route'
import { POST as bulkAddLines, openApi as bulkAddOpenApi } from '../../api/current/lines/bulk/route'

const runAfterSuccess = jest.fn(async () => undefined)
const recordResponse = jest.fn(async (..._args: unknown[]) => undefined)
const mutate = jest.fn(async () => undefined)
const executeCommand = jest.fn()
let transactionActive = false
const manager = {
  begin: jest.fn(async () => { transactionActive = true }),
  commit: jest.fn(async () => { transactionActive = false }),
  rollback: jest.fn(async () => { transactionActive = false }),
  flush: jest.fn(async () => undefined),
  execute: jest.fn(async () => [{ locked: false }]),
  isInTransaction: jest.fn(() => transactionActive),
}

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: (key: string) => key === 'em' ? { fork: () => manager } : { execute: executeCommand } }),
}))
jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({ enforceCommandOptimisticLock: jest.fn() }))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: async () => ({ ok: true, runAfterSuccess }),
}))
jest.mock('../../commands/lines', () => ({ addLineCommand: { id: 'cart.lines.add' }, bulkAddLinesCommand: { id: 'cart.lines.bulkAdd' } }))
jest.mock('../currentCartRoute', () => ({
  ...jest.requireActual('../currentCartRoute'),
  readCartToken: () => 'cart-token',
  resolveRouteContextOrError: async () => ({ ok: true, routeContext: { tenantId: 'tenant-a', organizationId: 'org-a' } }),
  buildCommandContext: jest.fn(),
  resolveCurrentCart: async () => ({ cart: { id: 'cart-a' }, priceChanges: [] }),
}))
jest.mock('../rateLimit', () => ({ enforceCartRateLimit: async () => null }))
jest.mock('../idempotency', () => ({
  computeRequestDigest: () => 'digest',
  readIdempotencyKey: () => 'same-idempotency-key',
  findIdempotencyReplay: async () => null,
  recordIdempotencyResponse: (...args: unknown[]) => recordResponse(...args),
}))

beforeEach(() => {
  jest.clearAllMocks()
  transactionActive = false
  manager.execute.mockResolvedValue([{ locked: false }])
  mutate.mockResolvedValue(undefined)
  executeCommand.mockImplementation(async (label: string) => {
    await withCartLineMutationLock(manager as unknown as EntityManager, 'cart-a', [mutate], label, 0)
    return { result: {} }
  })
})

it.each([
  ['add', addLine, addLineOpenApi, { productId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', quantity: '1' }],
  ['bulk add', bulkAddLines, bulkAddOpenApi, { lines: [{ productId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', quantity: '1' }] }],
] as const)('%s returns a retryable 503 only after empty rollback without recording success or replaying the command', async (_name, handler, openApi, body) => {
  const request = new Request('https://example.test/api/cart/current/lines', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
  const response = await handler(request)
  expect(response.status).toBe(503)
  expect(response.headers.get('Retry-After')).toBe('1')
  await expect(response.json()).resolves.toEqual({ error: 'Cart is busy. Please try again.', code: 'cart_busy' })
  expect(manager.rollback).toHaveBeenCalledTimes(1)
  expect(transactionActive).toBe(false)
  expect(manager.flush).not.toHaveBeenCalled()
  expect(mutate).not.toHaveBeenCalled()
  expect(executeCommand).toHaveBeenCalledTimes(1)
  expect(runAfterSuccess).not.toHaveBeenCalled()
  expect(recordResponse).not.toHaveBeenCalled()
  expect(openApi.methods.POST?.errors?.find(error => error.status === 503)?.description).toContain('cart_busy')
})


it.each([['add', addLine], ['bulk add', bulkAddLines]] as const)('%s leaves a mutation failure as 500 without replay or a retry header', async (name, handler) => {
  manager.execute.mockResolvedValue([{ locked: true }])
  mutate.mockRejectedValue(new Error('[internal] Mutation failed after acquisition'))
  const entry = { productId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', quantity: '1' }
  const body = name === 'add' ? entry : { lines: [entry] }
  const response = await handler(new Request('https://example.test/api/cart/current/lines', { method: 'POST', body: JSON.stringify(body) }))
  expect(response.status).toBe(500)
  expect(response.headers.get('Retry-After')).toBeNull()
  expect(mutate).toHaveBeenCalledTimes(1)
  expect(executeCommand).toHaveBeenCalledTimes(1)
  expect(manager.rollback).toHaveBeenCalledTimes(1)
  expect(runAfterSuccess).not.toHaveBeenCalled()
  expect(recordResponse).not.toHaveBeenCalled()
})
