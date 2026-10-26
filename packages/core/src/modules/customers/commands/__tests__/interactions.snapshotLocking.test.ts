const findOneWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/customFieldSnapshots'),
  loadCustomFieldSnapshot: jest.fn(async () => ({})),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/helpers'),
  setCustomFieldsIfAny: jest.fn(async () => undefined),
  emitCrudSideEffects: jest.fn(async () => undefined),
  emitCrudUndoSideEffects: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceRecordGoneIsConflict: jest.fn(),
  enforceCommandOptimisticLockWithGuards: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('../../lib/calendar/eventTypeResolver', () => ({
  resolveScopedCalendarEventTypes: jest.fn(async () => ({
    items: [{
      key: 'meeting',
      selectable: true,
      behavior: {
        schemaVersion: 1,
        baseKind: 'meeting',
        selectable: true,
        order: 0,
        fields: {
          endTime: true,
          allDay: true,
          recurrence: true,
          location: 'location',
          people: 'attendees',
          priority: false,
          resources: true,
        },
        customFieldsetIds: [],
      },
    }],
  })),
  resolveCatalogEventType: (catalog: { items: Array<{ key: string }> }, key: string) =>
    catalog.items.find((item) => item.key === key),
}))

jest.mock('../../lib/interactionProjection', () => ({
  recomputeNextInteraction: jest.fn(async () => ({ nextInteractionId: null })),
}))

