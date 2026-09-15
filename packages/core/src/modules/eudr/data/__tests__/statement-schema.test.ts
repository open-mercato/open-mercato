/** @jest-environment node */

import { statementCreateSchema, statementUpdateSchema } from '../validators'

const baseCreate = { title: 'DDS create regression', commodity: 'coffee' as const }
const STATEMENT_ID = '11111111-1111-4111-8111-111111111111'

describe('eudr statement create schema — referenceIssuedAt is server-managed and not a create input (#5508)', () => {
  it('accepts an explicit null referenceIssuedAt and strips it from the parsed create payload', () => {
    const parsed = statementCreateSchema.parse({ ...baseCreate, referenceIssuedAt: null })
    expect('referenceIssuedAt' in parsed).toBe(false)
  })

  it('ignores a client-supplied referenceIssuedAt date-time on create instead of rejecting it', () => {
    const parsed = statementCreateSchema.parse({ ...baseCreate, referenceIssuedAt: '2026-08-01T10:00:00.000Z' })
    expect('referenceIssuedAt' in parsed).toBe(false)
  })

  it('drops a date-only referenceIssuedAt on create rather than surfacing a raw date-time validation error', () => {
    // A date without a time ('2026-08-01') previously reached the isoDateTime
    // validator and leaked a raw Zod issue to the client; the field is no longer
    // a create input, so it is stripped before validation runs.
    const parsed = statementCreateSchema.parse({ ...baseCreate, referenceIssuedAt: '2026-08-01' })
    expect('referenceIssuedAt' in parsed).toBe(false)
  })

  it('still creates with the required base fields once referenceIssuedAt is stripped', () => {
    const parsed = statementCreateSchema.parse({ ...baseCreate, referenceIssuedAt: null })
    expect(parsed.title).toBe(baseCreate.title)
    expect(parsed.commodity).toBe(baseCreate.commodity)
  })
})

describe('eudr statement create schema — server-computed fields tolerate a null no-op echo (#5508)', () => {
  it('accepts submittedAt: null (a whole-object echo of a draft) and strips it', () => {
    const parsed = statementCreateSchema.parse({ ...baseCreate, submittedAt: null })
    expect('submittedAt' in parsed).toBe(false)
  })

  it('still rejects a non-null submittedAt as a server-computed field', () => {
    expect(() => statementCreateSchema.parse({ ...baseCreate, submittedAt: '2026-08-01T10:00:00.000Z' })).toThrow()
  })
})

describe('eudr statement update schema — referenceIssuedAt remains a valid update input', () => {
  it('keeps accepting referenceIssuedAt on update (the submitted→available transition supplies it)', () => {
    const parsed = statementUpdateSchema.parse({ id: STATEMENT_ID, referenceIssuedAt: '2026-08-01T10:00:00.000Z' })
    expect(parsed.referenceIssuedAt instanceof Date).toBe(true)
  })

  it('keeps accepting an explicit null referenceIssuedAt on update', () => {
    const parsed = statementUpdateSchema.parse({ id: STATEMENT_ID, referenceIssuedAt: null })
    expect(parsed.referenceIssuedAt).toBeNull()
  })
})
