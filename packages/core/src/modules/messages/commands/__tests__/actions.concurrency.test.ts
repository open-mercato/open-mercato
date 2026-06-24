import '@open-mercato/core/modules/messages/commands/actions'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { Message, MessageObject, MessageRecipient } from '@open-mercato/core/modules/messages/data/entities'

const TENANT_ID = '55555555-5555-4555-8555-555555555555'
const ORG_ID = '66666666-6666-4666-8666-666666666666'
const USER_ID = '44444444-4444-4444-8444-444444444444'
const MESSAGE_ID = '11111111-1111-4111-8111-111111111111'
const ACTION_ID = 'do-it'
const TARGET_COMMAND_ID = 'messages.test.target_command'

type ActionState = {
  actionTaken: string | null
  actionTakenByUserId: string | null
}

function buildMessageView(state: ActionState) {
  return {
    id: MESSAGE_ID,
    type: 'default',
    sourceEntityId: '22222222-2222-4222-8222-222222222222',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    threadId: null,
    parentMessageId: null,
    sentAt: new Date('2026-03-01T12:00:00.000Z'),
    deletedAt: null,
    actionTaken: state.actionTaken,
    actionTakenByUserId: state.actionTakenByUserId,
    actionData: {
      actions: [
        {
          id: ACTION_ID,
          label: 'Do it',
          commandId: TARGET_COMMAND_ID,
          isTerminal: true,
        },
      ],
    },
  }
}

// Stateful EntityManager fork. The `nativeUpdate` mock models the production
// atomic compare-and-set: a claim (`WHERE action_taken IS NULL`) only succeeds
// while the action is un-taken, and a release (`SET action_taken = NULL`) makes
// the action retriable again. Every fork shares the same `state` so concurrent
// requests and sequential retries observe a single source of truth.
function buildEmFork(state: ActionState, onClaim?: () => void) {
  return {
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === Message) return buildMessageView(state)
      if (entity === MessageRecipient) {
        return {
          id: '33333333-3333-4333-8333-333333333333',
          messageId: MESSAGE_ID,
          recipientUserId: USER_ID,
          deletedAt: null,
        }
      }
      return null
    }),
    find: jest.fn(async (entity: unknown) => {
      if (entity === MessageObject) return []
      return []
    }),
    nativeUpdate: jest.fn(
      async (_entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
        const isClaim = where?.actionTaken === null && data?.actionTaken != null
        if (isClaim) {
          if (state.actionTaken == null) {
            state.actionTaken = data.actionTaken as string
            state.actionTakenByUserId = (data.actionTakenByUserId as string) ?? null
            onClaim?.()
            return 1
          }
          return 0
        }
        const isRelease = data && 'actionTaken' in data && data.actionTaken === null
        if (isRelease) {
          state.actionTaken = null
          state.actionTakenByUserId = null
          return 1
        }
        return 0
      },
    ),
    flush: jest.fn(async () => {}),
  }
}

function buildContainer(emFork: ReturnType<typeof buildEmFork>, commandBus: unknown) {
  return {
    resolve: (name: string) => {
      if (name === 'em') return { fork: () => emFork }
      if (name === 'commandBus') return commandBus
      return null
    },
  } as never
}

function buildCtx(emFork: ReturnType<typeof buildEmFork>, commandBus: unknown) {
  return {
    container: buildContainer(emFork, commandBus),
    auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID } as never,
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  }
}

function buildInput() {
  return {
    messageId: MESSAGE_ID,
    actionId: ACTION_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    userId: USER_ID,
  }
}

