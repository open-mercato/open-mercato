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
import type { Todo } from '../../data/entities'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

type SerializedTodo = {
  id: string
  title: string
  is_done: boolean
  tenantId: string | null
  organizationId: string | null
  custom?: Record<string, unknown>
}

function getCommand(id: string): CommandHandler<any, any> {
  const handler = commandRegistry.get(id)
  if (!handler) throw new Error(`Command ${id} not registered`)
  return handler
}

function createCtx(
  overrides: Partial<CommandRuntimeContext> = {}
): { ctx: CommandRuntimeContext; dataEngine: Pick<DataEngine, 'updateOrmEntity' | 'deleteOrmEntity' | 'setCustomFields' | 'emitOrmEntityEvent' | 'markOrmEntityChange' | 'flushOrmEntityChanges'> } {
  const pending: any[] = []
  const updateOrmEntity = jest.fn(async ({ apply }: Parameters<DataEngine['updateOrmEntity']>[0]) => {
    const entity = {
      id: 'todo-1',
      title: 'After title',
      isDone: true,
      tenantId: 'tenant-1',
      organizationId: 'org-current',
      deletedAt: null,
    } as unknown as Todo
    await (apply as (current: Todo) => Promise<void> | void)(entity)
    return entity
  })
  const deleteOrmEntity = jest.fn(async () => null)
  const setCustomFields = jest.fn(async (_opts: Parameters<DataEngine['setCustomFields']>[0]) => undefined)
  const emitOrmEntityEvent = jest.fn(async (_opts: Parameters<DataEngine['emitOrmEntityEvent']>[0]) => undefined)
  const markOrmEntityChange = jest.fn((entry: Parameters<DataEngine['markOrmEntityChange']>[0]) => {
    if (!entry || !entry.entity) return
    pending.push(entry)
  })
  const flushOrmEntityChanges = jest.fn(async () => {
    while (pending.length > 0) {
      const next = pending.shift()
      if (next) await emitOrmEntityEvent(next as Parameters<DataEngine['emitOrmEntityEvent']>[0])
    }
  })
  const dataEngine: Pick<DataEngine, 'updateOrmEntity' | 'deleteOrmEntity' | 'setCustomFields' | 'emitOrmEntityEvent' | 'markOrmEntityChange' | 'flushOrmEntityChanges'> = {
    updateOrmEntity: updateOrmEntity as unknown as DataEngine['updateOrmEntity'],
    deleteOrmEntity: deleteOrmEntity as unknown as DataEngine['deleteOrmEntity'],
    setCustomFields: setCustomFields as unknown as DataEngine['setCustomFields'],
    emitOrmEntityEvent: emitOrmEntityEvent as unknown as DataEngine['emitOrmEntityEvent'],
    markOrmEntityChange: markOrmEntityChange as unknown as DataEngine['markOrmEntityChange'],
    flushOrmEntityChanges: flushOrmEntityChanges as unknown as DataEngine['flushOrmEntityChanges'],
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

  it('restores custom fields diff when undoing update', async () => {
    const { ctx, dataEngine } = createCtx()
    const handler = getCommand('example.todos.update')
    const logEntry = {
      snapshotBefore: { ...baseSnapshot, custom: { priority: 3 } },
      snapshotAfter: { ...baseSnapshot, custom: { priority: 5, severity: 'critical' } },
    }

    await handler.undo!({ logEntry, ctx, input: {} })

    expect(dataEngine.setCustomFields).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'example:todo',
        recordId: baseSnapshot.id,
        values: { priority: 3, severity: null },
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
