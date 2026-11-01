jest.mock('../../events', () => ({ emitAssistedSellingEvent: jest.fn(async () => undefined) }))
jest.mock('../../commands/proposals', () => ({ reauthorProposalForMergeRetarget: jest.fn() }))

import { emitAssistedSellingEvent } from '../../events'
import { reauthorProposalForMergeRetarget } from '../../commands/proposals'
import { AssistedSellingProposal, AssistedSellingThread } from '../../data/entities'
import { handleCartMergedForAssistedSellingReauthor } from '../reauthorOnMerge'

type Row = Record<string, any>

const TENANT_ID = 'tenant-retarget-1'
const ORG_ID = 'org-retarget-1'
const OLD_TARGET_ID = 'cart-old-target'
const NEW_TARGET_ID = 'cart-new-target'
const AUTHOR_USER_ID = 'rep-user-1'
const THREAD_ID = 'thread-retarget-1'
const PROPOSAL_CART_ID = 'proposal-cart-retarget-1'

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true
    return (row[key] ?? null) === (value ?? null)
  })
}

function makeProposal(overrides: Row = {}): Row {
  return {
    id: 'proposal-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    threadId: THREAD_ID,
    proposalCartId: PROPOSAL_CART_ID,
    targetCartId: OLD_TARGET_ID,
    authoredByActorType: 'rep',
    authoredByActorId: AUTHOR_USER_ID,
    status: 'published',
    resolvedAt: null,
    supersededByProposalId: null,
    deletedAt: null,
    ...overrides,
  }
}

function makeThread(overrides: Row = {}): Row {
  return {
    id: THREAD_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    liveProposalCount: 1,
    deletedAt: null,
    ...overrides,
  }
}

function makeMergedPayload(overrides: Row = {}): Row {
  return {
    sourceCartId: OLD_TARGET_ID,
    targetCartId: NEW_TARGET_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    kind: 'basket',
    customerId: null,
    customerUserId: null,
    ...overrides,
  }
}

