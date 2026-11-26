import type { CommandExecutionContext } from '@open-mercato/shared/lib/commands'
import { dealMergeRequestSchema } from '../../data/validators'
import {
  dealMergeClosureOutcome,
  mergeDealsCommand,
  resolveDealMergeClosure,
  rewriteDealLinkedEntities,
} from '../deal-merge'

const survivorId = '11111111-1111-4111-8111-111111111111'
const sourceId = '22222222-2222-4222-8222-222222222222'

const validInput = {
  survivorId,
  sourceId,
  survivorUpdatedAt: '2026-11-24T10:00:00.000Z',
  sourceUpdatedAt: '2026-11-24T11:00:00.000Z',
  values: {
    title: 'Merged deal',
    description: null,
    status: 'open',
    pipelineStage: null,
    pipelineId: null,
    pipelineStageId: null,
    valueAmount: null,
    valueCurrency: null,
    probability: null,
    expectedCloseAt: null,
    ownerUserId: null,
    source: null,
    closureOutcome: null,
    lossReasonId: null,
    lossNotes: null,
  },
  customFields: {},
  personIds: [],
  companyIds: [],
  primaryPersonEntityId: null,
}

describe('customers.deals.merge command contract', () => {
  it('uses the stable additive command id and output contract', () => {
    expect(mergeDealsCommand.id).toBe('customers.deals.merge')
    expect(mergeDealsCommand.outputSchema?.parse({ survivorId, sourceId })).toEqual({ survivorId, sourceId })
  })

  it('rejects merging a Deal into itself before resolving request scope', async () => {
    await expect(mergeDealsCommand.execute(
      { ...validInput, sourceId: survivorId },
      {} as CommandExecutionContext,
    )).rejects.toMatchObject({ name: 'ZodError' })
  })

  it('rejects a primary person outside the resolved people set before writes', async () => {
    await expect(mergeDealsCommand.execute(
      { ...validInput, primaryPersonEntityId: '33333333-3333-4333-8333-333333333333' },
      {} as CommandExecutionContext,
    )).rejects.toMatchObject({ name: 'ZodError' })
  })
})

describe('dealMergeRequestSchema closure compatibility', () => {
  it.each([
    ['won', null, null, null],
    ['closed', null, null, null],
    ['lost', null, null, null],
    ['open', null, '55555555-5555-4555-8555-555555555555', 'leftover'],
  ])('accepts legacy status %s without a matching closureOutcome', (status, closureOutcome, lossReasonId, lossNotes) => {
    const result = dealMergeRequestSchema.safeParse({
      ...validInput,
      values: { ...validInput.values, status, closureOutcome, lossReasonId, lossNotes },
    })
    expect(result.success).toBe(true)
  })

  it('accepts a request without closureOutcome', () => {
    const { closureOutcome: _ignored, ...values } = validInput.values
    expect(dealMergeRequestSchema.safeParse({ ...validInput, values }).success).toBe(true)
  })

  it('keeps the pipeline/stage pairing rule', () => {
    const result = dealMergeRequestSchema.safeParse({
      ...validInput,
      values: { ...validInput.values, pipelineId: '55555555-5555-4555-8555-555555555555' },
    })
    expect(result.success).toBe(false)
  })
})

describe('resolveDealMergeClosure', () => {
  it.each([
    ['won', 'win', 'won'],
    ['Win', 'win', 'won'],
    ['lost', 'lost', 'lost'],
    ['loose', 'lost', 'lost'],
    ['closed', 'closed', null],
    ['open', 'open', null],
    ['custom-stage', 'custom-stage', null],
  ])('maps %s to status %s and outcome %s', (status, canonical, outcome) => {
    expect(dealMergeClosureOutcome(status)).toBe(outcome)
    const resolved = resolveDealMergeClosure({ status, lossReasonId: 'reason', lossNotes: 'notes' })
    expect(resolved.status).toBe(canonical)
    expect(resolved.closureOutcome).toBe(outcome)
    expect(resolved.lossReasonId).toBe(outcome === 'lost' ? 'reason' : null)
    expect(resolved.lossNotes).toBe(outcome === 'lost' ? 'notes' : null)
  })
})

describe('rewriteDealLinkedEntities', () => {
  const survivor = { id: survivorId, title: 'Survivor' }

  it('returns null when the source Deal is not linked', () => {
    expect(rewriteDealLinkedEntities([{ id: 'x', type: 'person', label: 'X' }], sourceId, survivor)).toBeNull()
    expect(rewriteDealLinkedEntities(null, sourceId, survivor)).toBeNull()
  })

  it('rewrites the source Deal to the survivor', () => {
    expect(rewriteDealLinkedEntities([
      { id: sourceId, type: 'deal', label: 'Source' },
      { id: 'p', type: 'person', label: 'P' },
    ], sourceId, survivor)).toEqual([
      { id: survivorId, type: 'deal', label: 'Survivor' },
      { id: 'p', type: 'person', label: 'P' },
    ])
  })

  it('matches the source and survivor chips regardless of letter case', () => {
    expect(rewriteDealLinkedEntities([
      { id: survivorId.toUpperCase(), type: 'deal', label: 'Kept' },
      { id: sourceId.toUpperCase(), type: 'deal', label: 'Source' },
    ], sourceId, survivor)).toEqual([{ id: survivorId.toUpperCase(), type: 'deal', label: 'Kept' }])
    expect(rewriteDealLinkedEntities([{ id: sourceId.toUpperCase(), type: 'deal', label: 'Source' }], sourceId, survivor))
      .toEqual([{ id: survivorId, type: 'deal', label: 'Survivor' }])
  })

  it('deduplicates when the survivor is already linked', () => {
    expect(rewriteDealLinkedEntities([
      { id: survivorId, type: 'deal', label: 'Kept' },
      { id: sourceId, type: 'deal', label: 'Source' },
      { id: sourceId, type: 'deal', label: 'Source again' },
    ], sourceId, survivor)).toEqual([{ id: survivorId, type: 'deal', label: 'Kept' }])
  })
})
