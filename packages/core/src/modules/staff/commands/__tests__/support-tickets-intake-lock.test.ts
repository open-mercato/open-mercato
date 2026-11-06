/** @jest-environment node */
import type { AwilixContainer } from 'awilix'
import { LockMode } from '@mikro-orm/core'

const mockTransactionLog: string[] = []

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (
    em: { flush: () => Promise<void> },
    phases: (() => unknown)[],
    options?: { transaction?: boolean },
  ) => {
    if (options?.transaction) mockTransactionLog.push('begin')
    try {
      for (const phase of phases) {
        await phase()
        await em.flush()
      }
    } catch (err) {
      if (options?.transaction) mockTransactionLog.push('rollback')
      throw err
    }
    if (options?.transaction) mockTransactionLog.push('commit')
  },
}))

jest.mock('../../lib/support/dictionaries', () => ({
  findSupportTicketCategory: jest.fn(async () => ({ value: 'billing', label: 'Billing' })),
}))

jest.mock('../../lib/support/routing', () => ({
  resolveSupportRoute: jest.fn(async () => ({ timeProjectId: '55555555-5555-4555-8555-555555555555', via: 'fallback' })),
}))

jest.mock('../../lib/time-tracking/projectAssignment', () => ({
  resolveAssignmentGraceDaysFromContainer: jest.fn(async () => 0),
  resolveUsableDefaultAssignee: jest.fn(async () => null),
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333'
const CUSTOMER_USER_ID = '44444444-4444-4444-8444-444444444444'

type Command = { execute: (input: unknown, ctx: unknown) => Promise<unknown> }

async function loadIntakeCommand(): Promise<Command> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../support-tickets')
  return commandRegistry.get('staff.support_tickets.create_from_portal') as unknown as Command
}

describe('staff.support_tickets.create_from_portal project lock', () => {
  beforeEach(() => {
    mockTransactionLog.length = 0
  })

  it('takes a shared lock on the routed project inside the transaction and refuses once a concurrent undo removed it', async () => {
    const persist = jest.fn()
    const em: Record<string, unknown> = {
      flush: jest.fn(async () => undefined),
      persist,
      create: jest.fn(),
      findOne: jest.fn(async (cls: { name: string }, _where: unknown, options?: { lockMode?: unknown }) => {
        mockTransactionLog.push(options?.lockMode !== undefined ? `lock:${cls.name}:${String(options.lockMode)}` : `findOne:${cls.name}`)
        return null
      }),
    }
    em.fork = () => em
    const ctx = {
      auth: { sub: CUSTOMER_USER_ID, tenantId: TENANT_ID, orgId: ORG_ID },
      selectedOrganizationId: ORG_ID,
      container: {
        resolve: (name: string) => {
          if (name === 'em') return em
          throw new Error(`[internal] unexpected resolve ${name}`)
        },
      } as unknown as AwilixContainer,
    }
    const command = await loadIntakeCommand()

    const error = (await command
      .execute(
        {
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          customerId: CUSTOMER_ID,
          customerUserId: CUSTOMER_USER_ID,
          categoryValue: 'billing',
          subject: 'Invoice question',
          description: 'Where is my invoice?',
        },
        ctx,
      )
      .then(() => null, (err: unknown) => err)) as { status?: number; body?: { code?: string } } | null

    expect(mockTransactionLog).toEqual([
      'begin',
      `lock:StaffTimeProject:${String(LockMode.PESSIMISTIC_READ)}`,
      'rollback',
    ])
    expect(error?.status).toBe(422)
    expect(error?.body?.code).toBe('support_category_unavailable')
    expect(persist).not.toHaveBeenCalled()
  })
})
