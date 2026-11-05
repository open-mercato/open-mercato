/**
 * `example.todos.update` gained an optional `expected_updated_at` input so the
 * bulk-complete worker can carry each record's own version into a queued write.
 *
 * The additive claim is only worth making if it is proven, so this pins both
 * halves: a caller that omits the field is completely unaffected, and a caller
 * that supplies a stale one is refused with the same structured 409 the CRUD path
 * returns. `prepare` is where the check runs, because the command bus always
 * awaits it before `execute`.
 */
jest.mock('@open-mercato/core/generated/entities.ids.generated', () => ({
  E: { example: { todo: 'example:todo' } },
}), { virtual: true })
jest.mock('@/.mercato/generated/entities.ids.generated', () => ({
  E: { example: { todo: 'example:todo' } },
}), { virtual: true })
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import { buildTodoUpdatePatch } from '../todos'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Todo } from '../../data/entities'

const TODO_ID = '11111111-1111-4111-8111-111111111111'
const TENANT = '33333333-3333-4333-8333-333333333333'
const ORG = '22222222-2222-4222-8222-222222222222'
const CURRENT_VERSION = new Date('2026-04-02T10:00:00.000Z')
const STALE_VERSION = new Date('2026-04-02T09:00:00.000Z')

function createCtx() {
  const existing = {
    id: TODO_ID,
    title: 'Current title',
    isDone: false,
    notes: null,
    tenantId: TENANT,
    organizationId: ORG,
    deletedAt: null,
    createdAt: new Date('2026-04-01T09:00:00.000Z'),
    updatedAt: CURRENT_VERSION,
  } as Todo

  const findOne = jest.fn(async () => existing)
  const find = jest.fn(async () => [])
  const em = {
    findOne,
    find,
    fork: jest.fn(() => ({ findOne, find } as unknown as EntityManager)),
    getKysely: undefined,
  } as unknown as EntityManager

  const ctx: CommandRuntimeContext = {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        throw new Error(`[internal] unexpected token ${token}`)
      },
    } as never,
    auth: { tenantId: TENANT, orgId: ORG, sub: '44444444-4444-4444-8444-444444444444' } as never,
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
    request: undefined as never,
  }

  return { ctx, findOne }
}

function getUpdateCommand(): CommandHandler<Record<string, unknown>, Todo> {
  const handler = commandRegistry.get('example.todos.update')
  if (!handler) throw new Error('[internal] example.todos.update not registered')
  return handler as CommandHandler<Record<string, unknown>, Todo>
}

describe('example.todos.update expected_updated_at', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('is a no-op for every existing caller that omits it', async () => {
    const { ctx } = createCtx()

    const snapshots = await getUpdateCommand().prepare!({ id: TODO_ID, is_done: true }, ctx)

    expect(snapshots).toEqual({
      before: expect.objectContaining({ id: TODO_ID, is_done: false }),
    })
  })

  it('accepts the current version', async () => {
    const { ctx } = createCtx()

    await expect(getUpdateCommand().prepare!(
      { id: TODO_ID, is_done: true, expected_updated_at: CURRENT_VERSION.toISOString() },
      ctx,
    )).resolves.toEqual({ before: expect.objectContaining({ id: TODO_ID }) })
  })

  it('refuses a stale version with the standard 409 conflict body', async () => {
    const { ctx } = createCtx()

    let thrown: unknown
    try {
      await getUpdateCommand().prepare!(
        { id: TODO_ID, is_done: true, expected_updated_at: STALE_VERSION.toISOString() },
        ctx,
      )
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeDefined()
    expect(isCrudHttpError(thrown)).toBe(true)
    const conflict = thrown as { status: number; body: Record<string, unknown> }
    expect(conflict.status).toBe(409)
    expect(conflict.body).toMatchObject({
      code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      currentUpdatedAt: CURRENT_VERSION.toISOString(),
      expectedUpdatedAt: STALE_VERSION.toISOString(),
    })
  })

  it('keeps the version out of the persisted column patch', async () => {
    // Asserts the REAL patch handed to `nativeUpdate`, via the exported builder.
    // The earlier version inspected `prepare`'s undo snapshot instead — an object built
    // entirely from the DB entity, so it structurally could not carry ANY input key. A
    // mutation that genuinely leaked the value into the persisted patch left it green.
    const patch = await buildTodoUpdatePatch(
      { isDone: true, ...({ expected_updated_at: CURRENT_VERSION.toISOString() } as Record<string, unknown>) },
      { tenantId: TENANT, organizationId: ORG },
      null,
    )

    expect(patch).not.toHaveProperty('expected_updated_at')
    // …and still carries what it should, so "empty patch" cannot pass this vacuously.
    expect(patch).toMatchObject({ isDone: true })
  })
})
