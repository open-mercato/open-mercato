/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands/types'
import type { CheckoutLink } from '../../data/entities'
import { createLinkFromSnapshot, restoreLinkFromSnapshot, type CheckoutLinkSnapshot } from '../shared'

const ORG_ID = '123e4567-e89b-12d3-a456-426614174000'
const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const LINK_ID = '123e4567-e89b-12d3-a456-426614174010'

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('../../lib/gatewayProviderAvailability', () => ({
  ensureGatewayProviderConfigured: jest.fn(async () => undefined),
  getGatewayProviderConfigurationMessageKey: jest.fn(() => null),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  setCustomFieldsIfAny: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  loadCustomFieldSnapshot: jest.fn(async () => ({})),
  buildCustomFieldResetMap: jest.fn(() => ({})),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

jest.mock('../../events', () => ({
  emitCheckoutEvent: jest.fn(async () => undefined),
}))

import '../links'

type LiveLink = Record<string, unknown> & {
  completionCount: number
  activeReservationCount: number
  isLocked: boolean
}

function liveLink(overrides: Partial<LiveLink> = {}): LiveLink {
  return {
    id: LINK_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    name: 'Pay link',
    title: 'Edited title',
    slug: 'pay-link',
    templateId: null,
    status: 'active',
    pricingMode: 'fixed',
    fixedPriceAmount: '25.00',
    fixedPriceCurrencyCode: 'USD',
    gatewayProviderKey: 'mock',
    gatewaySettings: {},
    maxCompletions: 2,
    completionCount: 1,
    activeReservationCount: 0,
    isLocked: false,
    deletedAt: null,
    ...overrides,
  }
}

function snapshot(overrides: Partial<CheckoutLinkSnapshot> = {}): CheckoutLinkSnapshot {
  return {
    id: LINK_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    name: 'Pay link',
    title: 'Original title',
    slug: 'pay-link',
    templateId: null,
    status: 'active',
    pricingMode: 'fixed',
    fixedPriceAmount: 25,
    fixedPriceCurrencyCode: 'USD',
    gatewayProviderKey: 'mock',
    gatewaySettings: {},
    maxCompletions: 2,
    completionCount: 0,
    activeReservationCount: 0,
    isLocked: false,
    passwordHash: null,
    ...overrides,
  } as CheckoutLinkSnapshot
}

function makeEm(link: LiveLink | null) {
  return {
    findOne: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => (where.slug ? null : link)),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
}

function makeContext(em: unknown): CommandRuntimeContext {
  return {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return {}
        if (token === 'paymentGatewayDescriptorService') return {}
        if (token === 'commandOptimisticLockGuardService') throw new Error('not registered')
        return null
      },
    } as unknown as CommandRuntimeContext['container'],
    auth: { sub: 'user-1', orgId: ORG_ID, tenantId: TENANT_ID } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  }
}

function logEntry(undo: Record<string, unknown>): CommandUndoLogEntry {
  return { commandPayload: { undo } } as CommandUndoLogEntry
}

async function runUndo(commandId: string, entry: CommandUndoLogEntry, em: unknown) {
  const handler = commandRegistry.get(commandId)
  if (!handler?.undo) throw new Error(`[internal] ${commandId} has no undo handler`)
  return handler.undo({ input: {}, ctx: makeContext(em), logEntry: entry } as never)
}

async function runRedo(commandId: string, entry: CommandUndoLogEntry, em: unknown) {
  const handler = commandRegistry.get(commandId)
  if (!handler?.redo) throw new Error(`[internal] ${commandId} has no redo handler`)
  return handler.redo({ input: {}, ctx: makeContext(em), logEntry: entry } as never)
}

describe('pay-link runtime counters across undo/redo', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('restores configuration from a snapshot but keeps the live counters', () => {
    const target = liveLink({ completionCount: 2, activeReservationCount: 1, isLocked: true })

    restoreLinkFromSnapshot(target as unknown as CheckoutLink, snapshot())

    expect(target.title).toBe('Original title')
    expect(target).toMatchObject({ completionCount: 2, activeReservationCount: 1, isLocked: true })
  })

  it('still seeds the counters when the snapshot becomes a brand-new row', () => {
    expect(createLinkFromSnapshot(snapshot({ completionCount: 1, activeReservationCount: 0, isLocked: false }))).toMatchObject({
      id: LINK_ID,
      completionCount: 1,
      activeReservationCount: 0,
      isLocked: false,
    })
  })

  it('undoing an edit keeps payments completed after the edit', async () => {
    const link = liveLink({ completionCount: 2 })
    const em = makeEm(link)

    await runUndo('checkout.link.update', logEntry({ before: snapshot(), after: snapshot({ title: 'Edited title' }) }), em)

    expect(em.flush).toHaveBeenCalled()
    expect(link.title).toBe('Original title')
    expect(link).toMatchObject({ completionCount: 2, activeReservationCount: 0, isLocked: false })
  })

  it('refuses to undo an edit while the link has payments in flight, like the edit itself', async () => {
    const link = liveLink({ completionCount: 0, activeReservationCount: 1, isLocked: true })
    const em = makeEm(link)

    await expect(
      runUndo('checkout.link.update', logEntry({ before: snapshot(), after: snapshot({ title: 'Edited title' }) }), em),
    ).rejects.toMatchObject({ status: 422 })
    expect(em.flush).not.toHaveBeenCalled()
    expect(link).toMatchObject({ title: 'Edited title', activeReservationCount: 1, isLocked: true })
  })

  it('redoing a create keeps the counters of the soft-deleted row it revives', async () => {
    const link = liveLink({ completionCount: 1, deletedAt: new Date() })
    mockFindOneWithDecryption.mockResolvedValueOnce(link)
    const em = makeEm(null)

    await runRedo('checkout.link.create', logEntry({ after: snapshot() }), em)

    expect(link.deletedAt).toBeNull()
    expect(link).toMatchObject({ completionCount: 1, activeReservationCount: 0, isLocked: false })
  })

  it('undoing a delete keeps the counters of the restored row', async () => {
    const link = liveLink({ completionCount: 2, deletedAt: new Date() })
    const em = makeEm(link)

    await runUndo('checkout.link.delete', logEntry({ before: snapshot({ completionCount: 1, deletedAt: null } as Partial<CheckoutLinkSnapshot>) }), em)

    expect(link.deletedAt).toBeNull()
    expect(link).toMatchObject({ completionCount: 2, activeReservationCount: 0, isLocked: false })
  })

  it('redoing an edit re-runs it and cannot write the runtime counters', async () => {
    const link = liveLink({ completionCount: 2 })
    mockFindOneWithDecryption.mockResolvedValueOnce(link)
    const em = makeEm(link)
    const handler = commandRegistry.get('checkout.link.update')
    if (!handler) throw new Error('[internal] checkout.link.update not registered')

    await handler.execute(
      { id: LINK_ID, title: 'Edited again', completionCount: 0, activeReservationCount: 0, isLocked: false },
      makeContext(em),
    )

    expect(em.flush).toHaveBeenCalled()
    expect(link.title).toBe('Edited again')
    expect(link).toMatchObject({ completionCount: 2, activeReservationCount: 0, isLocked: false })
  })
})
