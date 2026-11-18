/** @jest-environment node */
import { Lease, LeaseProposal, LeaseVersion, SalesOperation } from '../data/entities'
import { FakeEm, type EntityClass, type Where } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn(() => ({ enqueue: jest.fn() })) }))

import { closeProposal } from '../lib/leaseRecords'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }

type Seeded = { lease: Lease; proposal: LeaseProposal; version: LeaseVersion }

function seed(em: FakeEm, salesQuoteId: string | null): Seeded {
  const lease = em.seed(Lease, { id: 'lease-1', ...scope, status: 'proposed', deletedAt: null } as never) as unknown as Lease
  const version = em.seed(LeaseVersion, { id: 'version-1', ...scope, leaseId: 'lease-1', state: 'pending' } as never) as unknown as LeaseVersion
  const proposal = em.seed(LeaseProposal, {
    id: 'proposal-1',
    ...scope,
    leaseId: 'lease-1',
    versionId: 'version-1',
    kind: 'new',
    status: 'sent',
    holdToken: 'hold-1',
    salesQuoteId,
  } as never) as unknown as LeaseProposal
  return { lease, proposal, version }
}

function trackReadsOfUnflushedState(em: FakeEm, seeded: Seeded): string[] {
  const snapshot = () => JSON.stringify([seeded.proposal.status, seeded.proposal.holdToken, seeded.version.state, seeded.lease.status])
  let flushed = snapshot()
  const unflushedReads: string[] = []
  const flush = em.flush.bind(em)
  em.flush = async () => {
    flushed = snapshot()
    await flush()
  }
  const findOne = em.findOne.bind(em)
  em.findOne = async (entity: EntityClass, where: Where, options?: Parameters<FakeEm['findOne']>[2]) => {
    if (snapshot() !== flushed) unflushedReads.push(entity.name)
    return findOne(entity, where, options)
  }
  const find = em.find.bind(em)
  em.find = async (entity: EntityClass, where: Where, options?: Parameters<FakeEm['find']>[2]) => {
    if (snapshot() !== flushed) unflushedReads.push(entity.name)
    return find(entity, where, options)
  }
  return unflushedReads
}

describe('closeProposal', () => {
  it('flushes the closed proposal before reading the version or recording the quote cancellation', async () => {
    const em = new FakeEm()
    const seeded = seed(em, 'quote-1')
    const unflushedReads = trackReadsOfUnflushedState(em, seeded)
    const operation = await closeProposal(em as never, scope, seeded.lease, seeded.proposal, 'withdrawn')
    expect(unflushedReads).toEqual([])
    expect(seeded.proposal).toMatchObject({ status: 'withdrawn', holdToken: null })
    expect(seeded.version.state).toBe('reverted')
    expect(seeded.lease.status).toBe('withdrawn')
    expect(operation).toMatchObject({
      kind: 'quote_status',
      subjectKey: 'quote_status:proposal-1:canceled',
      payload: { quoteId: 'quote-1', status: 'canceled' },
      targetType: 'lease_proposal',
      targetId: 'proposal-1',
      leaseId: 'lease-1',
    })
    expect(em.rows(SalesOperation)).toEqual([operation])
  })

  it('closes a proposal without a quote and records no operation', async () => {
    const em = new FakeEm()
    const seeded = seed(em, null)
    const unflushedReads = trackReadsOfUnflushedState(em, seeded)
    const operation = await closeProposal(em as never, scope, seeded.lease, seeded.proposal, 'expired')
    expect(operation).toBeNull()
    expect(unflushedReads).toEqual([])
    expect(seeded.proposal.status).toBe('expired')
    expect(seeded.version.state).toBe('reverted')
    expect(seeded.lease.status).toBe('expired')
    expect(em.rows(SalesOperation)).toHaveLength(0)
    expect(em.flushes).toBeGreaterThan(0)
  })
})
