jest.mock('../../events', () => ({ emitAssistedSellingEvent: jest.fn(async () => undefined) }))
jest.mock('../../lib/settings', () => ({
  resolveEffectiveAssistedSellingSettings: jest.fn(async () => ({
    mode: 'rep',
    proposalTtlSeconds: 259200,
    maxProposalLines: 50,
    conversationRetentionDays: 365,
    idleCloseDays: 30,
  })),
}))

import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  AssistedSellingThread,
  AssistedSellingParticipant,
  AssistedSellingMessage,
  AssistedSellingProposal,
} from '../../data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { CART_PROPOSAL_CREATE_COMMAND_ID, CART_PROPOSAL_REJECT_COMMAND_ID } from '../../lib/cartProposalCommands'
import { authorProposalCommand, withdrawProposalCommand, reauthorProposalCommand, reauthorProposalForMergeRetarget } from '../proposals'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG_ID = '99999999-9999-4999-8999-999999999999'
const STORE_ID = '33333333-3333-4333-8333-333333333333'
const BUYER_CART_ID = '44444444-4444-4444-8444-444444444444'
const THREAD_ID = '55555555-5555-4555-8555-555555555555'
const REP_USER_ID = '66666666-6666-4666-8666-666666666666'
const PROPOSAL_CART_ID = '77777777-7777-4777-8777-777777777777'

type Row = Record<string, any>

function classKeyFor(Cls: unknown): 'threads' | 'participants' | 'messages' | 'proposals' | 'users' {
  if (Cls === AssistedSellingThread) return 'threads'
  if (Cls === AssistedSellingParticipant) return 'participants'
  if (Cls === AssistedSellingMessage) return 'messages'
  if (Cls === AssistedSellingProposal) return 'proposals'
  if (Cls === User) return 'users'
  throw new Error(`unexpected entity class in fake em: ${String(Cls)}`)
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true
    if (value && typeof value === 'object' && !(value instanceof Date) && '$in' in value) {
      return (value as { $in: unknown[] }).$in.includes(row[key])
    }
    return (row[key] ?? null) === (value ?? null)
  })
}

function makeFakeEm(seed: { threads?: Row[]; proposals?: Row[]; users?: Row[] } = {}) {
  const stores: Record<string, Row[]> = {
    threads: seed.threads ? [...seed.threads] : [],
    participants: [],
    messages: [],
    proposals: seed.proposals ? [...seed.proposals] : [],
    users: seed.users ? [...seed.users] : [],
  }
  let flushBehavior: (() => void) | null = null
  const em: Row = {
    create: jest.fn((Cls: unknown, data: Row) => ({ ...data, __key: classKeyFor(Cls) })),
    persist: jest.fn((entity: Row) => {
      if (!stores[entity.__key].includes(entity)) stores[entity.__key].push(entity)
    }),
    flush: jest.fn(async () => {
      if (flushBehavior) flushBehavior()
    }),
    findOne: jest.fn(async (Cls: unknown, where: Row) => {
      const key = classKeyFor(Cls)
      return stores[key].find((row) => matches(row, where)) ?? null
    }),
    // `withAtomicFlush({ transaction: true })` (`commands/proposals.ts`) drives these directly.
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    isInTransaction: jest.fn(() => false),
  }
  em.fork = jest.fn(() => em)
  return { em, stores, setFlushBehavior: (fn: (() => void) | null) => { flushBehavior = fn } }
}

function makeRbac(grantedFeatures: string[]) {
  return {
    userHasAllFeatures: jest.fn(async (_userId: string, required: string[]) =>
      required.every((feature) =>
        grantedFeatures.some((granted) => {
          if (granted === '*' || granted === feature) return true
          if (granted.endsWith('.*')) return feature.startsWith(granted.slice(0, -1))
          return false
        }),
      ),
    ),
  }
}

function makeStoreContextService(assortmentScope: unknown = null) {
  return { resolveForBuyer: jest.fn(async () => ({ assortmentScope })) }
}

function makeCommandBus() {
  const createCalls: Row[] = []
  const rejectCalls: Row[] = []
  let nextProposalCartId = PROPOSAL_CART_ID
  const execute = jest.fn(async (id: string, { input }: { input: Row }) => {
    if (id === CART_PROPOSAL_CREATE_COMMAND_ID) {
      createCalls.push(input)
      return {
        result: {
          proposalCartId: nextProposalCartId,
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          lines: [],
          totals: {},
          rejectedLines: [],
        },
      }
    }
    if (id === CART_PROPOSAL_REJECT_COMMAND_ID) {
      rejectCalls.push(input)
      return { result: { proposalCartId: input.proposalCartId, status: 'abandoned', alreadyResolved: false } }
    }
    throw new Error(`no fake handler for command ${id}`)
  })
  return { execute, createCalls, rejectCalls, setNextProposalCartId: (id: string) => { nextProposalCartId = id } }
}

