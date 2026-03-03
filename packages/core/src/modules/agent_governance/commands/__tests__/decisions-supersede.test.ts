import { beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { CommandBus } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'

const mockFindOneWithDecryption = jest.fn()
const mockEmitEvent = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('@open-mercato/core/modules/agent_governance/events', () => ({
  emitAgentGovernanceEvent: (...args: unknown[]) => mockEmitEvent(...args),
}))

describe('agent_governance decisions supersede command', () => {
  const commandBus = new CommandBus()

  const telemetryService = {
    recordDecisionWithDurability: jest.fn(),
  }

  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') {
        return {
          fork: jest.fn(() => ({})),
        }
      }
      if (name === 'agentGovernanceTelemetryService') return telemetryService
      return null
    }),
  }

  beforeAll(async () => {
    if (!commandRegistry.has('agent_governance.decisions.supersede')) {
      await import('../decisions')
    }
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('creates superseding decision event with append-only linkage', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce({
      id: 'dc87ca8b-f52f-4888-ab17-17c8e8dc17ec',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      runId: 'run-1',
      stepId: 'step-1',
      actionType: 'policy.update',
      targetEntity: 'agent_governance_policy',
      targetId: 'policy-1',
      inputEvidence: ['decision_event:event-1'],
      policyId: null,
      riskBandId: null,
      riskScore: null,
      controlPath: 'auto',
      approverIds: [],
      exceptionIds: [],
      writeSet: { old: true },
      status: 'success',
      errorCode: null,
      harnessProvider: 'opencode',
    })

    telemetryService.recordDecisionWithDurability.mockResolvedValue({
      eventId: 'new-event-1',
      immutableHash: 'hash',
      signature: 'sig',
      degraded: false,
      repairRequired: false,
    })

    const ctx = {
      container,
      auth: {
        sub: 'user-1',
        tenantId: 'tenant-1',
        orgId: 'org-1',
      },
      selectedOrganizationId: 'org-1',
      organizationScope: null,
      organizationIds: ['org-1'],
    }

    const result = await commandBus.execute('agent_governance.decisions.supersede', {
      input: {
        id: 'dc87ca8b-f52f-4888-ab17-17c8e8dc17ec',
        note: 'manual correction',
        writeSet: { corrected: true },
      },
      ctx,
    })

    expect(result.result).toEqual({
      decisionEventId: 'new-event-1',
      supersedesEventId: 'dc87ca8b-f52f-4888-ab17-17c8e8dc17ec',
    })

    expect(telemetryService.recordDecisionWithDurability).toHaveBeenCalledWith(
      expect.objectContaining({
        supersedesEventId: 'dc87ca8b-f52f-4888-ab17-17c8e8dc17ec',
        writeSet: expect.objectContaining({
          corrected: true,
          correctionNote: 'manual correction',
          supersededEventId: 'dc87ca8b-f52f-4888-ab17-17c8e8dc17ec',
        }),
      }),
      expect.objectContaining({ durability: 'fail_closed' }),
    )
  })
})
