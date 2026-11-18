/** @jest-environment node */
import {
  legalMatterCreateSchema,
  legalMatterListQuerySchema,
  legalMatterUpdateSchema,
} from '../data/validators'

const DOCUMENT_ID = '3f0b8f4e-7c55-4f4e-9d61-2f8a0c1b5d10'

describe('legal_review validators', () => {
  it('applies defaults and normalizes a minimal matter', () => {
    const parsed = legalMatterCreateSchema.parse({
      documentId: DOCUMENT_ID,
      reference: ' LG-1042 ',
      counterparty: 'Northwind Traders',
      jurisdiction: 'de',
      purpose: '   ',
    })
    expect(parsed).toMatchObject({
      reference: 'LG-1042',
      counterparty: 'Northwind Traders',
      jurisdiction: 'DE',
      purpose: null,
      agreementType: 'mutual_nda',
      paper: 'counterparty',
      stage: 'requested',
      dueAt: null,
    })
  })

  it('parses an ISO due date into a Date', () => {
    const parsed = legalMatterCreateSchema.parse({
      documentId: DOCUMENT_ID,
      reference: 'LG-1043',
      counterparty: 'Contoso Ltd',
      dueAt: '2026-11-20T12:00:00.000Z',
    })
    expect(parsed.dueAt).toBeInstanceOf(Date)
    expect(parsed.dueAt?.toISOString()).toBe('2026-11-20T12:00:00.000Z')
  })

  it('rejects unknown agreement types, paper sides, stages and bad jurisdictions', () => {
    const base = { documentId: DOCUMENT_ID, reference: 'LG-1', counterparty: 'Contoso Ltd' }
    expect(legalMatterCreateSchema.safeParse({ ...base, agreementType: 'msa' }).success).toBe(false)
    expect(legalMatterCreateSchema.safeParse({ ...base, paper: 'theirs' }).success).toBe(false)
    expect(legalMatterCreateSchema.safeParse({ ...base, stage: 'done' }).success).toBe(false)
    expect(legalMatterCreateSchema.safeParse({ ...base, jurisdiction: 'DEU' }).success).toBe(false)
    expect(legalMatterCreateSchema.safeParse({ ...base, documentId: 'not-a-uuid' }).success).toBe(false)
  })

  it('requires an id on update and leaves omitted fields undefined', () => {
    expect(legalMatterUpdateSchema.safeParse({ stage: 'review' }).success).toBe(false)
    const parsed = legalMatterUpdateSchema.parse({ id: DOCUMENT_ID, stage: 'review' })
    expect(parsed.stage).toBe('review')
    expect(parsed.counterparty).toBeUndefined()
    expect(parsed.dueAt).toBeUndefined()
  })

  it('caps the list page size at 100', () => {
    expect(legalMatterListQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false)
    expect(legalMatterListQuerySchema.parse({ documentId: DOCUMENT_ID }).pageSize).toBe(50)
  })
})
