jest.mock('../../events', () => ({ emitAssistedSellingEvent: jest.fn(async () => undefined) }))

import { emitAssistedSellingEvent } from '../../events'
import { AssistedSellingProposal, AssistedSellingThread } from '../../data/entities'
import { createCartProposalTerminalHandler } from '../terminalStateSubscriber'

type Row = Record<string, any>

const TENANT_ID = 'tenant-terminal-1'
const ORG_ID = 'org-terminal-1'
const THREAD_ID = 'thread-1'
const PROPOSAL_ID = 'proposal-1'
const PROPOSAL_CART_ID = 'proposal-cart-1'

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true
    return (row[key] ?? null) === (value ?? null)
  })
}

function makeProposal(overrides: Row = {}): Row {
  return {
    id: PROPOSAL_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    threadId: THREAD_ID,
    proposalCartId: PROPOSAL_CART_ID,
    status: 'published',
    resolvedAt: null,
    mergeLogId: null,
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

function makeFakeEm(seed: { proposals?: Row[]; threads?: Row[] } = {}) {
  const proposals = seed.proposals ? [...seed.proposals] : []
  const threads = seed.threads ? [...seed.threads] : []
  const em: Row = {
    findOne: jest.fn(async (Cls: unknown, where: Row) => {
      const rows = Cls === AssistedSellingProposal ? proposals : Cls === AssistedSellingThread ? threads : []
      return rows.find((row) => matches(row, where)) ?? null
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    // #8268 review Major 4 (re-review): the handler now claims the published -> terminal
    // transition via a conditional `nativeUpdate` (atomic claim) instead of a scalar
    // mutation + `persist` — mirrors the real "only rows still matching the WHERE get
    // updated" semantics so a test can prove a lost race (status already flipped) claims
    // zero rows.
    nativeUpdate: jest.fn(async (Cls: unknown, where: Row, data: Row) => {
      const rows = Cls === AssistedSellingProposal ? proposals : []
      const matching = rows.filter((row) => matches(row, where))
      matching.forEach((row) => Object.assign(row, data))
      return matching.length
    }),
    // `applyLiveProposalCountDelta` (`lib/liveProposalCount.ts`) — the only raw SQL this
    // handler issues. Mirrors the real `GREATEST(live_proposal_count + delta, 0)` update
    // against the seeded thread row by id.
    execute: jest.fn(async (_sql: string, params: unknown[] = []) => {
      const [delta, threadId] = params as [number, string]
      const thread = threads.find((row) => row.id === threadId)
      if (thread) thread.liveProposalCount = Math.max(0, (thread.liveProposalCount ?? 0) + delta)
      return []
    }),
    // `withAtomicFlush({ transaction: true })` (`lib/terminalStateSubscriber.ts`) drives
    // these directly.
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    isInTransaction: jest.fn(() => false),
  }
  em.fork = jest.fn(() => em)
  return { em, proposals, threads }
}

function makeContainer(em: Row) {
  return { resolve: (name: string): any => (name === 'em' ? em : undefined) }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('createCartProposalTerminalHandler — §6.6 terminal-state subscriber', () => {
  test('accepted: sets status/resolvedAt/mergeLogId, decrements the thread, emits .proposal.accepted', async () => {
    const proposal = makeProposal()
    const thread = makeThread({ liveProposalCount: 2 })
    const { em } = makeFakeEm({ proposals: [proposal], threads: [thread] })
    const handler = createCartProposalTerminalHandler({
      targetStatus: 'accepted',
      emitEventId: 'assisted_selling.proposal.accepted',
      subscriberId: 'test:accepted',
    })

    await handler(
      { proposalCartId: PROPOSAL_CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, mergeLogId: 'merge-log-1' },
      { resolve: makeContainer(em).resolve, container: makeContainer(em) },
    )

    expect(proposal.status).toBe('accepted')
    expect(proposal.resolvedAt).toBeInstanceOf(Date)
    expect(proposal.mergeLogId).toBe('merge-log-1')
    expect(thread.liveProposalCount).toBe(1)
    expect(emitAssistedSellingEvent).toHaveBeenCalledWith('assisted_selling.proposal.accepted', {
      threadId: THREAD_ID,
      proposalId: PROPOSAL_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
  })

  test('rejected (buyer): sets status, decrements, emits .proposal.rejected', async () => {
    const proposal = makeProposal()
    const thread = makeThread({ liveProposalCount: 1 })
    const { em } = makeFakeEm({ proposals: [proposal], threads: [thread] })
    const handler = createCartProposalTerminalHandler({
      targetStatus: 'rejected',
      emitEventId: 'assisted_selling.proposal.rejected',
      subscriberId: 'test:rejected',
      skipWhenRejectedByAuthor: true,
    })

    await handler(
      { proposalCartId: PROPOSAL_CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, rejectedBy: 'buyer' },
      { resolve: makeContainer(em).resolve, container: makeContainer(em) },
    )

    expect(proposal.status).toBe('rejected')
    expect(thread.liveProposalCount).toBe(0)
    expect(emitAssistedSellingEvent).toHaveBeenCalledWith('assisted_selling.proposal.rejected', expect.objectContaining({ proposalId: PROPOSAL_ID }))
  })

  test('rejected (author): skips entirely — withdraw/reauthor/merge-retarget already own this decrement', async () => {
    const proposal = makeProposal()
    const thread = makeThread({ liveProposalCount: 1 })
    const { em } = makeFakeEm({ proposals: [proposal], threads: [thread] })
    const handler = createCartProposalTerminalHandler({
      targetStatus: 'rejected',
      emitEventId: 'assisted_selling.proposal.rejected',
      subscriberId: 'test:rejected',
      skipWhenRejectedByAuthor: true,
    })

    await handler(
      { proposalCartId: PROPOSAL_CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, rejectedBy: 'author' },
      { resolve: makeContainer(em).resolve, container: makeContainer(em) },
    )

    expect(proposal.status).toBe('published')
    expect(thread.liveProposalCount).toBe(1)
    expect(emitAssistedSellingEvent).not.toHaveBeenCalled()
    expect(em.findOne).not.toHaveBeenCalled()
  })

  test('expired: sets status, decrements, emits .proposal.expired', async () => {
    const proposal = makeProposal()
    const thread = makeThread({ liveProposalCount: 1 })
    const { em } = makeFakeEm({ proposals: [proposal], threads: [thread] })
    const handler = createCartProposalTerminalHandler({
      targetStatus: 'expired',
      emitEventId: 'assisted_selling.proposal.expired',
      subscriberId: 'test:expired',
    })

    await handler(
      { proposalCartId: PROPOSAL_CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
      { resolve: makeContainer(em).resolve, container: makeContainer(em) },
    )

    expect(proposal.status).toBe('expired')
    expect(thread.liveProposalCount).toBe(0)
    expect(emitAssistedSellingEvent).toHaveBeenCalledWith('assisted_selling.proposal.expired', expect.objectContaining({ proposalId: PROPOSAL_ID }))
  })

  test('idempotent on redelivery: a proposal already resolved is never touched twice', async () => {
    const proposal = makeProposal({ status: 'accepted', resolvedAt: new Date(), mergeLogId: 'merge-log-1' })
    const thread = makeThread({ liveProposalCount: 0 })
    const { em } = makeFakeEm({ proposals: [proposal], threads: [thread] })
    const handler = createCartProposalTerminalHandler({
      targetStatus: 'accepted',
      emitEventId: 'assisted_selling.proposal.accepted',
      subscriberId: 'test:accepted',
    })

    await handler(
      { proposalCartId: PROPOSAL_CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, mergeLogId: 'merge-log-1' },
      { resolve: makeContainer(em).resolve, container: makeContainer(em) },
    )

    expect(thread.liveProposalCount).toBe(0)
    expect(emitAssistedSellingEvent).not.toHaveBeenCalled()
  })

  test('skips a payload missing proposalCartId/tenantId/organizationId (S3/D-R5-32)', async () => {
    const { em } = makeFakeEm()
    const handler = createCartProposalTerminalHandler({
      targetStatus: 'expired',
      emitEventId: 'assisted_selling.proposal.expired',
      subscriberId: 'test:expired',
    })

    await handler({ proposalCartId: PROPOSAL_CART_ID }, { resolve: makeContainer(em).resolve, container: makeContainer(em) })

    expect(em.findOne).not.toHaveBeenCalled()
    expect(emitAssistedSellingEvent).not.toHaveBeenCalled()
  })

  test('reads tenantId/organizationId from ctx when the payload omits them (the sweeper-emitted cart.proposal.expired shape)', async () => {
    const proposal = makeProposal()
    const thread = makeThread({ liveProposalCount: 1 })
    const { em } = makeFakeEm({ proposals: [proposal], threads: [thread] })
    const handler = createCartProposalTerminalHandler({
      targetStatus: 'expired',
      emitEventId: 'assisted_selling.proposal.expired',
      subscriberId: 'test:expired',
    })

    await handler(
      { proposalCartId: PROPOSAL_CART_ID },
      { resolve: makeContainer(em).resolve, container: makeContainer(em), tenantId: TENANT_ID, organizationId: ORG_ID },
    )

    expect(proposal.status).toBe('expired')
    expect(thread.liveProposalCount).toBe(0)
  })

  test('is a no-op when no proposal matches the tenant/organization-scoped lookup', async () => {
    const { em } = makeFakeEm({ proposals: [] })
    const handler = createCartProposalTerminalHandler({
      targetStatus: 'expired',
      emitEventId: 'assisted_selling.proposal.expired',
      subscriberId: 'test:expired',
    })

    await handler(
      { proposalCartId: PROPOSAL_CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
      { resolve: makeContainer(em).resolve, container: makeContainer(em) },
    )

    expect(emitAssistedSellingEvent).not.toHaveBeenCalled()
  })

  // #8268 review Major 4 (re-review): a redelivered terminal event (or a genuine
  // accept/reject/expire race) for the SAME proposal must decrement the thread's
  // `live_proposal_count` exactly once and emit exactly once — never twice, which
  // would leave the counter at zero while another proposal on the same thread is
  // still `published`. The pre-fix handler read `status !== 'published'` before any
  // write and so unconditionally decremented on every delivery; the fix claims the
  // transition via a conditional `nativeUpdate` (`WHERE status = 'published'`), so
  // only the delivery whose claim actually matched a row decrements/emits.
  test('a redelivered terminal event for the same proposal decrements the thread exactly once, never twice', async () => {
    const proposal = makeProposal()
    // A second, still-published proposal on the SAME thread — the counter must land
    // on 1 (that proposal's own share), never 0.
    const thread = makeThread({ liveProposalCount: 2 })
    const { em } = makeFakeEm({ proposals: [proposal], threads: [thread] })
    const handler = createCartProposalTerminalHandler({
      targetStatus: 'accepted',
      emitEventId: 'assisted_selling.proposal.accepted',
      subscriberId: 'test:accepted',
    })
    const payload = { proposalCartId: PROPOSAL_CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID, mergeLogId: 'merge-log-1' }
    const ctx = { resolve: makeContainer(em).resolve, container: makeContainer(em) }

    // Two deliveries of the SAME event for the SAME proposal, racing — exactly the
    // "two deliveries can both observe published before either transaction begins"
    // scenario the fix closes.
    await Promise.all([handler(payload, ctx), handler(payload, ctx)])

    expect(proposal.status).toBe('accepted')
    expect(thread.liveProposalCount).toBe(1)
    expect(emitAssistedSellingEvent).toHaveBeenCalledTimes(1)
  })
})