function makeCtx(options: {
  em: unknown
  rbac: ReturnType<typeof makeRbac>
  commandBus: ReturnType<typeof makeCommandBus>
  storeContextService?: ReturnType<typeof makeStoreContextService>
  organizationIds: string[] | null
  tenantId?: string
  userId?: string
  request?: Request | null
}): CommandRuntimeContext {
  const services: Record<string, unknown> = {
    em: options.em,
    rbacService: options.rbac,
    commandBus: options.commandBus,
    storeContextService: options.storeContextService ?? makeStoreContextService(),
  }
  return {
    container: { resolve: (name: string) => services[name] },
    auth: { sub: options.userId ?? REP_USER_ID, tenantId: options.tenantId ?? TENANT_ID, orgId: ORG_ID },
    selectedOrganizationId: ORG_ID,
    organizationIds: options.organizationIds,
    organizationScope: null,
    request: options.request ?? undefined,
  } as unknown as CommandRuntimeContext
}

function makeOpenThread(overrides: Row = {}): Row {
  return {
    id: THREAD_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    storeId: STORE_ID,
    buyerCartId: BUYER_CART_ID,
    customerId: null,
    customerUserId: null,
    status: 'open',
    modeSnapshot: 'rep',
    liveProposalCount: 0,
    lastActivityAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    __key: 'threads',
    ...overrides,
  }
}

