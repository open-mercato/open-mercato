/** @jest-environment node */
import type { AwilixContainer } from 'awilix'

const findOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
}))

import { AgentWorkflowBridgeService } from '../lib/runtime/invokeAgentForWorkflow'
import { AgentProposal } from '../data/entities'
import type { AgentRuntimeService } from '../lib/runtime/agentRuntime'
import type { DispositionService } from '../lib/disposition/dispositionService'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const PROPOSAL_ID = '33333333-3333-4333-8333-333333333333'
const INSTANCE_ID = '44444444-4444-4444-8444-444444444444'

const forkedEm = { marker: 'forked-em' }
const em = { fork: jest.fn(() => forkedEm) }

function buildBridge(): AgentWorkflowBridgeService {
  const container = {
    resolve: (token: string) => {
      if (token === 'em') return em
      throw new Error(`Unexpected token: ${token}`)
    },
  } as unknown as AwilixContainer
  return new AgentWorkflowBridgeService({
    container,
    agentRuntime: {} as AgentRuntimeService,
    dispositionService: {} as DispositionService,
  })
}

const args = {
  proposalId: PROPOSAL_ID,
  workflowInstanceId: INSTANCE_ID,
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
}

describe('AgentWorkflowBridgeService.verifyProposalForInstance', () => {
  beforeEach(() => {
    findOneWithDecryption.mockReset()
    em.fork.mockClear()
  })

  it('confirms a proposal raised by the same instance, scoped to its tenant and organization', async () => {
    findOneWithDecryption.mockResolvedValue({ id: PROPOSAL_ID })

    await expect(buildBridge().verifyProposalForInstance(args)).resolves.toBe(true)

    expect(em.fork).toHaveBeenCalledTimes(1)
    expect(findOneWithDecryption).toHaveBeenCalledWith(
      forkedEm,
      AgentProposal,
      { id: PROPOSAL_ID, tenantId: TENANT_ID, organizationId: ORG_ID, workflowInstanceId: INSTANCE_ID },
      { fields: ['id'] },
      { tenantId: TENANT_ID, organizationId: ORG_ID },
    )
  })

  it('rejects a proposal of another instance or organization (no scoped match)', async () => {
    findOneWithDecryption.mockResolvedValue(null)

    await expect(buildBridge().verifyProposalForInstance(args)).resolves.toBe(false)
  })

  it.each([
    ['proposalId', { proposalId: 'not-a-uuid' }],
    ['workflowInstanceId', { workflowInstanceId: '' }],
    ['tenantId', { tenantId: 'tenant' }],
    ['organizationId', { organizationId: '' }],
  ])('refuses a malformed %s without querying', async (_field, override) => {
    await expect(buildBridge().verifyProposalForInstance({ ...args, ...override })).resolves.toBe(false)

    expect(findOneWithDecryption).not.toHaveBeenCalled()
  })
})