jest.mock('../shared', () => ({
  ...jest.requireActual('../shared'),
  requireTimelineParentEntity: jest.fn(async () => ({
    id: '33333333-3333-4333-8333-333333333333',
    kind: 'person',
  })),
  requireDealInScope: jest.fn(async () => undefined),
  emitQueryIndexUpsertEvents: jest.fn(async () => undefined),
  resolveParentResourceKind: jest.fn(() => 'customers.person'),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import { CommandBus } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CustomerInteraction } from '../../data/entities'
import '../interactions'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const ENTITY_ID = '33333333-3333-4333-8333-333333333333'
const INTERACTION_ID = '44444444-4444-4444-8444-444444444444'

type Deferred = {
  promise: Promise<void>
  resolve: () => void
}

function deferred(): Deferred {
  let resolve = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

type TestEntityManager = EntityManager & {
  commandIndex: number
  operationReads: number
  workingInteraction?: ReturnType<typeof interactionState>
  releaseLock?: () => void
}

type LoggedAction = {
  id: string
  commandId: string
  commandPayload: unknown
  snapshotBefore: unknown
  snapshotAfter: unknown
  undoToken: string
}

function interactionState() {
  return {
    id: INTERACTION_ID,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    entity: { id: ENTITY_ID, kind: 'person' },
    dealId: null,
    interactionType: 'meeting',
    title: 'A',
    body: null,
    status: 'planned',
    scheduledAt: new Date('2026-10-01T09:00:00.000Z'),
    occurredAt: null,
    priority: null,
    authorUserId: null,
    ownerUserId: null,
    appearanceIcon: null,
    appearanceColor: null,
    source: null,
    durationMinutes: 30,
    timezone: 'UTC',
    location: null,
    allDay: false,
    recurrenceRule: null,
    recurrenceEnd: null,
    participants: null,
    reminderMinutes: null,
    visibility: null,
    linkedEntities: null,
    guestPermissions: null,
    updatedAt: new Date('2026-10-01T08:00:00.000Z'),
    deletedAt: null,
  }
}

describe('customers.interactions.update locked snapshots', () => {
  it('captures B for the second concurrent update and undo restores B instead of A', async () => {
    const interaction = interactionState()
    const firstAtFlush = deferred()
    const allowFirstCommit = deferred()
    const secondWaitingForLock = deferred()
    const secondSnapshotCaptured = deferred()
    const secondMutationBlocked = deferred()
    const allowSecondMutation = deferred()
    const lockWaiters: Array<() => void> = []
    let lockHeld = false

    const acquireLock = async (em: TestEntityManager) => {
      if (lockHeld) {
        secondWaitingForLock.resolve()
        await new Promise<void>((resolve) => lockWaiters.push(resolve))
      }
      lockHeld = true
      em.releaseLock = () => {
        lockHeld = false
        lockWaiters.shift()?.()
      }
    }

    const makeEm = (commandIndex: number): TestEntityManager => {
      const em = {
        commandIndex,
        operationReads: 0,
        fork: () => em,
        isInTransaction: () => false,
        begin: jest.fn(async () => undefined),
        commit: jest.fn(async () => {
          if (em.workingInteraction) Object.assign(interaction, em.workingInteraction)
          em.releaseLock?.()
          em.releaseLock = undefined
        }),
        rollback: jest.fn(async () => {
          em.releaseLock?.()
          em.releaseLock = undefined
        }),
        flush: jest.fn(async () => {
          if (commandIndex === 1) {
            firstAtFlush.resolve()
            await allowFirstCommit.promise
          }
        }),
        persist: jest.fn(),
        create: jest.fn((_entity: unknown, values: Record<string, unknown>) => values),
      }
      return em as unknown as TestEntityManager
    }

    findOneWithDecryptionMock.mockImplementation(
      async (em: TestEntityManager, entity: unknown, _where: unknown, options?: { populate?: string[] }) => {
        if (entity !== CustomerInteraction) return null
        if (options?.populate) {
          if (em.commandIndex === 2) secondSnapshotCaptured.resolve()
          return interaction
        }
        em.operationReads += 1
        if (em.commandIndex === 2 && em.operationReads === 1) {
          secondMutationBlocked.resolve()
          await allowSecondMutation.promise
        }
        em.workingInteraction ??= {
          ...interaction,
          entity: { ...interaction.entity },
        }
        return em.workingInteraction
      },
    )

    const logs: LoggedAction[] = []
    const guardInputs: unknown[] = []
    const actionLogService = {
      log: jest.fn(async (input: Record<string, unknown>) => {
        const log = {
          ...input,
          id: `log-${logs.length + 1}`,
          commandId: String(input.commandId),
          commandPayload: input.commandPayload,
          snapshotBefore: input.snapshotBefore,
          snapshotAfter: input.snapshotAfter,
          undoToken: String(input.undoToken),
        } as LoggedAction
        logs.push(log)
        return log
      }),
    }
    const dataEngine = { flushOrmEntityChanges: jest.fn(async () => undefined) }

    const makeContext = (commandIndex: number): CommandRuntimeContext => {
      const em = makeEm(commandIndex)
      const container = {
        resolve: (token: string) => {
          if (token === 'em') return em
          if (token === 'actionLogService') return actionLogService
          if (token === 'dataEngine') return dataEngine
          if (token === 'eventBus') return { emitEvent: jest.fn(async () => undefined) }
          if (token === 'organizationHierarchyService') return { resolveAncestorIds: async () => [] }
          throw new Error(`Unexpected dependency: ${token}`)
        },
      }
      return {
        container,
        auth: { sub: 'actor', tenantId: TENANT_ID, orgId: ORGANIZATION_ID },
        organizationScope: null,
        selectedOrganizationId: ORGANIZATION_ID,
        organizationIds: [ORGANIZATION_ID],
        beforeTransactionalWrite: async (transactionalEm, input) => {
          guardInputs.push(input)
          await acquireLock(transactionalEm as TestEntityManager)
        },
      } as unknown as CommandRuntimeContext
    }

    const bus = new CommandBus()
    const first = bus.execute('customers.interactions.update', {
      input: { id: INTERACTION_ID, title: 'B' },
      ctx: makeContext(1),
      skipCacheInvalidation: true,
    })
    await firstAtFlush.promise

    const second = bus.execute('customers.interactions.update', {
      input: { id: INTERACTION_ID, title: 'C' },
      ctx: makeContext(2),
      skipCacheInvalidation: true,
    })
    await secondWaitingForLock.promise
    allowFirstCommit.resolve()
    await secondSnapshotCaptured.promise
    await secondMutationBlocked.promise
    await first
    allowSecondMutation.resolve()
    await second

    expect(logs).toHaveLength(2)
    expect(logs[0].snapshotBefore).toMatchObject({ interaction: { title: 'A' } })
    expect(logs[0].snapshotAfter).toMatchObject({ interaction: { title: 'B' } })
    expect(logs[1].snapshotBefore).toMatchObject({ interaction: { title: 'B' } })
    expect(logs[1].snapshotAfter).toMatchObject({ interaction: { title: 'C' } })
    expect(guardInputs).toEqual([
      { id: INTERACTION_ID, title: 'B' },
      { id: INTERACTION_ID, title: 'C' },
    ])
    expect(interaction.title).toBe('C')

    const update = commandRegistry.get('customers.interactions.update') as CommandHandler
    await update.undo?.({ input: {}, ctx: makeContext(3), logEntry: logs[1] })

    expect(interaction.title).toBe('B')
  })
})
