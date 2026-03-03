import { describe, expect, test } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/postgresql'
import { buildImmutableDecisionHash, createTelemetryService } from '../telemetry-service'
import type { DecisionTelemetryEnvelopeInput } from '../../data/validators'

function buildEnvelope(): DecisionTelemetryEnvelopeInput {
  return {
    tenantId: '7b9c4df8-6c8d-4a6f-9e1b-ef6513474ec4',
    organizationId: '2d4f44f8-c583-465a-bd30-6c901f4a7101',
    runId: null,
    stepId: 'test-step',
    actionType: 'test.action',
    targetEntity: 'agent_governance_policy',
    targetId: 'ab66436a-d5cd-4339-903f-6dfe6a96934f',
    sourceRefs: [],
    policyId: null,
    riskBandId: null,
    riskScore: null,
    controlPath: 'override',
    approverIds: [],
    exceptionIds: [],
    writeSet: { operation: 'test' },
    status: 'success',
    errorCode: null,
    harnessProvider: 'open_mercato',
    supersedesEventId: null,
    signature: null,
  }
}

describe('telemetry-service durability behavior', () => {
  test('fail_closed durability throws when persistence fails', async () => {
    const fakeEm = {
      create: (_entity: unknown, payload: Record<string, unknown>) => ({ ...payload, id: 'event-1' }),
      persist: (_event: unknown) => undefined,
      flush: async () => {
        throw new Error('flush failed')
      },
    } as unknown as EntityManager

    const service = createTelemetryService({ em: fakeEm })

    await expect(
      service.recordDecisionWithDurability(buildEnvelope(), {
        durability: 'fail_closed',
      }),
    ).rejects.toThrow('flush failed')
  })

  test('fail_soft durability repairs when first persistence fails', async () => {
    let flushCalls = 0
    const fakeEm = {
      create: (_entity: unknown, payload: Record<string, unknown>) => ({ ...payload, id: `event-${flushCalls + 1}` }),
      persist: (_event: unknown) => undefined,
      flush: async () => {
        flushCalls += 1
        if (flushCalls === 1) {
          throw new Error('first flush failed')
        }
      },
    } as unknown as EntityManager

    const service = createTelemetryService({ em: fakeEm })
    const result = await service.recordDecisionWithDurability(buildEnvelope(), {
      durability: 'fail_soft',
      repairCode: 'TEST_REPAIR',
    })

    expect(result.repairRequired).toBe(true)
    expect(result.degraded).toBe(true)
    expect(result.eventId).toBeTruthy()
  })

  test('fail_soft returns degraded null-event result when persistence keeps failing', async () => {
    const fakeEm = {
      create: (_entity: unknown, payload: Record<string, unknown>) => ({ ...payload, id: 'event-1' }),
      persist: (_event: unknown) => undefined,
      flush: async () => {
        throw new Error('flush failed always')
      },
    } as unknown as EntityManager

    const service = createTelemetryService({ em: fakeEm })
    const result = await service.recordDecisionWithDurability(buildEnvelope(), {
      durability: 'fail_soft',
      repairCode: 'TEST_REPAIR',
    })

    expect(result.repairRequired).toBe(true)
    expect(result.degraded).toBe(true)
    expect(result.eventId).toBeNull()
    expect(result.immutableHash).toBeNull()
  })

  test('verifyImmutableHash detects tampered decision payloads', () => {
    const fakeEm = {} as EntityManager
    const service = createTelemetryService({ em: fakeEm })
    const envelope = buildEnvelope()
    const immutableHash = buildImmutableDecisionHash(envelope)

    const event = {
      tenantId: envelope.tenantId,
      organizationId: envelope.organizationId,
      runId: envelope.runId,
      stepId: envelope.stepId,
      actionType: envelope.actionType,
      targetEntity: envelope.targetEntity,
      targetId: envelope.targetId,
      inputEvidence: envelope.sourceRefs,
      policyId: envelope.policyId,
      riskBandId: envelope.riskBandId,
      riskScore: envelope.riskScore,
      controlPath: envelope.controlPath,
      approverIds: envelope.approverIds,
      exceptionIds: envelope.exceptionIds,
      writeSet: envelope.writeSet,
      status: envelope.status,
      errorCode: envelope.errorCode,
      harnessProvider: envelope.harnessProvider,
      supersedesEventId: envelope.supersedesEventId,
      signature: envelope.signature,
      immutableHash,
    } as any

    expect(service.verifyImmutableHash(event)).toBe(true)
    expect(
      service.verifyImmutableHash({
        ...event,
        writeSet: { operation: 'tampered' },
      }),
    ).toBe(false)
  })
})