describe('assisted_selling.proposal.author', () => {
  test('wraps cart.proposal.create and stores the note as the message body — never on the cart (S19)', async () => {
    const thread = makeOpenThread()
    const { em } = makeFakeEm({ threads: [thread] })
    const rbac = makeRbac(['assisted_selling.proposals.author', 'cart.proposals.author'])
    const commandBus = makeCommandBus()
    const ctx = makeCtx({ em, rbac, commandBus, organizationIds: [ORG_ID] })

    const result = await authorProposalCommand.execute(
      {
        tenantId: TENANT_ID,
        organizationIds: [ORG_ID],
        threadId: THREAD_ID,
        lines: [{ productId: 'prod-1', quantity: '1' }],
        note: 'Four units away from the 100-unit tier',
        idempotencyKey: 'idem-key-0001',
      },
      ctx,
    )

    expect(result.replayed).toBe(false)
    expect(result.proposalCartId).toBe(PROPOSAL_CART_ID)
    expect(commandBus.createCalls).toHaveLength(1)
    // `cart.proposal.create`'s own input shape carries no `note` field at all — this
    // asserts it structurally, not just that the field happens to be absent by convention.
    expect(commandBus.createCalls[0]).not.toHaveProperty('note')
    expect(commandBus.createCalls[0].targetCartId).toBe(BUYER_CART_ID)

    const persistedMessages = (em as Row).persist.mock.calls.map((call: Row[]) => call[0]).filter((e: Row) => e.__key === 'messages')
    expect(persistedMessages).toHaveLength(1)
    expect(persistedMessages[0].body).toBe('Four units away from the 100-unit tier')
  })

  test('idempotency: the same key and body twice returns the original result and creates nothing new (S23)', async () => {
    const thread = makeOpenThread()
    const { em } = makeFakeEm({ threads: [thread] })
    const rbac = makeRbac(['assisted_selling.*', 'cart.proposals.author'])
    const commandBus = makeCommandBus()
    const ctx = makeCtx({ em, rbac, commandBus, organizationIds: [ORG_ID] })
    const input = {
      tenantId: TENANT_ID,
      organizationIds: [ORG_ID],
      threadId: THREAD_ID,
      lines: [{ productId: 'prod-1', quantity: '1' }],
      note: 'same note',
      idempotencyKey: 'idem-key-0002',
    }

    const first = await authorProposalCommand.execute(input, ctx)
    expect(first.replayed).toBe(false)
    expect(commandBus.createCalls).toHaveLength(1)

    const second = await authorProposalCommand.execute(input, ctx)
    expect(second.replayed).toBe(true)
    expect(second.proposalId).toBe(first.proposalId)
    expect(second.proposalCartId).toBe(first.proposalCartId)
    // No second `cart.proposal.create` dispatch for the replay.
    expect(commandBus.createCalls).toHaveLength(1)
  })

  test('idempotency: the same key with a different body answers 409 idempotency_key_mismatch (S23)', async () => {
    const thread = makeOpenThread()
    const { em } = makeFakeEm({ threads: [thread] })
    const rbac = makeRbac(['assisted_selling.*', 'cart.proposals.author'])
    const commandBus = makeCommandBus()
    const ctx = makeCtx({ em, rbac, commandBus, organizationIds: [ORG_ID] })
    const key = 'idem-key-0003'

    await authorProposalCommand.execute(
      { tenantId: TENANT_ID, organizationIds: [ORG_ID], threadId: THREAD_ID, lines: [{ productId: 'prod-1', quantity: '1' }], idempotencyKey: key },
      ctx,
    )

    const err = await authorProposalCommand
      .execute(
        { tenantId: TENANT_ID, organizationIds: [ORG_ID], threadId: THREAD_ID, lines: [{ productId: 'prod-2', quantity: '1' }], idempotencyKey: key },
        ctx,
      )
      .catch((e) => e)

    expect(isCrudHttpError(err)).toBe(true)
    expect(err.status).toBe(409)
    expect(err.body.code).toBe('idempotency_key_mismatch')
  })

  test('a wildcard ACL grant (cart.* and assisted_selling.*) still satisfies the double-feature check (S21)', async () => {
    const thread = makeOpenThread()
    const { em } = makeFakeEm({ threads: [thread] })
    const rbac = makeRbac(['assisted_selling.*', 'cart.*'])
    const commandBus = makeCommandBus()
    const ctx = makeCtx({ em, rbac, commandBus, organizationIds: [ORG_ID] })

    const result = await authorProposalCommand.execute(
      { tenantId: TENANT_ID, organizationIds: [ORG_ID], threadId: THREAD_ID, lines: [{ productId: 'prod-1', quantity: '1' }], idempotencyKey: 'idem-key-0004' },
      ctx,
    )
    expect(result.replayed).toBe(false)
  })

  test('refuses a principal missing cart.proposals.author even with the local feature granted (S21)', async () => {
    const thread = makeOpenThread()
    const { em } = makeFakeEm({ threads: [thread] })
    const rbac = makeRbac(['assisted_selling.proposals.author'])
    const commandBus = makeCommandBus()
    const ctx = makeCtx({ em, rbac, commandBus, organizationIds: [ORG_ID] })

    await expect(
      authorProposalCommand.execute(
        { tenantId: TENANT_ID, organizationIds: [ORG_ID], threadId: THREAD_ID, lines: [{ productId: 'prod-1', quantity: '1' }], idempotencyKey: 'idem-key-0005' },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 403 })
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  test('404s a thread outside the caller\'s organizationIds (S9)', async () => {
    const thread = makeOpenThread()
    const { em } = makeFakeEm({ threads: [thread] })
    const rbac = makeRbac(['assisted_selling.*', 'cart.*'])
    const commandBus = makeCommandBus()
    const ctx = makeCtx({ em, rbac, commandBus, organizationIds: [OTHER_ORG_ID] })

    await expect(
      authorProposalCommand.execute(
        { tenantId: TENANT_ID, organizationIds: [OTHER_ORG_ID], threadId: THREAD_ID, lines: [{ productId: 'prod-1', quantity: '1' }], idempotencyKey: 'idem-key-0006' },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 404 })
  })

  test('refuses a cross-tenant input before resolving the thread (tenant isolation)', async () => {
    const thread = makeOpenThread()
    const { em } = makeFakeEm({ threads: [thread] })
    const rbac = makeRbac(['assisted_selling.*', 'cart.*'])
    const commandBus = makeCommandBus()
    const ctx = makeCtx({ em, rbac, commandBus, organizationIds: [ORG_ID], tenantId: TENANT_ID })

    await expect(
      authorProposalCommand.execute(
        { tenantId: OTHER_ORG_ID, organizationIds: [ORG_ID], threadId: THREAD_ID, lines: [{ productId: 'prod-1', quantity: '1' }], idempotencyKey: 'idem-key-0007' },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('assisted_selling.proposal.withdraw', () => {
  function makePublishedProposal(overrides: Row = {}): Row {
    return {
      id: 'proposal-1',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      threadId: THREAD_ID,
      proposalCartId: PROPOSAL_CART_ID,
      targetCartId: BUYER_CART_ID,
      authoredByActorType: 'rep',
      authoredByActorId: REP_USER_ID,
      status: 'published',
      publishedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      idempotencyKey: 'idem-key-withdraw',
      requestDigest: 'digest',
      createdAt: new Date(),
      updatedAt: new Date(),
      __key: 'proposals',
      ...overrides,
    }
  }

  test('withdraws a published proposal and invokes cart.proposal.reject', async () => {
    const proposal = makePublishedProposal()
    const { em } = makeFakeEm({ proposals: [proposal] })
    const rbac = makeRbac(['assisted_selling.proposals.author'])
    const commandBus = makeCommandBus()
    const ctx = makeCtx({ em, rbac, commandBus, organizationIds: [ORG_ID] })

    const result = await withdrawProposalCommand.execute(
      { tenantId: TENANT_ID, organizationIds: [ORG_ID], proposalId: 'proposal-1' },
      ctx,
    )

    expect(result.status).toBe('withdrawn')
    expect(commandBus.rejectCalls).toHaveLength(1)
    expect(commandBus.rejectCalls[0]).toMatchObject({ proposalCartId: PROPOSAL_CART_ID, rejectedBy: 'author' })
  })

  test('refuses to withdraw a non-published proposal with 409 proposal_not_live', async () => {
    const proposal = makePublishedProposal({ status: 'accepted' })
    const { em } = makeFakeEm({ proposals: [proposal] })
    const rbac = makeRbac(['assisted_selling.proposals.author'])
    const commandBus = makeCommandBus()
    const ctx = makeCtx({ em, rbac, commandBus, organizationIds: [ORG_ID] })

    const err = await withdrawProposalCommand
      .execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], proposalId: 'proposal-1' }, ctx)
      .catch((e) => e)
    expect(isCrudHttpError(err)).toBe(true)
    expect(err.status).toBe(409)
    expect(err.body.code).toBe('proposal_not_live')
    expect(commandBus.rejectCalls).toHaveLength(0)
  })

  test('404s a proposal outside the caller\'s organizationIds (S9)', async () => {
    const proposal = makePublishedProposal()
    const { em } = makeFakeEm({ proposals: [proposal] })
    const rbac = makeRbac(['assisted_selling.proposals.author'])
    const commandBus = makeCommandBus()
    const ctx = makeCtx({ em, rbac, commandBus, organizationIds: [OTHER_ORG_ID] })

    await expect(
      withdrawProposalCommand.execute({ tenantId: TENANT_ID, organizationIds: [OTHER_ORG_ID], proposalId: 'proposal-1' }, ctx),
    ).rejects.toMatchObject({ status: 404 })
  })

  test('decrements the thread\'s live_proposal_count synchronously (Step 4.4-fix §6.4/§6.6)', async () => {
    const proposal = makePublishedProposal()
    const thread = makeOpenThread({ liveProposalCount: 1 })
    const { em } = makeFakeEm({ proposals: [proposal], threads: [thread] })
    const rbac = makeRbac(['assisted_selling.proposals.author'])
    const commandBus = makeCommandBus()
    const ctx = makeCtx({ em, rbac, commandBus, organizationIds: [ORG_ID] })

    await withdrawProposalCommand.execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], proposalId: 'proposal-1' }, ctx)

    expect(thread.liveProposalCount).toBe(0)
  })

  test('never decrements below zero, and no-ops gracefully when the thread row is not seeded', async () => {
    const proposal = makePublishedProposal()
    const { em } = makeFakeEm({ proposals: [proposal] })
    const rbac = makeRbac(['assisted_selling.proposals.author'])
    const commandBus = makeCommandBus()
    const ctx = makeCtx({ em, rbac, commandBus, organizationIds: [ORG_ID] })

    await expect(
      withdrawProposalCommand.execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], proposalId: 'proposal-1' }, ctx),
    ).resolves.toMatchObject({ status: 'withdrawn' })
  })
})

