/**
 * `makeCrudRoute`'s `indexer:` declaration is handed to the DataEngine for the duration of a
 * `CommandBus.execute()` (#5741), so a handler that marks `events:` only still writes the
 * projection the route promised. `CommandBus.undo()` runs outside any route, so no declaration
 * is active there — an undo handler that marks `events:` only would restore the tag row in
 * Postgres and leave it missing from `query_index` until the next full rebuild, which is worse
 * than the pre-fix behaviour where the delete never removed the row in the first place.
 *
 * These tests pin the two `customers.tags` undo handlers against that: each must pass the
 * module's own indexer, carrying the same `entityType` the route declares.
 */
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { E } from '#generated/entities.ids.generated'

const emitCrudUndoSideEffectsMock = jest.fn(async () => undefined)

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn(async () => undefined),
    emitCrudUndoSideEffects: (...args: unknown[]) => (emitCrudUndoSideEffectsMock as any)(...args),
  }
})

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
// Importing the module registers every tag command via `registerCommand`.
import '../commands/tags'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const TAG_ID = '33333333-3333-4333-8333-333333333333'

const snapshot = {
  id: TAG_ID,
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  slug: 'vip',
  label: 'VIP',
  color: null,
  description: null,
}

function makeCtx(existingTag: Record<string, unknown> | null) {
  const fork = {
    findOne: jest.fn(async () => existingTag),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    // The delete-undo restores through `withAtomicFlush(..., { transaction: true })`.
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    getUnitOfWork: () => ({ getChangeSets: () => [] }),
  }
  return {
    container: {
      resolve: (key: string) => {
        if (key === 'em') return { fork: () => fork }
        if (key === 'dataEngine') return {}
        throw new Error(`unregistered: ${key}`)
      },
    },
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, isSuperAdmin: true, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  } as unknown as CommandRuntimeContext
}

const logEntry = { id: 'log-1', commandPayload: { undo: { before: snapshot } } }

function undoHandlerFor(commandId: string) {
  const command = commandRegistry.get(commandId)
  if (!command?.undo) throw new Error(`[internal] ${commandId} has no undo handler`)
  return command.undo
}

beforeEach(() => {
  emitCrudUndoSideEffectsMock.mockClear()
})

describe('customers.tags undo handlers maintain the query index', () => {
  test.each([
    ['customers.tags.update', 'updated'],
    ['customers.tags.delete', 'created'],
  ])('%s marks its restore with the route entityType', async (commandId, action) => {
    const undo = undoHandlerFor(commandId)

    await undo({ input: {}, ctx: makeCtx({ ...snapshot }), logEntry } as any)

    expect(emitCrudUndoSideEffectsMock).toHaveBeenCalledTimes(1)
    expect(emitCrudUndoSideEffectsMock.mock.calls[0][0]).toMatchObject({
      action,
      indexer: { entityType: E.customers.customer_tag },
      identifiers: { id: TAG_ID, organizationId: ORG_ID, tenantId: TENANT_ID },
    })
  })
})
