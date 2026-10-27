/** @jest-environment node */
/**
 * The invalidation half of the module cache. The summary route can only be as fresh
 * as this subscriber, so the tests pin what it drops, when it refuses to act, and
 * that a failure here never propagates into an already-committed write.
 */
import { getCurrentCacheTenant } from '@open-mercato/cache'
import { buildTodoSummaryCacheTags } from '../lib/todoSummaryCache'
import handler, { metadata } from '../subscribers/invalidate-todo-summary'

const TENANT_A = '00000000-0000-4000-8000-00000000000a'
const ORG_A1 = '00000000-0000-4000-8000-0000000000a1'

type DeleteByTagsMock = jest.Mock<Promise<number>, [string[]]>

function createContext(overrides?: { deleteByTags?: DeleteByTagsMock; resolveThrows?: boolean }) {
  const observedTenants: Array<string | null> = []
  const deleteByTags: DeleteByTagsMock =
    overrides?.deleteByTags ??
    (jest.fn(async () => {
      observedTenants.push(getCurrentCacheTenant())
      return 1
    }) as DeleteByTagsMock)
  const resolve = jest.fn(<T,>(token: string): T => {
    if (overrides?.resolveThrows) throw new Error('[internal] no cache registered')
    if (token !== 'cache') throw new Error(`[internal] unexpected token ${token}`)
    return { deleteByTags } as unknown as T
  })
  return { ctx: { resolve }, deleteByTags, observedTenants }
}

describe('example:invalidate-todo-summary subscriber', () => {
  it('subscribes to every todo write, not just one action', () => {
    expect(metadata.event).toBe('example.todo.*')
    expect(metadata.persistent).toBe(false)
  })

  it('drops exactly the scope tags inside that scope tenant context', async () => {
    const { ctx, deleteByTags, observedTenants } = createContext()

    await handler({ id: 'todo-1', tenantId: TENANT_A, organizationId: ORG_A1 }, ctx)

    expect(deleteByTags).toHaveBeenCalledTimes(1)
    expect(deleteByTags).toHaveBeenCalledWith(
      buildTodoSummaryCacheTags({ tenantId: TENANT_A, organizationId: ORG_A1 }),
    )
    expect(observedTenants).toEqual([TENANT_A])
  })

  it.each([
    ['no tenant', { id: 'todo-1', tenantId: null, organizationId: ORG_A1 }],
    ['no organization', { id: 'todo-1', tenantId: TENANT_A, organizationId: null }],
    ['empty payload', {}],
  ])('does nothing when the payload has %s', async (_label, payload) => {
    const { ctx, deleteByTags } = createContext()

    await handler(payload, ctx)

    expect(deleteByTags).not.toHaveBeenCalled()
  })

  it('stays silent when no cache is registered', async () => {
    const { ctx } = createContext({ resolveThrows: true })

    await expect(
      handler({ id: 'todo-1', tenantId: TENANT_A, organizationId: ORG_A1 }, ctx),
    ).resolves.toBeUndefined()
  })

  it('swallows a backend failure because the write already committed', async () => {
    const deleteByTags = jest.fn(async () => {
      throw new Error('[internal] cache backend unreachable')
    }) as unknown as DeleteByTagsMock
    const { ctx } = createContext({ deleteByTags })

    await expect(
      handler({ id: 'todo-1', tenantId: TENANT_A, organizationId: ORG_A1 }, ctx),
    ).resolves.toBeUndefined()
    expect(deleteByTags).toHaveBeenCalledTimes(1)
  })
})