const flushAsync = () => new Promise<void>((resolve) => setImmediate(resolve))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('messages.actions.execute terminal-action concurrency (#3261)', () => {
  it('claims the terminal action before executing the target command', async () => {
    const command = commandRegistry.get('messages.actions.execute')
    expect(command).toBeTruthy()

    const sequence: string[] = []
    const state: ActionState = { actionTaken: null, actionTakenByUserId: null }
    const emFork = buildEmFork(state, () => sequence.push('claim'))

    const commandBus = {
      execute: jest.fn(async (commandId: string) => {
        if (commandId === TARGET_COMMAND_ID) {
          sequence.push('target')
          return { result: { done: true }, logEntry: { id: 'log-target' } }
        }
        if (commandId === 'messages.actions.record_terminal') {
          return { result: { ok: true }, logEntry: { id: 'log-terminal' } }
        }
        throw new Error(`Unexpected command ${commandId}`)
      }),
    }

    await command!.execute(buildInput(), buildCtx(emFork, commandBus))

    // The terminal action must be reserved (atomic compare-and-set) BEFORE the
    // target command runs, otherwise a concurrent duplicate request could also
    // execute the target command's side effects.
    const claimIndex = sequence.indexOf('claim')
    const targetIndex = sequence.indexOf('target')
    expect(claimIndex).toBeGreaterThanOrEqual(0)
    expect(targetIndex).toBeGreaterThanOrEqual(0)
    expect(claimIndex).toBeLessThan(targetIndex)
  })

  it('releases the claim when the target command throws so the action can be retried', async () => {
    const command = commandRegistry.get('messages.actions.execute')
    expect(command).toBeTruthy()

    const state: ActionState = { actionTaken: null, actionTakenByUserId: null }
    const emFork = buildEmFork(state)

    let targetRuns = 0
    let failNextTarget = true
    const commandBus = {
      execute: jest.fn(async (commandId: string) => {
        if (commandId === TARGET_COMMAND_ID) {
          targetRuns += 1
          if (failNextTarget) {
            failNextTarget = false
            throw new Error('boom')
          }
          return { result: { done: true }, logEntry: { id: 'log-target' } }
        }
        if (commandId === 'messages.actions.record_terminal') {
          return { result: { ok: true }, logEntry: { id: 'log-terminal' } }
        }
        throw new Error(`Unexpected command ${commandId}`)
      }),
    }

    // First attempt: the target command throws, so the reservation must be
    // released and the original error surfaced as the existing 'Action failed'.
    await expect(command!.execute(buildInput(), buildCtx(emFork, commandBus))).rejects.toThrow(
      'Action failed',
    )
    // The failed attempt must not leave the action claimed — otherwise it would
    // be permanently stuck and could never be retried.
    expect(state.actionTaken).toBeNull()
    expect(targetRuns).toBe(1)

    // Retry: a second request now succeeds because the claim was released, while
    // idempotency still holds — the target command runs exactly once per success.
    const result = await command!.execute(buildInput(), buildCtx(emFork, commandBus))
    expect(result).toMatchObject({ ok: true, actionId: ACTION_ID })
    expect(state.actionTaken).toBe(ACTION_ID)
    expect(targetRuns).toBe(2)
  })

  it('runs the target command only once when two requests race the same terminal action', async () => {
    const command = commandRegistry.get('messages.actions.execute')
    expect(command).toBeTruthy()

    const state: ActionState = { actionTaken: null, actionTakenByUserId: null }
    const emFork = buildEmFork(state)

    let targetRuns = 0
    const targetGate = deferred<void>()
    const commandBus = {
      execute: jest.fn(async (commandId: string) => {
        if (commandId === TARGET_COMMAND_ID) {
          targetRuns += 1
          await targetGate.promise
          return { result: { done: true }, logEntry: { id: 'log-target' } }
        }
        if (commandId === 'messages.actions.record_terminal') {
          return { result: { ok: true }, logEntry: { id: 'log-terminal' } }
        }
        throw new Error(`Unexpected command ${commandId}`)
      }),
    }

    const reflect = (promise: Promise<unknown>) =>
      promise.then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason) => ({ status: 'rejected' as const, reason }),
      )

    const ctx = buildCtx(emFork, commandBus)
    // Attach settle handlers eagerly so the loser's early rejection is never an
    // unhandled rejection while we hold the target command open.
    const firstSettled = reflect(command!.execute(buildInput(), ctx))
    // Let the winning request claim the action and park inside the target command.
    await flushAsync()

    const secondSettled = reflect(command!.execute(buildInput(), ctx))
    // The losing request must be rejected before it can run the target command.
    await flushAsync()

    expect(targetRuns).toBe(1)

    targetGate.resolve()
    const firstResult = await firstSettled
    const secondResult = await secondSettled

    expect(targetRuns).toBe(1)
    expect(firstResult.status).toBe('fulfilled')
    if (firstResult.status === 'fulfilled') {
      expect(firstResult.value).toMatchObject({ ok: true, actionId: ACTION_ID })
    }
    expect(secondResult.status).toBe('rejected')
    if (secondResult.status === 'rejected') {
      expect((secondResult.reason as Error).message).toBe('Action already taken')
    }
  })
})