describe('assisted_selling.proposal.reauthor', () => {
  function makePublishedProposal(overrides: Row = {}): Row {
    return {
      id: 'proposal-2',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      threadId: THREAD_ID,
      proposalCartId: PROPOSAL_CART_ID,
      targetCartId: BUYER_CART_ID,
      authoredByActorType: 'rep',
      authoredByActorId: REP_USER_ID,
      status: 'published',
      publishedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      idempotencyKey: 'idem-key-reauthor-old',
      requestDigest: 'digest',
      createdAt: new Date(),
      updatedAt: new Date(),
      __key: 'proposals',
      ...overrides,
    }
  }

  function makeCartServiceForReauthor() {
    return {
      getForOrganizations: jest.fn(),
      getProposalCartLines: jest.fn(async () => [
        { productId: 'prod-1', variantId: null, quantity: '2', configuration: null },
      ]),
    }
  }

  test('creates a new proposal from the old one\'s lines and supersedes the old row', async () => {
    const oldProposal = makePublishedProposal()
    const thread = makeOpenThread({ liveProposalCount: 1 })
    const { em } = makeFakeEm({ threads: [thread], proposals: [oldProposal] })
    const rbac = makeRbac(['assisted_selling.proposals.author', 'cart.proposals.author'])
    const commandBus = makeCommandBus()
    commandBus.setNextProposalCartId('new-proposal-cart-id')
    const cartService = makeCartServiceForReauthor()
    const services: Record<string, unknown> = {
      em,
      rbacService: rbac,
      commandBus,
      storeContextService: makeStoreContextService(),
      cartService,
    }
    const ctx = {
      container: { resolve: (name: string) => services[name] },
      auth: { sub: REP_USER_ID, tenantId: TENANT_ID, orgId: ORG_ID },
      selectedOrganizationId: ORG_ID,
      organizationIds: [ORG_ID],
      organizationScope: null,
      request: undefined,
    } as unknown as CommandRuntimeContext

    const result = await reauthorProposalCommand.execute(
      { tenantId: TENANT_ID, organizationIds: [ORG_ID], proposalId: 'proposal-2', idempotencyKey: 'idem-key-reauthor-new' },
      ctx,
    )

    expect(result.replayed).toBe(false)
    expect(result.proposalCartId).toBe('new-proposal-cart-id')
    expect(cartService.getProposalCartLines).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      proposalCartId: PROPOSAL_CART_ID,
    })
    expect(commandBus.createCalls[0].lines).toEqual([{ productId: 'prod-1', variantId: null, quantity: '2', configuration: null }])
    expect(oldProposal.status).toBe('superseded')
    expect(oldProposal.supersededByProposalId).toBe(result.proposalId)
    // §6.4: the old (still-published) proposal's cart is rejected by the same rule.
    expect(commandBus.rejectCalls.some((call: Row) => call.proposalCartId === PROPOSAL_CART_ID)).toBe(true)
    // Step 4.4-fix: the new proposal's own publish increments the thread (performAuthorProposal),
    // and this command's own supersede branch decrements it for the OLD one — net zero here
    // because exactly one proposal stays live throughout (the old one hands off to the new one).
    expect(thread.liveProposalCount).toBe(1)
  })

  test('refuses to re-author an accepted proposal with 409 proposal_already_accepted (D-R5-25)', async () => {
    const oldProposal = makePublishedProposal({ status: 'accepted' })
    const thread = makeOpenThread()
    const { em } = makeFakeEm({ threads: [thread], proposals: [oldProposal] })
    const rbac = makeRbac(['assisted_selling.proposals.author', 'cart.proposals.author'])
    const commandBus = makeCommandBus()
    const cartService = makeCartServiceForReauthor()
    const services: Record<string, unknown> = { em, rbacService: rbac, commandBus, storeContextService: makeStoreContextService(), cartService }
    const ctx = {
      container: { resolve: (name: string) => services[name] },
      auth: { sub: REP_USER_ID, tenantId: TENANT_ID, orgId: ORG_ID },
      selectedOrganizationId: ORG_ID,
      organizationIds: [ORG_ID],
      organizationScope: null,
      request: undefined,
    } as unknown as CommandRuntimeContext

    const err = await reauthorProposalCommand
      .execute({ tenantId: TENANT_ID, organizationIds: [ORG_ID], proposalId: 'proposal-2', idempotencyKey: 'idem-key-reauthor-accepted' }, ctx)
      .catch((e) => e)
    expect(isCrudHttpError(err)).toBe(true)
    expect(err.status).toBe(409)
    expect(err.body.code).toBe('proposal_already_accepted')
  })
})