function makeFakeEm(seed: { proposals?: Row[]; threads?: Row[] } = {}) {
  const proposals = seed.proposals ? [...seed.proposals] : []
  const threads = seed.threads ? [...seed.threads] : []
  const em: Row = {
    find: jest.fn(async (Cls: unknown, where: Row) => {
      const rows = Cls === AssistedSellingProposal ? proposals : []
      return rows.filter((row) => matches(row, where))
    }),
    findOne: jest.fn(async (Cls: unknown, where: Row) => {
      const rows = Cls === AssistedSellingThread ? threads : Cls === AssistedSellingProposal ? proposals : []
      return rows.find((row) => matches(row, where)) ?? null
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
  em.fork = jest.fn(() => em)
  return { em, proposals, threads }
}

function makeCartService(lines: Row[] = [{ productId: 'product-1', variantId: null, quantity: '2', configuration: null }]) {
  return { getProposalCartLines: jest.fn(async () => lines), getForOrganizations: jest.fn() }
}

function makeContainer(opts: { em: Row; commandBus: { execute: jest.Mock }; cartService: Row }) {
  const services: Record<string, unknown> = { em: opts.em, commandBus: opts.commandBus, cartService: opts.cartService }
  return { resolve: (name: string): any => services[name] }
}

function makeCommandBus() {
  const execute = jest.fn(async (id: string, options: { input: Row }) => {
    if (id === 'cart.proposal.reject') return { result: { proposalCartId: options.input.proposalCartId, status: 'abandoned', alreadyResolved: false } }
    throw new Error(`unexpected command ${id}`)
  })
  return { execute }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('handleCartMergedForAssistedSellingReauthor — D-R5-14 re-author / supersede fallback', () => {
  test('re-authors the live proposal via reauthorProposalForMergeRetarget, under the original author', async () => {
    const proposal = makeProposal()
    const thread = makeThread()
    const { em } = makeFakeEm({ proposals: [proposal], threads: [thread] })
    const commandBus = makeCommandBus()
    const cartService = makeCartService()
    const container = makeContainer({ em, commandBus, cartService })
    ;(reauthorProposalForMergeRetarget as jest.Mock).mockResolvedValue({ proposalId: 'proposal-2', replayed: false })

    await handleCartMergedForAssistedSellingReauthor(makeMergedPayload(), { resolve: container.resolve, container })

    expect(reauthorProposalForMergeRetarget).toHaveBeenCalledTimes(1)
    const call = (reauthorProposalForMergeRetarget as jest.Mock).mock.calls[0][0]
    expect(call.oldProposal).toBe(proposal)
    expect(call.thread).toBe(thread)
    expect(call.targetCartId).toBe(NEW_TARGET_ID)
    expect(call.lines).toEqual([{ productId: 'product-1', variantId: null, quantity: '2', configuration: null }])
    expect(call.idempotencyKey).toBe('reauthor-on-merge:proposal-1')
    // Re-authored under the ORIGINAL author's identity via the trusted-context helper.
    expect(call.ctx.auth).toEqual(expect.objectContaining({ sub: AUTHOR_USER_ID }))
    // Success path: this handler does none of the supersede bookkeeping itself — the
    // mocked `reauthorProposalForMergeRetarget` already owns it.
    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(emitAssistedSellingEvent).not.toHaveBeenCalled()
  })

  test('falls back to supersede-only (no re-author) when reauthorProposalForMergeRetarget refuses — e.g. the author lost cart.proposals.author', async () => {
    const proposal = makeProposal()
    const thread = makeThread({ liveProposalCount: 1 })
    const { em } = makeFakeEm({ proposals: [proposal], threads: [thread] })
    const commandBus = makeCommandBus()
    const cartService = makeCartService()
    const container = makeContainer({ em, commandBus, cartService })
    ;(reauthorProposalForMergeRetarget as jest.Mock).mockRejectedValue(new Error('403 Missing required feature "cart.proposals.author"'))

    await handleCartMergedForAssistedSellingReauthor(makeMergedPayload(), { resolve: container.resolve, container })

    expect(proposal.status).toBe('superseded')
    expect(thread.liveProposalCount).toBe(0)
    expect(commandBus.execute).toHaveBeenCalledWith(
      'cart.proposal.reject',
      expect.objectContaining({ input: expect.objectContaining({ proposalCartId: PROPOSAL_CART_ID, rejectedBy: 'author' }) }),
    )
    expect(emitAssistedSellingEvent).toHaveBeenCalledWith('assisted_selling.proposal.superseded', expect.objectContaining({ proposalId: 'proposal-1' }))
  })

  test('falls back to supersede-only without ever attempting re-author when the proposal author is not an eligible actor type', async () => {
    const proposal = makeProposal({ authoredByActorType: 'ai_agent' })
    const thread = makeThread({ liveProposalCount: 1 })
    const { em } = makeFakeEm({ proposals: [proposal], threads: [thread] })
    const commandBus = makeCommandBus()
    const cartService = makeCartService()
    const container = makeContainer({ em, commandBus, cartService })

    await handleCartMergedForAssistedSellingReauthor(makeMergedPayload(), { resolve: container.resolve, container })

    expect(reauthorProposalForMergeRetarget).not.toHaveBeenCalled()
    expect(proposal.status).toBe('superseded')
    expect(thread.liveProposalCount).toBe(0)
    expect(commandBus.execute).toHaveBeenCalledWith('cart.proposal.reject', expect.anything())
  })

  test('falls back to supersede-only when the proposal cart has no lines, without ever attempting re-author', async () => {
    const proposal = makeProposal()
    const thread = makeThread({ liveProposalCount: 1 })
    const { em } = makeFakeEm({ proposals: [proposal], threads: [thread] })
    const commandBus = makeCommandBus()
    const cartService = makeCartService([])
    const container = makeContainer({ em, commandBus, cartService })

    await handleCartMergedForAssistedSellingReauthor(makeMergedPayload(), { resolve: container.resolve, container })

    expect(reauthorProposalForMergeRetarget).not.toHaveBeenCalled()
    expect(proposal.status).toBe('superseded')
    expect(thread.liveProposalCount).toBe(0)
  })

  test('is a no-op when no live local proposal targets the absorbed cart', async () => {
    const { em } = makeFakeEm({ proposals: [] })
    const commandBus = makeCommandBus()
    const cartService = makeCartService()
    const container = makeContainer({ em, commandBus, cartService })

    await handleCartMergedForAssistedSellingReauthor(makeMergedPayload(), { resolve: container.resolve, container })

    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(reauthorProposalForMergeRetarget).not.toHaveBeenCalled()
  })

  test('ignores a payload missing tenant/organization scope (S3/D-R5-32)', async () => {
    const { em } = makeFakeEm({ proposals: [makeProposal()] })
    const commandBus = makeCommandBus()
    const cartService = makeCartService()
    const container = makeContainer({ em, commandBus, cartService })

    await handleCartMergedForAssistedSellingReauthor(makeMergedPayload({ tenantId: undefined, organizationId: undefined }), {
      resolve: container.resolve,
      container,
    })

    expect(em.find).not.toHaveBeenCalled()
  })

  test('ignores the kind: "proposal" cart.cart.merged emission — the acceptance-merge, never a login merge', async () => {
    const { em } = makeFakeEm({ proposals: [makeProposal()] })
    const commandBus = makeCommandBus()
    const cartService = makeCartService()
    const container = makeContainer({ em, commandBus, cartService })

    await handleCartMergedForAssistedSellingReauthor(makeMergedPayload({ kind: 'proposal' }), { resolve: container.resolve, container })

    expect(em.find).not.toHaveBeenCalled()
  })

  test('processes two sibling proposals targeting the same absorbed cart independently', async () => {
    const proposalA = makeProposal({ id: 'proposal-a', proposalCartId: 'proposal-cart-a' })
    const proposalB = makeProposal({ id: 'proposal-b', proposalCartId: 'proposal-cart-b' })
    const thread = makeThread({ liveProposalCount: 2 })
    const { em } = makeFakeEm({ proposals: [proposalA, proposalB], threads: [thread] })
    const commandBus = makeCommandBus()
    const cartService = makeCartService()
    const container = makeContainer({ em, commandBus, cartService })
    ;(reauthorProposalForMergeRetarget as jest.Mock).mockResolvedValue({ proposalId: 'generated', replayed: false })

    await handleCartMergedForAssistedSellingReauthor(makeMergedPayload(), { resolve: container.resolve, container })

    expect(reauthorProposalForMergeRetarget).toHaveBeenCalledTimes(2)
    const proposalIds = (reauthorProposalForMergeRetarget as jest.Mock).mock.calls.map((call) => call[0].oldProposal.id)
    expect(new Set(proposalIds)).toEqual(new Set(['proposal-a', 'proposal-b']))
  })
})
