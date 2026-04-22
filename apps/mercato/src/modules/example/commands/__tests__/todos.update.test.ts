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

import '../todos'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Todo } from '../../data/entities'

function getCommand(id: string): CommandHandler<Record<string, unknown>, Todo> {
  const handler = commandRegistry.get(id)
  if (!handler) throw new Error(`Command ${id} not registered`)
  return handler as CommandHandler<Record<string, unknown>, Todo>
}

function createCtx() {
  const updatedTodo = {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Updated title',
    isDone: true,
    tenantId: '33333333-3333-4333-8333-333333333333',
    organizationId: '22222222-2222-4222-8222-222222222222',
    deletedAt: null,
    createdAt: new Date('2026-04-02T09:00:00.000Z'),
    updatedAt: new Date('2026-04-02T10:00:00.000Z'),
  } as Todo

  const nativeUpdate = jest.fn(async () => 1)
  const findOne = jest.fn(async () => updatedTodo)
  const isolatedEm = {
    nativeUpdate,
    findOne,
  } as unknown as EntityManager
  const em = {
    fork: jest.fn(() => isolatedEm),
  } as unknown as EntityManager

  const setCustomFields = jest.fn(async (_opts: Parameters<DataEngine['setCustomFields']>[0]) => undefined)
  const markOrmEntityChange = jest.fn((_entry: Parameters<DataEngine['markOrmEntityChange']>[0]) => undefined)
  const dataEngine = {
    setCustomFields,
    markOrmEntityChange,
  } as unknown as Pick<DataEngine, 'setCustomFields' | 'markOrmEntityChange'>

  const container = {
    resolve: (token: string) => {
      if (token === 'em') return em
      if (token === 'dataEngine') return dataEngine
      throw new Error(`Unexpected dependency: ${token}`)
    },
  }

  const ctx: CommandRuntimeContext = {
    container: container as never,
    auth: {
      tenantId: '33333333-3333-4333-8333-333333333333',
      orgId: '22222222-2222-4222-8222-222222222222',
      sub: '44444444-4444-4444-8444-444444444444',
    } as never,
    organizationScope: null,
    selectedOrganizationId: '22222222-2222-4222-8222-222222222222',
    organizationIds: ['22222222-2222-4222-8222-222222222222'],
    request: undefined as never,
  }

  return {
    ctx,
    em,
    nativeUpdate,
    findOne,
    setCustomFields,
    markOrmEntityChange,
  }
}

describe('example todos update', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('updates todos via an isolated entity manager and keeps custom-field side effects', async () => {
    const { ctx, em, nativeUpdate, findOne, setCustomFields, markOrmEntityChange } = createCtx()
    const handler = getCommand('example.todos.update')

    const result = await handler.execute(
      {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Updated title',
        is_done: true,
        cf_priority: 5,
      },
      ctx,
    )

    expect(em.fork).toHaveBeenCalledWith({ clear: true, freshEventManager: true })
    expect(nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: '11111111-1111-4111-8111-111111111111',
        tenantId: '33333333-3333-4333-8333-333333333333',
        organizationId: '22222222-2222-4222-8222-222222222222',
        deletedAt: null,
      }),
      expect.objectContaining({
        title: 'Updated title',
        isDone: true,
        updatedAt: expect.any(Date),
      }),
    )
    expect(findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: '11111111-1111-4111-8111-111111111111',
        tenantId: '33333333-3333-4333-8333-333333333333',
        organizationId: '22222222-2222-4222-8222-222222222222',
        deletedAt: null,
      }),
    )
    expect(setCustomFields).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'example:todo',
        recordId: '11111111-1111-4111-8111-111111111111',
        tenantId: '33333333-3333-4333-8333-333333333333',
        organizationId: '22222222-2222-4222-8222-222222222222',
        values: { priority: 5 },
        notify: false,
      }),
    )
    expect(markOrmEntityChange).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'updated',
        identifiers: expect.objectContaining({
          id: '11111111-1111-4111-8111-111111111111',
          tenantId: '33333333-3333-4333-8333-333333333333',
          organizationId: '22222222-2222-4222-8222-222222222222',
        }),
      }),
    )
    expect(result).toEqual(expect.objectContaining({
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Updated title',
      isDone: true,
    }))
  })

  it('skips the native update when only custom fields change', async () => {
    const { ctx, nativeUpdate, findOne } = createCtx()
    const handler = getCommand('example.todos.update')

    const result = await handler.execute({ id: '11111111-1111-4111-8111-111111111111', cf_priority: 8 }, ctx)

    expect(nativeUpdate).not.toHaveBeenCalled()
    expect(findOne).toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Updated title',
    }))
  })
})