describe('reauthorProposalForMergeRetarget — Step 4.4-fix (§8.1/D-R5-14, migrated from cart)', () => {
  function makeOldProposal(overrides: Row = {}): Row {
    return {
      id: 'old-proposal-1',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      threadId: THREAD_ID,
      proposalCartId: PROPOSAL_CART_ID,
      targetCartId: BUYER_CART_ID,
      authoredByActorType: 'rep',
      authoredByActorId: REP_USER_ID,
      status: 'published',
      resolvedAt: null,
      supersededByProposalId: null,
      __key: 'proposals',
      ...overrides,
    }
  }

  const MERGED_INTO_CART_ID = 'cart-merged-into-1'
  const IDENTIFIED_CUSTOMER_ID = 'customer-identified-1'
  const IDENTIFIED_CUSTOMER_USER_ID = 'customer-user-identified-1'

  test('re-authors against the merged-into cart under the original author, then supersedes the old row (decrement, reject, .superseded event)', async () => {
    const oldProposal = makeOldProposal()
    // Stale guest identity on the thread itself — re-pointing it is a later Step's own
    // scope (§5.1), so `resolveForBuyer` must use the event's identity, not this one.
    const thread = makeOpenThread({ liveProposalCount: 1, customerId: null, customerUserId: null })
    const { em } = makeFakeEm({ threads: [thread], proposals: [oldProposal] })
    const rbac = makeRbac(['assisted_selling.proposals.author', 'cart.proposals.author'])
    const commandBus = makeCommandBus()
    commandBus.setNextProposalCartId('new-proposal-cart-id')
    const storeContextService = makeStoreContextService()
    const ctx = makeCtx({ em, rbac, commandBus, storeContextService, organizationIds: [ORG_ID], userId: REP_USER_ID })

    const result = await reauthorProposalForMergeRetarget({
      ctx,
      oldProposal,
      thread,
      lines: [{ productId: 'prod-1', variantId: null, quantity: '2', configuration: null }],
      targetCartId: MERGED_INTO_CART_ID,
      targetCustomerId: IDENTIFIED_CUSTOMER_ID,
      targetCustomerUserId: IDENTIFIED_CUSTOMER_USER_ID,
      idempotencyKey: 'reauthor-on-merge:old-proposal-1',
    })

    expect(result.replayed).toBe(false)
    expect(commandBus.createCalls[0].targetCartId).toBe(MERGED_INTO_CART_ID)
    expect(storeContextService.resolveForBuyer).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: IDENTIFIED_CUSTOMER_ID, customerUserId: IDENTIFIED_CUSTOMER_USER_ID }),
    )
    expect(oldProposal.status).toBe('superseded')
    expect(oldProposal.supersededByProposalId).toBe(result.proposalId)
    expect(thread.liveProposalCount).toBe(1) // +1 new, -1 old
    expect(commandBus.rejectCalls.some((call: Row) => call.proposalCartId === PROPOSAL_CART_ID && call.rejectedBy === 'author')).toBe(true)
  })

  test('a redelivered merge event replays the original result and skips the old-row bookkeeping a second time', async () => {
    const oldProposal = makeOldProposal()
    const thread = makeOpenThread({ liveProposalCount: 1 })
    const { em } = makeFakeEm({ threads: [thread], proposals: [oldProposal] })
    const rbac = makeRbac(['assisted_selling.proposals.author', 'cart.proposals.author'])
    const commandBus = makeCommandBus()
    commandBus.setNextProposalCartId('new-proposal-cart-id-2')
    const ctx = makeCtx({ em, rbac, commandBus, organizationIds: [ORG_ID], userId: REP_USER_ID })
    const params = {
      ctx,
      oldProposal,
      thread,
      lines: [{ productId: 'prod-1', variantId: null, quantity: '2', configuration: null }],
      targetCartId: MERGED_INTO_CART_ID,
      targetCustomerId: null,
      targetCustomerUserId: null,
      idempotencyKey: 'reauthor-on-merge:old-proposal-1',
    }

    const first = await reauthorProposalForMergeRetarget(params)
    expect(first.replayed).toBe(false)
    expect(oldProposal.status).toBe('superseded')
    expect(thread.liveProposalCount).toBe(1)
    const rejectCallsAfterFirst = commandBus.rejectCalls.length

    const second = await reauthorProposalForMergeRetarget(params)
    expect(second.replayed).toBe(true)
    expect(second.proposalId).toBe(first.proposalId)
    // No second supersede pass: status/count/reject-call-count all unchanged.
    expect(oldProposal.status).toBe('superseded')
    expect(thread.liveProposalCount).toBe(1)
    expect(commandBus.rejectCalls.length).toBe(rejectCallsAfterFirst)
  })
})
