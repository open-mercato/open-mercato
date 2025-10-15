jest.mock('@open-mercato/core/generated/entities.ids.generated', () => ({
  E: { example: { todo: 'example:todo' } },
}), { virtual: true })
jest.mock('@open-mercato/example/datamodel/entities', () => ({
  E: { example: { todo: 'example:todo' } },
}), { virtual: true })
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import '@open-mercato/example/modules/example/commands/todos'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { Todo } from '@open-mercato/example/modules/example/data/entities'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

type SerializedTodo = {
  id: string
  title: string
  is_done: boolean
  tenantId: string | null
  organizationId: string | null
}

function getCommand(id: string): CommandHandler<any, any> {
  const handler = commandRegistry.get(id)
  if (!handler) throw new Error(`Command ${id} not registered`)
  return handler
}

function createCtx(
  overrides: Partial<CommandRuntimeContext> = {}
): { ctx: CommandRuntimeContext; dataEngine: Pick<DataEngine, 'updateOrmEntity' | 'deleteOrmEntity'> } {
  const dataEngine: Pick<DataEngine, 'updateOrmEntity' | 'deleteOrmEntity'> = {
    updateOrmEntity: jest.fn(async ({ apply }) => {
      const entity = {
        id: 'todo-1',
        title: 'After title',
        isDone: true,
        tenantId: 'tenant-1',
        organizationId: 'org-current',
        deletedAt: null,
      } as unknown as Todo
      await apply(entity)
      return entity
    }),
    deleteOrmEntity: jest.fn(async () => null),
  }

  const container = {
    resolve: (token: string) => {
      if (token === 'dataEngine') return dataEngine
      throw new Error(`Unexpected dependency: ${token}`)
    },
  }

  const ctx: CommandRuntimeContext = {
    container: container as any,
    auth: { tenantId: 'tenant-1', orgId: 'org-current', sub: 'user-1' } as any,
    organizationScope: null,
    selectedOrganizationId: 'org-current',
    organizationIds: ['org-current', 'org-from-log'],
    request: undefined as any,
    ...overrides,
  }

  return { ctx, dataEngine }
}

describe('example todos undo', () => {
  const baseSnapshot: SerializedTodo = {
    id: 'todo-1',
    title: 'Before title',
    is_done: false,
    tenantId: 'tenant-1',
    organizationId: 'org-from-log',
  }

  it('uses snapshot organization scope when undoing update', async () => {
    const { ctx, dataEngine } = createCtx()
    const handler = getCommand('example.todos.update')
    const logEntry = { snapshotBefore: baseSnapshot }

    await handler.undo!({ logEntry, ctx, input: {} })

    expect(dataEngine.updateOrmEntity).toHaveBeenCalledTimes(1)
    const { where } = (dataEngine.updateOrmEntity as jest.Mock).mock.calls[0][0]
    expect(where).toEqual(
      expect.objectContaining({
        id: baseSnapshot.id,
        tenantId: baseSnapshot.tenantId,
        organizationId: baseSnapshot.organizationId,
      })
    )
  })

  it('rejects undo when snapshot organization is not allowed', async () => {
    const { ctx, dataEngine } = createCtx({ organizationIds: ['org-current'] })
    const handler = getCommand('example.todos.update')
    const logEntry = { snapshotBefore: baseSnapshot }

    await expect(handler.undo!({ logEntry, ctx, input: {} })).rejects.toBeInstanceOf(CrudHttpError)
    expect(dataEngine.updateOrmEntity).not.toHaveBeenCalled()
  })
})
