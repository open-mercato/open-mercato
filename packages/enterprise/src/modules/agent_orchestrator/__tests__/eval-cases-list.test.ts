/** @jest-environment node */
import {
  EVAL_CASE_LIST_FIELDS,
  buildEvalCaseListFilters,
  metadata as listMetadata,
} from '../api/eval-cases/route'
import { evalCaseListQuerySchema } from '../data/validators'

describe('GET /api/agent_orchestrator/eval-cases — gate', () => {
  it('requires auth and agent_orchestrator.eval.manage (matches the create route tier)', () => {
    expect(listMetadata.GET.requireAuth).toBe(true)
    expect(listMetadata.GET.requireFeatures).toEqual(['agent_orchestrator.eval.manage'])
  })
})

describe('eval-cases list — metadata-only projection', () => {
  it('selects exactly the seven metadata columns', () => {
    expect([...EVAL_CASE_LIST_FIELDS].sort()).toEqual(
      ['agent_definition_id', 'created_at', 'id', 'source_id', 'source_type', 'status', 'updated_at'].sort(),
    )
  })

  it('never selects the encrypted payload columns', () => {
    const fields = EVAL_CASE_LIST_FIELDS as readonly string[]
    for (const forbidden of ['input', 'expected', 'assertions', 'process_type', 'approved_by_user_id']) {
      expect(fields).not.toContain(forbidden)
    }
  })
})

describe('eval-cases list — filters', () => {
  const base = { page: 1, pageSize: 50 }

  it('maps status', () => {
    expect(buildEvalCaseListFilters({ ...base, status: 'draft' })).toEqual({ status: { $eq: 'draft' } })
  })

  it('maps agentDefinitionId', () => {
    expect(buildEvalCaseListFilters({ ...base, agentDefinitionId: 'deals.lead_triage' })).toEqual({
      agent_definition_id: { $eq: 'deals.lead_triage' },
    })
  })

  it('maps sourceType', () => {
    expect(buildEvalCaseListFilters({ ...base, sourceType: 'golden_run' })).toEqual({
      source_type: { $eq: 'golden_run' },
    })
  })

  it('combines all three and stays empty without any', () => {
    expect(
      buildEvalCaseListFilters({
        ...base,
        status: 'approved',
        agentDefinitionId: 'a',
        sourceType: 'correction',
      }),
    ).toEqual({
      status: { $eq: 'approved' },
      agent_definition_id: { $eq: 'a' },
      source_type: { $eq: 'correction' },
    })
    expect(buildEvalCaseListFilters({ ...base })).toEqual({})
  })
})

describe('eval-cases list — query schema', () => {
  it('defaults pagination and accepts valid filters', () => {
    const parsed = evalCaseListQuerySchema.parse({ status: 'archived', sourceType: 'correction' })
    expect(parsed.page).toBe(1)
    expect(parsed.pageSize).toBe(50)
    expect(parsed.status).toBe('archived')
  })

  it('caps pageSize at 100 and rejects unknown enum values', () => {
    expect(evalCaseListQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false)
    expect(evalCaseListQuerySchema.safeParse({ status: 'bogus' }).success).toBe(false)
    expect(evalCaseListQuerySchema.safeParse({ sourceType: 'bogus' }).success).toBe(false)
    expect(evalCaseListQuerySchema.safeParse({ pageSize: '100' }).success).toBe(true)
  })
})
