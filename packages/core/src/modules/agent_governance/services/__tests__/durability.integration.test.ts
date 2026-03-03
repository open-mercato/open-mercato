import { describe, expect, test } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { DecisionTelemetryEnvelopeInput, RunStartInput } from '../../data/validators'
import { createRunOrchestratorService } from '../run-orchestrator-service'
import type { TelemetryService } from '../telemetry-service'

type PersistedRecord = Record<string, unknown>

function createFakeEm() {
  let idCounter = 0
  const persisted: PersistedRecord[] = []

  const em = {
    create: (_entity: unknown, payload: Record<string, unknown>) => {
      idCounter += 1
      return {
        id: `record-${idCounter}`,
        ...payload,
      }
    },
    persist: (record: PersistedRecord) => {
      persisted.push(record)
    },
    flush: async () => undefined,
    findOne: async () => null,
    count: async () => 0,
  } as unknown as EntityManager

  return { em, persisted }
}

function createStartInput(overrides?: Partial<RunStartInput>): RunStartInput {
  return {
    tenantId: '53cb6d44-36a5-4744-9023-b095f4af7488',
    organizationId: '8f78540e-49e9-45e5-94ab-65ae1f053cc8',
    playbookId: null,
    policyId: null,
    riskBandId: null,
    autonomyMode: 'auto',
    actionType: 'sync_customer_state',
    targetEntity: 'customers:customer_entity',
    targetId: '95fd8937-adf2-49e2-9cf5-105145ce9b37',
    inputContext: null,
    riskScore: null,
    requireApproval: false,
    idempotencyKey: undefined,
    ...overrides,
  }
}

describe('run orchestrator durability integration', () => {
  test('high-risk fail-closed path blocks run start when telemetry persistence fails', async () => {
    const { em } = createFakeEm()
    const telemetry = {
      recordDecisionWithDurability: async (_input: DecisionTelemetryEnvelopeInput, options?: { durability?: 'fail_closed' | 'fail_soft' }) => {
        if (options?.durability === 'fail_closed') {
          throw new Error('telemetry persistence failed')
        }
        return {
          eventId: 'event-1',
          immutableHash: 'hash-1',
          signature: 'sig-1',
          degraded: false,
          repairRequired: false,
        }
      },
    } as unknown as TelemetryService

    const orchestrator = createRunOrchestratorService({ em, telemetryService: telemetry })

    const highRiskInput = createStartInput({
      actionType: 'terminate_contract',
      actionClass: 'irreversible',
    })

    await expect(orchestrator.startRun(highRiskInput, 'operator-1')).rejects.toThrow('telemetry persistence failed')
  })

  test('low-risk fail-soft path keeps run alive and marks repair required', async () => {
    const { em } = createFakeEm()
    const telemetry = {
      recordDecisionWithDurability: async (_input: DecisionTelemetryEnvelopeInput, options?: { durability?: 'fail_closed' | 'fail_soft' }) => {
        expect(options?.durability).toBe('fail_soft')
        return {
          eventId: null,
          immutableHash: null,
          signature: null,
          degraded: true,
          repairRequired: true,
        }
      },
    } as unknown as TelemetryService

    const orchestrator = createRunOrchestratorService({ em, telemetryService: telemetry })
    const lowRiskInput = createStartInput({
      actionType: 'view_customer_timeline',
      actionClass: 'read',
    })

    const result = await orchestrator.startRun(lowRiskInput, 'operator-2')

    expect(result.run.status).toBe('running')
    expect(result.telemetryRepairRequired).toBe(true)
    expect(result.approvalTaskId).toBeNull()
    expect(result.checkpointReasons).toHaveLength(0)
  })

  test('checkpoint path creates pending approval and records checkpoint reasons', async () => {
    const { em } = createFakeEm()
    const telemetry = {
      recordDecisionWithDurability: async () => ({
        eventId: 'event-2',
        immutableHash: 'hash-2',
        signature: 'sig-2',
        degraded: false,
        repairRequired: false,
      }),
    } as unknown as TelemetryService

    const orchestrator = createRunOrchestratorService({ em, telemetryService: telemetry })
    const checkpointInput = createStartInput({
      autonomyMode: 'propose',
      actionType: 'propose_policy_change',
      actionClass: 'write',
    })

    const result = await orchestrator.startRun(checkpointInput, 'operator-3')

    expect(result.run.status).toBe('checkpoint')
    expect(result.approvalTaskId).not.toBeNull()
    expect(result.checkpointReasons).toContain('autonomy_mode_propose')
  })
})
