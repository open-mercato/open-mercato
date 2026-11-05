/**
 * Phase 2 (record-locks customers): interaction command guard migration.
 *
 * The interaction update/complete/cancel/delete commands are dispatched both by
 * the makeCrudRoute `customers/interactions` route AND by the legacy hand-written
 * `/api/customers/todos` + `/api/customers/activities` routes (which bypass the
 * CRUD mutation-guard decorator). To protect those legacy dispatch paths, the
 * command handlers were migrated from the synchronous `enforceCommandOptimisticLock`
 * to the async DI-aware seam `enforceCommandOptimisticLockWithGuards` (Phase-0
 * runner: OSS floor first, optional enterprise record_locks enrichment, fail-closed).
 *
 * This test asserts the migrated `complete` handler awaits the async seam with the
 * loaded interaction's own `updatedAt` BEFORE mutating, and that a seam 409 aborts
 * the write. (The four handlers share the identical guard call shape.)
 */
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const enforceWithGuardsMock = jest.fn<Promise<void>, [unknown, Record<string, unknown>]>()
const recordGoneMock = jest.fn()

jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceCommandOptimisticLockWithGuards: (container: unknown, input: Record<string, unknown>) =>
    enforceWithGuardsMock(container, input),
  enforceRecordGoneIsConflict: (input: unknown) => recordGoneMock(input),
}))

let loadedInteraction: Record<string, unknown> | null = null

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async () => loadedInteraction,
}))

// Side effects + projection are out of scope here — stub them so the handler
// never reaches a real DataEngine / event bus.
jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn(async () => undefined),
    emitCrudUndoSideEffects: jest.fn(async () => undefined),
  }
})

jest.mock('../lib/interactionProjection', () => ({
  recomputeNextInteraction: jest.fn(async () => ({ entityId: 'entity-1', nextInteractionId: null })),
}))

jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return { ...actual, emitQueryIndexUpsertEvents: jest.fn(async () => undefined) }
})

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
// Importing the module registers every interaction command via `registerCommand`.
import '../commands/interactions'

const completeInteractionCommand = commandRegistry.get('customers.interactions.complete')
if (!completeInteractionCommand) {
  throw new Error('[internal] customers.interactions.complete not registered')
}

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const INTERACTION_ID = '55555555-5555-4555-8555-555555555555'
const UPDATED_AT = new Date('2026-06-01T00:00:00.000Z')

function makeInteraction() {
  return {
    id: INTERACTION_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    entity: 'entity-1',
    status: 'planned',
    interactionType: 'call',
    source: null,
    occurredAt: null as Date | null,
    updatedAt: UPDATED_AT,
  }
}

function makeCtx() {
  // The interaction `complete` handler forks the EM and runs inside
  // `runInTransaction`; provide a fork that lacks begin/commit/rollback so the
  // op runs directly, with a no-op `flush`.
  const fork = { flush: jest.fn(async () => undefined) }
  const em = { fork: () => fork }
  const dataEngine = {}
  const eventBus = { emitEvent: jest.fn(async () => undefined) }
  return {
    container: {
      resolve: (key: string) => {
        if (key === 'em') return em
        if (key === 'dataEngine') return dataEngine
        if (key === 'eventBus') return eventBus
        throw new Error(`unregistered: ${key}`)
      },
    },
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, isSuperAdmin: true, sub: 'user-1' },
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    request: new Request('http://localhost/api/customers/todos', { method: 'PUT' }),
  } as unknown as CommandRuntimeContext
}

beforeEach(() => {
  enforceWithGuardsMock.mockReset()
  enforceWithGuardsMock.mockResolvedValue(undefined)
  recordGoneMock.mockReset()
})

describe('customers.interactions.complete — command guard', () => {
  test('awaits the async seam with the interaction updatedAt before mutating', async () => {
    loadedInteraction = makeInteraction()
    const ctx = makeCtx()

    await completeInteractionCommand.execute({ id: INTERACTION_ID }, ctx)

    expect(enforceWithGuardsMock).toHaveBeenCalledTimes(1)
    const [, input] = enforceWithGuardsMock.mock.calls[0]
    expect(input).toMatchObject({
      resourceKind: 'customers.interaction',
      resourceId: INTERACTION_ID,
      current: UPDATED_AT,
    })
    expect((loadedInteraction as { status: string }).status).toBe('done')
  })

  test('a seam 409 aborts the write (status not flipped)', async () => {
    loadedInteraction = makeInteraction()
    const ctx = makeCtx()
    enforceWithGuardsMock.mockRejectedValueOnce(new CrudHttpError(409, { code: 'record_modified', error: 'conflict' }))

    await expect(completeInteractionCommand.execute({ id: INTERACTION_ID }, ctx)).rejects.toMatchObject({ status: 409 })
    expect((loadedInteraction as { status: string }).status).toBe('planned')
  })

  test('a missing interaction surfaces gone-as-conflict before the 404 (seam not reached)', async () => {
    loadedInteraction = null
    const ctx = makeCtx()

    await expect(completeInteractionCommand.execute({ id: INTERACTION_ID }, ctx)).rejects.toMatchObject({ status: 404 })
    expect(recordGoneMock).toHaveBeenCalledTimes(1)
    expect(enforceWithGuardsMock).not.toHaveBeenCalled()
  })
})
