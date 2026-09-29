import { AgentProposal } from '../data/entities'

const createForFeature = jest.fn(async () => [])
const deleteBySource = jest.fn(async () => 1)

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: () => ({ createForFeature, deleteBySource }),
}))

import handlePending from '../subscribers/proposal-pending-notification'
import handleDisposed from '../subscribers/proposal-disposed-notification-clear'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const PROPOSAL = '33333333-3333-4333-8333-333333333333'

type Row = Record<string, unknown> | null

function ctxWith(row: Row) {
  const em = {
    fork() {
      return em
    },
    async findOne(entity: unknown, where: Record<string, unknown>) {
      if (entity !== AgentProposal) return null
      if (!row) return null
      const matches = Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value)
      return matches ? row : null
    },
  }
  return {
    resolve: (name: string) => (name === 'em' ? em : undefined),
    tenantId: TENANT,
    organizationId: ORG,
  } as never
}

function pendingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PROPOSAL,
    tenantId: TENANT,
    organizationId: ORG,
    agentId: 'refunds-triage',
    disposition: 'pending',
    ...overrides,
  }
}

function createdEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: PROPOSAL,
    agentId: 'refunds-triage',
    source: 'runtime',
    tenantId: TENANT,
    organizationId: ORG,
    ...overrides,
  }
}

beforeEach(() => {
  createForFeature.mockClear()
  deleteBySource.mockClear()
})

describe('proposal pending notification', () => {
  it('notifies the people who can dispose, linking to the proposal', async () => {
    await handlePending(createdEvent(), ctxWith(pendingRow()))

    expect(createForFeature).toHaveBeenCalledTimes(1)
    const [input, scope] = createForFeature.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>]
    expect(input.requiredFeature).toBe('agent_orchestrator.proposals.dispose')
    expect(input.linkHref).toBe(`/backend/caseload/${PROPOSAL}`)
    expect(input.sourceEntityId).toBe(PROPOSAL)
    expect(scope).toEqual({ tenantId: TENANT, organizationId: ORG })
  })

  it('keys on the proposal so a redelivered event cannot stack a second notification', async () => {
    await handlePending(createdEvent(), ctxWith(pendingRow()))
    await handlePending(createdEvent(), ctxWith(pendingRow()))

    const keys = createForFeature.mock.calls.map(
      (call) => (call[0] as unknown as Record<string, unknown>).groupKey,
    )
    expect(new Set(keys).size).toBe(1)
    expect(keys[0]).toBe(`agent_orchestrator.proposal.pending:${PROPOSAL}`)
  })

  it('stays silent when a rule already approved the proposal', async () => {
    await handlePending(createdEvent(), ctxWith(pendingRow({ disposition: 'auto_approved' })))
    expect(createForFeature).not.toHaveBeenCalled()
  })

  it('stays silent when the agent proposed nothing', async () => {
    await handlePending(createdEvent(), ctxWith(pendingRow({ disposition: 'none_proposed' })))
    expect(createForFeature).not.toHaveBeenCalled()
  })

  it('stays silent for an eval replay, which is a record and not somebody’s work', async () => {
    await handlePending(createdEvent({ source: 'eval' }), ctxWith(pendingRow()))
    expect(createForFeature).not.toHaveBeenCalled()
  })

  it('stays silent when the proposal row is gone', async () => {
    await handlePending(createdEvent(), ctxWith(null))
    expect(createForFeature).not.toHaveBeenCalled()
  })

  it('stays silent when the event carries no scope', async () => {
    await handlePending(
      { id: PROPOSAL, source: 'runtime' },
      { resolve: () => undefined, tenantId: null, organizationId: null } as never,
    )
    expect(createForFeature).not.toHaveBeenCalled()
  })
})

describe('proposal disposed notification clear', () => {
  it('removes the pending notification once any verdict lands', async () => {
    await handleDisposed(
      { proposalId: PROPOSAL, disposition: 'approved', tenantId: TENANT, organizationId: ORG },
      ctxWith(null),
    )

    expect(deleteBySource).toHaveBeenCalledWith(
      'agent_orchestrator:agent_proposal',
      PROPOSAL,
      { tenantId: TENANT, organizationId: ORG },
    )
  })

  it('ignores an event with no proposal id', async () => {
    await handleDisposed({ tenantId: TENANT }, ctxWith(null))
    expect(deleteBySource).not.toHaveBeenCalled()
  })
})
