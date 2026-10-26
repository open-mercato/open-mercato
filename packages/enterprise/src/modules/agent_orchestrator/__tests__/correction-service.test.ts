import type { EntityManager } from '@mikro-orm/postgresql'
import { recordCorrection } from '../lib/trace/correctionService'
import { AgentCorrection, AgentEvalCase } from '../data/entities'

/** Minimal in-memory EntityManager fake (create/persist/flush). See trace-ingestion-service.test.ts. */
function createFakeEm() {
  const stores = new Map<unknown, Array<Record<string, unknown>>>()
  const pending: Array<Record<string, unknown>> = []
  let idSeq = 0
  const storeFor = (entity: unknown) => {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }
  const em = {
    create(entity: unknown, data: Record<string, unknown>) {
      const row: Record<string, unknown> = { ...data, __entity: entity }
      return row
    },
    persist(row: Record<string, unknown>) {
      pending.push(row)
      return em
    },
    async flush() {
      for (const row of pending.splice(0)) {
        if (!row.id) row.id = `id-${++idSeq}`
        const store = storeFor((row as { __entity?: unknown }).__entity)
        if (!store.includes(row)) store.push(row)
      }
    },
  }
  return { em: em as unknown as EntityManager, storeFor }
}

const BASE = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  proposalId: 'prop-1',
  agentRunId: 'run-1',
  agentDefinitionId: 'deals.health_check',
  correctedByUserId: 'user-1',
  evalInput: { dealId: 'd1' },
}

describe('recordCorrection', () => {
  it('writes the correction and auto-drafts a linked draft eval case (edit)', async () => {
    const { em, storeFor } = createFakeEm()
    const result = await recordCorrection(em, {
      ...BASE,
      action: 'edit',
      proposedValue: { stage: 'won' },
      correctedValue: { stage: 'lost' },
      reason: 'wrong stage',
    })

    const corrections = storeFor(AgentCorrection)
    const cases = storeFor(AgentEvalCase)
    expect(corrections).toHaveLength(1)
    expect(cases).toHaveLength(1)
    expect(result.correctionId).toBe(corrections[0].id)
    expect(result.evalCaseId).toBe(cases[0].id)

    // Correction is linked to the drafted case; case captures input + corrected expected.
    expect(corrections[0].evalCaseId).toBe(cases[0].id)
    expect(corrections[0].reason).toBe('wrong stage')
    expect(cases[0].status).toBe('draft')
    expect(cases[0].sourceType).toBe('correction')
    expect(cases[0].sourceId).toBe(corrections[0].id)
    expect(cases[0].input).toEqual({ dealId: 'd1' })
    expect(cases[0].expected).toEqual({ stage: 'lost' })
  })

  it('drafts a case with null expected for a reject', async () => {
    const { em, storeFor } = createFakeEm()
    await recordCorrection(em, {
      ...BASE,
      action: 'reject',
      proposedValue: { stage: 'won' },
      correctedValue: null,
      reason: 'not actionable',
    })
    expect(storeFor(AgentEvalCase)[0].expected).toBeNull()
  })

  it('rejects an empty reason (mandatory backstop)', async () => {
    const { em } = createFakeEm()
    await expect(
      recordCorrection(em, {
        ...BASE,
        action: 'edit',
        proposedValue: {},
        correctedValue: {},
        reason: '   ',
      }),
    ).rejects.toThrow(/reason is required/)
  })
})
