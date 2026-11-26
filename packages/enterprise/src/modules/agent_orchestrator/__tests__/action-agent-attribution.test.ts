/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentProposal, AgentRun } from '../data/entities'
import { resolveActionAgentAttribution, resolveVerifiedProposalIds } from '../lib/identity/actionAgentAttribution'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG = '33333333-3333-4333-8333-333333333333'
const RUN = '44444444-4444-4444-8444-444444444444'
const PROPOSAL = '55555555-5555-4555-8555-555555555555'
const INSTANCE = '66666666-6666-4666-8666-666666666666'
const OTHER_INSTANCE = '77777777-7777-4777-8777-777777777777'
const FOREIGN_PROPOSAL = '88888888-8888-4888-8888-888888888888'
const FOREIGN_RUN = '99999999-9999-4999-8999-999999999999'

type Row = { id: string; tenantId: string; organizationId: string } & Record<string, unknown>

const runs: Row[] = [
  { id: RUN, tenantId: TENANT, organizationId: ORG, agentId: 'support.triage', agentVersion: 'sha256:0123456789abcdef' },
  { id: FOREIGN_RUN, tenantId: TENANT, organizationId: OTHER_ORG, agentId: 'other.agent', agentVersion: 'v9' },
]
const proposals: Row[] = [
  { id: PROPOSAL, tenantId: TENANT, organizationId: ORG, runId: RUN, agentId: 'support.triage', workflowInstanceId: INSTANCE },
  { id: FOREIGN_PROPOSAL, tenantId: TENANT, organizationId: OTHER_ORG, runId: FOREIGN_RUN, agentId: 'other.agent', workflowInstanceId: INSTANCE },
]

const em = {} as EntityManager
const scope = { tenantId: TENANT, organizationId: ORG }

