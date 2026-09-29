/** @jest-environment node */
/**
 * The module's own DI registration, exercised against a real Awilix container.
 *
 * Lifetime is the part worth pinning: the service closes over the request
 * container's `em`, so a SINGLETON would pin one request's EntityManager — and with
 * it one request's tenant — for the life of the process.
 */
import { InjectionMode, asValue, createContainer } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CacheStrategy } from '@open-mercato/cache'
import { EXAMPLE_TODO_SUMMARY_SERVICE, register } from '../di'
import type { TodoSummaryService } from '../lib/todoSummaryCache'

const TENANT_A = '00000000-0000-4000-8000-00000000000a'
const ORG_A1 = '00000000-0000-4000-8000-0000000000a1'

function stubCache(): CacheStrategy {
  return {
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    has: jest.fn(async () => false),
    delete: jest.fn(async () => false),
    deleteByTags: jest.fn(async () => 0),
    clear: jest.fn(async () => 0),
    keys: jest.fn(async () => []),
    stats: jest.fn(async () => ({ size: 0, expired: 0 })),
  }
}

function buildContainer(counts: { total: number; done: number }) {
  // CLASSIC, matching `packages/shared/src/lib/di/container.ts`. This is not a detail: classic
  // injection resolves one registration per PARAMETER NAME, so a factory declared with a single
  // named parameter resolves nothing and throws at request time. Building this fixture with
  // PROXY hid exactly that failure — the summary route returned 500 for every caller while this
  // test stayed green — so the fixture now mirrors the container the app actually builds.
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  const count = jest.fn(async (_entity: unknown, where: Record<string, unknown>) =>
    where.isDone === true ? counts.done : counts.total,
  )
  container.register({
    em: asValue({ count }),
    cache: asValue(stubCache()),
  })
  register(container as unknown as AppContainer)
  return { container, count }
}

describe('example module DI registration', () => {
  it('registers the todo summary service as a scoped Awilix function provider', () => {
    const { container } = buildContainer({ total: 0, done: 0 })
    const registration = container.registrations[EXAMPLE_TODO_SUMMARY_SERVICE]

    expect(EXAMPLE_TODO_SUMMARY_SERVICE).toBe('exampleTodoSummaryService')
    expect(registration).toBeDefined()
    expect(registration.lifetime).toBe('SCOPED')
  })

  it('resolves a working service that reads counts through the injected EntityManager', async () => {
    const { container, count } = buildContainer({ total: 6, done: 2 })

    const service = container.createScope().resolve<TodoSummaryService>(EXAMPLE_TODO_SUMMARY_SERVICE)
    const result = await service.read({ tenantId: TENANT_A, organizationId: ORG_A1 })

    expect(result.summary).toEqual({
      total: 6,
      done: 2,
      open: 4,
      tenantId: TENANT_A,
      organizationId: ORG_A1,
    })
    for (const call of count.mock.calls) {
      expect(call[1]).toMatchObject({ tenantId: TENANT_A, organizationId: ORG_A1, deletedAt: null })
    }
  })

  it('gives each scope its own instance so one request cannot pin another request state', () => {
    const { container } = buildContainer({ total: 0, done: 0 })

    const first = container.createScope().resolve(EXAMPLE_TODO_SUMMARY_SERVICE)
    const second = container.createScope().resolve(EXAMPLE_TODO_SUMMARY_SERVICE)

    expect(first).not.toBe(second)
  })
})
