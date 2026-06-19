import '@open-mercato/core/modules/messages/commands/actions'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { Message, MessageObject, MessageRecipient } from '@open-mercato/core/modules/messages/data/entities'

const TENANT_ID = '55555555-5555-4555-8555-555555555555'
const ORG_ID = '66666666-6666-4666-8666-666666666666'
const USER_ID = '44444444-4444-4444-8444-444444444444'
const MESSAGE_ID = '11111111-1111-4111-8111-111111111111'
const TARGET_COMMAND_ID = 'messages.test.target_command'

type ActionState = {
  actionTaken: string | null
  actionTakenByUserId: string | null
}

function buildMessage(state: ActionState) {
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
    get actionTaken() {
      return state.actionTaken
    },
    set actionTaken(value: string | null) {
      state.actionTaken = value
    },
    actionData: {
      actions: [
        {
          id: 'do-it',
          label: 'Do it',
          commandId: TARGET_COMMAND_ID,
          isTerminal: true,
        },
      ],
    },
  }
}

function buildEmFork(message: ReturnType<typeof buildMessage>, state: ActionState) {
  return {
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === Message) return message
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
    nativeUpdate: jest.fn(async (_entity: unknown, _where: unknown, data: Record<string, unknown>) => {
      // Model the claim-release: resetting action_taken back to null makes the
      // action retriable again.
      if (data && 'actionTaken' in data && data.actionTaken === null) {
        state.actionTaken = null
        state.actionTakenByUserId = null
      }
      return 1
    }),
    flush: jest.fn(async () => {}),
  }
}

function buildCtx(emFork: ReturnType<typeof buildEmFork>, commandBus: unknown) {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return { fork: () => emFork }
        if (name === 'commandBus') return commandBus
        return null
      },
    } as never,
    auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID } as never,
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  }
}

function buildInput() {
  return {
    messageId: MESSAGE_ID,
    actionId: 'do-it',
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

    const state: ActionState = { actionTaken: null, actionTakenByUserId: null }
    const message = buildMessage(state)
    const emFork = buildEmFork(message, state)

    const commandSequence: string[] = []
    const commandBus = {
      execute: jest.fn(async (commandId: string, opts: { input: { actionId?: string; userId?: string } }) => {
        commandSequence.push(commandId)
        if (commandId === 'messages.actions.record_terminal') {
          if (state.actionTaken == null) {
            state.actionTaken = opts.input.actionId ?? 'do-it'
            state.actionTakenByUserId = opts.input.userId ?? USER_ID
            return { result: { ok: true }, logEntry: { id: 'log-terminal' } }
          }
          throw Object.assign(new Error('Action already taken'), { actionTaken: state.actionTaken })
        }
        if (commandId === TARGET_COMMAND_ID) {
          return { result: { done: true }, logEntry: { id: 'log-target' } }
        }
        throw new Error(`Unexpected command ${commandId}`)
      }),
    }

    await command!.execute(buildInput(), buildCtx(emFork, commandBus))

    // The terminal claim must be recorded BEFORE the target command runs, otherwise
    // a concurrent duplicate request can run the target command's side effects too.
    const recordIndex = commandSequence.indexOf('messages.actions.record_terminal')
    const targetIndex = commandSequence.indexOf(TARGET_COMMAND_ID)
    expect(recordIndex).toBeGreaterThanOrEqual(0)
    expect(targetIndex).toBeGreaterThanOrEqual(0)
    expect(recordIndex).toBeLessThan(targetIndex)
  })

  it('runs the target command only once when two requests race the same terminal action', async () => {
    const command = commandRegistry.get('messages.actions.execute')
    expect(command).toBeTruthy()

    const state: ActionState = { actionTaken: null, actionTakenByUserId: null }
    const message = buildMessage(state)
    const emFork = buildEmFork(message, state)

    let targetRuns = 0
    const targetGate = deferred<void>()
    const commandBus = {
      execute: jest.fn(async (commandId: string, opts: { input: { actionId?: string; userId?: string } }) => {
        if (commandId === 'messages.actions.record_terminal') {
          // Atomic claim: only the first request may reserve the terminal action.
          if (state.actionTaken == null) {
            state.actionTaken = opts.input.actionId ?? 'do-it'
            state.actionTakenByUserId = opts.input.userId ?? USER_ID
            return { result: { ok: true }, logEntry: { id: 'log-terminal' } }
          }
          throw Object.assign(new Error('Action already taken'), { actionTaken: state.actionTaken })
        }
        if (commandId === TARGET_COMMAND_ID) {
          targetRuns += 1
          await targetGate.promise
          return { result: { done: true }, logEntry: { id: 'log-target' } }
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
      expect(firstResult.value).toMatchObject({ ok: true, actionId: 'do-it' })
    }
    expect(secondResult.status).toBe('rejected')
    if (secondResult.status === 'rejected') {
      expect((secondResult.reason as Error).message).toBe('Action already taken')
    }
  })
})
