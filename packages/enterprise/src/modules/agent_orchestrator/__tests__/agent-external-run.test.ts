import { MetadataStorage } from '@mikro-orm/core'
import { agentExternalRunSchema, agentExternalRunStatusSchema } from '../data/validators'
import { defaultEncryptionMaps } from '../encryption'
import * as agentOrchestratorEntities from '../data/entities'

/**
 * The correlation row a suspended external run is resumed through
 * (`.ai/specs/enterprise/agent-orchestrator/next/2026-08-12-external-agent-invocation-analysis.md`
 * §5.5). These are pure schema/metadata assertions — this module's unit suite
 * never connects to Postgres.
 */

const RUN_ID = '11111111-1111-4111-8111-111111111111'
const PROCESS_ID = '22222222-2222-4222-8222-222222222222'
const TOKEN_HASH = 'a'.repeat(64)

const wellFormed = {
  runId: RUN_ID,
  agentId: 'voice.owner_call',
  connectorId: 'elevenlabs.voice',
  callbackTokenHash: TOKEN_HASH,
  externalRunId: 'conv_01hxyz',
  processId: PROCESS_ID,
  stepId: 'call_owner',
  signalName: 'agent_orchestrator.proposal.ready',
  status: 'pending' as const,
  expiresAt: '2026-08-12T10:30:00.000Z',
  requestPayload: { toNumber: '+48000000000', brief: 'Critical alert on deal 42' },
}

describe('agentExternalRunSchema', () => {
  it('accepts a well-formed suspended row', () => {
    const parsed = agentExternalRunSchema.safeParse(wellFormed)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.expiresAt).toBeInstanceOf(Date)
  })

  it('defaults a row with no declared status to pending', () => {
    const { status, ...withoutStatus } = wellFormed
    void status
    const parsed = agentExternalRunSchema.safeParse(withoutStatus)
    expect(parsed.success && parsed.data.status).toBe('pending')
  })

  it('rejects a status outside the single-shot lifecycle', () => {
    expect(agentExternalRunSchema.safeParse({ ...wellFormed, status: 'running' }).success).toBe(false)
    expect(agentExternalRunStatusSchema.safeParse('done').success).toBe(false)
    expect(agentExternalRunStatusSchema.options).toEqual([
      'pending',
      'completed',
      'failed',
      'expired',
      'cancelled',
    ])
  })

  it('rejects a callback token that is not a sha-256 hex digest', () => {
    expect(agentExternalRunSchema.safeParse({ ...wellFormed, callbackTokenHash: 'plaintext-token' }).success).toBe(false)
    expect(agentExternalRunSchema.safeParse({ ...wellFormed, callbackTokenHash: 'A'.repeat(64) }).success).toBe(false)
    expect(agentExternalRunSchema.safeParse({ ...wellFormed, callbackTokenHash: 'a'.repeat(63) }).success).toBe(false)
  })

  it('requires a deadline — a run with none could park a workflow forever', () => {
    const { expiresAt, ...withoutDeadline } = wellFormed
    void expiresAt
    expect(agentExternalRunSchema.safeParse(withoutDeadline).success).toBe(false)
  })

  it('accepts a non-workflow invocation but refuses a half-declared resume target', () => {
    const { processId, stepId, signalName, ...standalone } = wellFormed
    void processId
    void stepId
    void signalName
    expect(agentExternalRunSchema.safeParse(standalone).success).toBe(true)
    expect(agentExternalRunSchema.safeParse({ ...standalone, processId: PROCESS_ID }).success).toBe(false)
    expect(agentExternalRunSchema.safeParse({ ...wellFormed, signalName: undefined }).success).toBe(false)
  })
})

describe('AgentExternalRun persistence contract', () => {
  it('registers the entity under the id the encryption map keys on', () => {
    void agentOrchestratorEntities
    const registered = Object.values(MetadataStorage.getMetadata()).find(
      (meta) => (meta as { className?: string }).className === 'AgentExternalRun',
    ) as { tableName?: string } | undefined
    expect(registered?.tableName).toBe('agent_external_runs')
  })

  it('encrypts the PII-bearing payload columns and leaves the lookup digest queryable', () => {
    const map = defaultEncryptionMaps.find(
      (entry) => entry.entityId === 'agent_orchestrator:agent_external_run',
    )
    const fields = (map?.fields ?? []).map((field) => (typeof field === 'string' ? field : field.field))
    expect(fields).toEqual(['request_payload', 'result_payload', 'failure_reason'])
    expect(fields).not.toContain('callback_token_hash')
  })
})
