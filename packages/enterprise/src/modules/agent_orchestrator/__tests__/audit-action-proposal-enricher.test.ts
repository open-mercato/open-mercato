/** @jest-environment node */
import type { EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { AgentProposal } from '../data/entities'
import { auditActionProposalEnricher, enrichers } from '../data/enrichers'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const RUN = '33333333-3333-4333-8333-333333333333'
const PROPOSAL = '44444444-4444-4444-8444-444444444444'
const INSTANCE = '55555555-5555-4555-8555-555555555555'
const OTHER_INSTANCE = '66666666-6666-4666-8666-666666666666'

const proposals = [{ id: PROPOSAL, tenantId: TENANT, organizationId: ORG, runId: RUN, agentId: 'support.triage', workflowInstanceId: INSTANCE }]

const em = { fork: jest.fn(() => ({})) }

function context(overrides: Partial<EnricherContext> = {}): EnricherContext {
  return { tenantId: TENANT, organizationId: ORG, userId: 'user-1', em, container: {}, ...overrides }
}

function row(id: string, correlation?: Record<string, unknown>) {
  return { id, commandId: 'customers.deals.update', context: correlation ? { correlation } : null }
}

async function mockStore() {
  const { findWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')
  const mock = findWithDecryption as jest.Mock
  mock.mockImplementation(
    async (_em: unknown, entity: unknown, where: { id: { $in: string[] }; tenantId: string; organizationId?: string }) =>
      entity === AgentProposal
        ? proposals.filter(
            (proposal) =>
              where.id.$in.includes(proposal.id) &&
              proposal.tenantId === where.tenantId &&
              (!where.organizationId || proposal.organizationId === where.organizationId),
          )
        : [],
  )
  return mock
}

describe('auditActionProposalEnricher', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('targets core audit action rows, is feature-gated, namespaced and never served from the list cache', () => {
    expect(enrichers).toContain(auditActionProposalEnricher)
    expect(auditActionProposalEnricher.targetEntity).toBe('audit_logs.action_log')
    expect(auditActionProposalEnricher.features).toEqual(['agent_orchestrator.proposals.view'])
    expect(auditActionProposalEnricher.cacheableOnListHit).toBe(false)
    expect(auditActionProposalEnricher.fallback).toEqual({ _agent_orchestrator: { proposalVerified: false } })
  })

  it('marks only proposal ids backed by the same workflow instance or run as verified, in one scoped batch', async () => {
    const find = await mockStore()
    const records = [
      row('effector-ok', { proposalId: PROPOSAL, workflowInstanceId: INSTANCE }),
      row('effector-forged', { proposalId: PROPOSAL, workflowInstanceId: OTHER_INSTANCE }),
      row('disposition', { proposalId: PROPOSAL, agentRunId: RUN }),
      row('bare', { proposalId: PROPOSAL }),
      row('human'),
    ]

    const enriched = await auditActionProposalEnricher.enrichMany!(records, context())

    expect(enriched.map((record) => [record.id, record._agent_orchestrator.proposalVerified])).toEqual([
      ['effector-ok', true],
      ['effector-forged', false],
      ['disposition', true],
      ['bare', false],
      ['human', false],
    ])
    expect(find).toHaveBeenCalledTimes(1)
    expect(find.mock.calls[0][2]).toMatchObject({ tenantId: TENANT, organizationId: ORG })
  })

  it('scopes to the tenant only when the audit list spans organizations', async () => {
    const find = await mockStore()

    await auditActionProposalEnricher.enrichMany!(
      [row('effector-ok', { proposalId: PROPOSAL, workflowInstanceId: INSTANCE })],
      context({ organizationId: '' }),
    )

    expect(find.mock.calls[0][2]).toEqual({ id: { $in: [PROPOSAL] }, tenantId: TENANT })
  })

  it('queries nothing when no row carries a proposal id or the tenant is unknown', async () => {
    const find = await mockStore()

    const humanOnly = await auditActionProposalEnricher.enrichMany!([row('human')], context())
    const noTenant = await auditActionProposalEnricher.enrichMany!(
      [row('effector-ok', { proposalId: PROPOSAL, workflowInstanceId: INSTANCE })],
      context({ tenantId: '' }),
    )

    expect(humanOnly[0]._agent_orchestrator.proposalVerified).toBe(false)
    expect(noTenant[0]._agent_orchestrator.proposalVerified).toBe(false)
    expect(find).not.toHaveBeenCalled()
  })

  it('enriches a single row the same way', async () => {
    await mockStore()

    const enriched = await auditActionProposalEnricher.enrichOne(
      row('effector-ok', { proposalId: PROPOSAL, workflowInstanceId: INSTANCE }),
      context(),
    )

    expect(enriched._agent_orchestrator.proposalVerified).toBe(true)
  })
})