async function mockStore() {
  const { findWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')
  const mock = findWithDecryption as jest.Mock
  mock.mockImplementation(
    async (_em: unknown, entity: unknown, where: { id: { $in: string[] }; tenantId: string; organizationId?: string }) => {
      const source = entity === AgentRun ? runs : entity === AgentProposal ? proposals : []
      return source.filter(
        (row) =>
          where.id.$in.includes(row.id) &&
          row.tenantId === where.tenantId &&
          (!where.organizationId || row.organizationId === where.organizationId),
      )
    },
  )
  return mock
}

describe('resolveActionAgentAttribution', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('prefers the agent and version stamped on the entry and loads nothing', async () => {
    const find = await mockStore()
    const [attribution] = await resolveActionAgentAttribution(em, scope, [
      { agentRunId: RUN, agentId: 'support.triage', agentVersion: '2.1.0' },
    ])
    expect(attribution).toEqual({ agentId: 'support.triage', agentVersion: '2.1.0', verifiedProposalId: null })
    expect(find).not.toHaveBeenCalled()
  })

  it('reads the agent and version from the entry run', async () => {
    await mockStore()
    const [attribution] = await resolveActionAgentAttribution(em, scope, [{ agentRunId: RUN }])
    expect(attribution).toEqual({ agentId: 'support.triage', agentVersion: 'sha256:0123456789abcdef', verifiedProposalId: null })
  })

  it('attributes an effector write through a proposal of the same workflow instance', async () => {
    await mockStore()
    const [attribution] = await resolveActionAgentAttribution(em, scope, [
      { proposalId: PROPOSAL, workflowInstanceId: INSTANCE },
    ])
    expect(attribution).toEqual({ agentId: 'support.triage', agentVersion: 'sha256:0123456789abcdef', verifiedProposalId: PROPOSAL })
  })

  it('refuses a proposal id that belongs to another workflow instance', async () => {
    await mockStore()
    const [attribution] = await resolveActionAgentAttribution(em, scope, [
      { proposalId: PROPOSAL, workflowInstanceId: OTHER_INSTANCE },
    ])
    expect(attribution).toEqual({ agentId: null, agentVersion: null, verifiedProposalId: null })
  })

  it('refuses a proposal id without a workflow instance to check it against', async () => {
    const find = await mockStore()
    const [attribution] = await resolveActionAgentAttribution(em, scope, [{ proposalId: PROPOSAL }])
    expect(attribution).toEqual({ agentId: null, agentVersion: null, verifiedProposalId: null })
    expect(find).not.toHaveBeenCalled()
  })

  it('scopes both attribution queries to the approved organizations', async () => {
    const find = await mockStore()
    const organizationIds = [ORG, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']
    await resolveActionAgentAttribution(em, { tenantId: TENANT, organizationId: null, organizationIds }, [
      { proposalId: PROPOSAL, agentRunId: RUN },
    ])

    expect(find.mock.calls.map(([, entity, where]) => [entity, where.organizationId])).toEqual([
      [AgentProposal, { $in: organizationIds }],
      [AgentRun, { $in: organizationIds }],
    ])
  })

  it('never reaches a proposal or run in another organization', async () => {
    const find = await mockStore()
    const attributions = await resolveActionAgentAttribution(em, scope, [
      { proposalId: FOREIGN_PROPOSAL, workflowInstanceId: INSTANCE },
      { agentRunId: FOREIGN_RUN },
    ])
    expect(attributions).toEqual([
      { agentId: null, agentVersion: null, verifiedProposalId: null },
      { agentId: null, agentVersion: null, verifiedProposalId: null },
    ])
    for (const call of find.mock.calls) {
      expect(call[2]).toMatchObject({ tenantId: TENANT, organizationId: ORG })
    }
  })

  it('ignores ids that are not uuids and leaves a human-only entry empty', async () => {
    const find = await mockStore()
    const attributions = await resolveActionAgentAttribution(em, scope, [
      { agentRunId: 'not-a-uuid' },
      { proposalId: 'nope', workflowInstanceId: INSTANCE },
      {},
    ])
    expect(attributions).toEqual([
      { agentId: null, agentVersion: null, verifiedProposalId: null },
      { agentId: null, agentVersion: null, verifiedProposalId: null },
      { agentId: null, agentVersion: null, verifiedProposalId: null },
    ])
    expect(find).not.toHaveBeenCalled()
  })

  it('uses preloaded runs and proposals without querying them again', async () => {
    const find = await mockStore()
    const [viaProposal, viaRun] = await resolveActionAgentAttribution(
      em,
      scope,
      [{ proposalId: PROPOSAL, workflowInstanceId: INSTANCE }, { agentRunId: RUN }],
      {
        runs: [{ id: RUN, agentId: 'support.triage', agentVersion: 'v1' }],
        proposals: [{ id: PROPOSAL, runId: RUN, agentId: 'support.triage', workflowInstanceId: INSTANCE }],
      },
    )
    expect(viaProposal).toEqual({ agentId: 'support.triage', agentVersion: 'v1', verifiedProposalId: PROPOSAL })
    expect(viaRun).toEqual({ agentId: 'support.triage', agentVersion: 'v1', verifiedProposalId: null })
    expect(find).not.toHaveBeenCalled()
  })

  it('scopes to the tenant only when the caller has no organization', async () => {
    const find = await mockStore()
    await resolveActionAgentAttribution(em, { tenantId: TENANT, organizationId: null }, [{ agentRunId: RUN }])
    expect(find.mock.calls[0][2]).toEqual({ id: { $in: [RUN] }, tenantId: TENANT })
  })

  it('verifies the proposal id of a disposition write through the run it names', async () => {
    await mockStore()
    const [attribution] = await resolveActionAgentAttribution(em, scope, [{ agentRunId: RUN, proposalId: PROPOSAL }])
    expect(attribution).toEqual({ agentId: 'support.triage', agentVersion: 'sha256:0123456789abcdef', verifiedProposalId: PROPOSAL })
  })

  it('refuses a proposal id paired with a run that did not produce it', async () => {
    await mockStore()
    const [attribution] = await resolveActionAgentAttribution(em, scope, [
      { agentRunId: FOREIGN_RUN, proposalId: PROPOSAL },
    ])
    expect(attribution.verifiedProposalId).toBeNull()
  })
})

describe('resolveVerifiedProposalIds', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('verifies only proposals anchored to their own run or workflow instance and loads no runs', async () => {
    const find = await mockStore()
    const verified = await resolveVerifiedProposalIds(em, scope, [
      { proposalId: PROPOSAL, workflowInstanceId: INSTANCE },
      { proposalId: PROPOSAL, workflowInstanceId: OTHER_INSTANCE },
      { proposalId: PROPOSAL, agentRunId: RUN },
      { proposalId: FOREIGN_PROPOSAL, workflowInstanceId: INSTANCE },
      { proposalId: PROPOSAL },
      {},
    ])
    expect(verified).toEqual([PROPOSAL, null, PROPOSAL, null, null, null])
    expect(find).toHaveBeenCalledTimes(1)
    expect(find.mock.calls[0][1]).toBe(AgentProposal)
    expect(find.mock.calls[0][2]).toMatchObject({ tenantId: TENANT, organizationId: ORG })
  })

  it('queries nothing when no entry carries an anchored proposal id', async () => {
    const find = await mockStore()
    const verified = await resolveVerifiedProposalIds(em, scope, [{ agentRunId: RUN }, { proposalId: PROPOSAL }])
    expect(verified).toEqual([null, null])
    expect(find).not.toHaveBeenCalled()
  })
})
