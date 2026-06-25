import { describe, it, expect } from '@jest/globals'
import {
  interactionCreateSchema,
  interactionUpdateSchema,
  personUpdateSchema,
  companyUpdateSchema,
} from '../data/validators'

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ENTITY_ID = '33333333-3333-4333-8333-333333333333'

describe('interactionCreateSchema validation (#1806, #1808)', () => {
  const baseValid = {
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    entityId: ENTITY_ID,
    interactionType: 'note' as const,
    title: 'Test',
    date: '2026-05-15',
    time: '10:00',
  }

  it('accepts a valid base payload (sanity)', () => {
    const result = interactionCreateSchema.safeParse(baseValid)
    expect(result.success).toBe(true)
  })

  it('rejects empty date (#1806)', () => {
    const result = interactionCreateSchema.safeParse({ ...baseValid, date: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('date'))).toBe(true)
    }
  })

  it('rejects empty time (#1806)', () => {
    const result = interactionCreateSchema.safeParse({ ...baseValid, time: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('time'))).toBe(true)
    }
  })

  it('rejects malformed phone on call activity (#1808)', () => {
    const result = interactionCreateSchema.safeParse({
      ...baseValid,
      interactionType: 'call' as const,
      phoneNumber: 'not-a-phone',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('phoneNumber'))).toBe(true)
    }
  })

  it('accepts E.164 phone on call activity (#1808)', () => {
    const result = interactionCreateSchema.safeParse({
      ...baseValid,
      interactionType: 'call' as const,
      phoneNumber: '+15555550100',
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty phone on call activity (#1808)', () => {
    const result = interactionCreateSchema.safeParse({
      ...baseValid,
      interactionType: 'call' as const,
      phoneNumber: '',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('phoneNumber'))).toBe(true)
    }
  })

  it('accepts call activity without phoneNumber (legacy callers compatibility)', () => {
    // Conservative scope for the #1808 fix: validate phone when present so the
    // "accepts any string" gap is closed, but do not retroactively require
    // phoneNumber on every call payload — that would break documented adapter
    // paths (legacy /api/customers/activities -> interaction bridge) and
    // existing API consumers.
    const result = interactionCreateSchema.safeParse({
      ...baseValid,
      interactionType: 'call' as const,
    })
    expect(result.success).toBe(true)
  })

  it('does not require phoneNumber on non-call activities', () => {
    const result = interactionCreateSchema.safeParse({ ...baseValid, interactionType: 'note' as const })
    expect(result.success).toBe(true)
  })
})

describe('interactionCreateSchema scheduledAt derivation (#1806 follow-up)', () => {
  const baseValid = {
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    entityId: ENTITY_ID,
    interactionType: 'meeting' as const,
    title: 'Test',
  }

  it('derives scheduledAt from date+time when scheduledAt is missing', () => {
    const result = interactionCreateSchema.safeParse({
      ...baseValid,
      date: '2026-05-15',
      time: '14:30',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.scheduledAt).toBeInstanceOf(Date)
      // Local time interpretation; assert the date and HH:MM components match.
      const derived = result.data.scheduledAt as Date
      expect(`${derived.getFullYear()}-${String(derived.getMonth() + 1).padStart(2, '0')}-${String(derived.getDate()).padStart(2, '0')}`).toBe('2026-05-15')
      expect(`${String(derived.getHours()).padStart(2, '0')}:${String(derived.getMinutes()).padStart(2, '0')}`).toBe('14:30')
    }
  })

  it('keeps explicit scheduledAt when both are provided (form-path)', () => {
    const explicit = new Date('2026-06-01T09:00:00Z')
    const result = interactionCreateSchema.safeParse({
      ...baseValid,
      date: '2026-05-15',
      time: '14:30',
      scheduledAt: explicit,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data.scheduledAt as Date).toISOString()).toBe(explicit.toISOString())
    }
  })

  it('does not derive scheduledAt when both date and time are missing', () => {
    const result = interactionCreateSchema.safeParse({
      ...baseValid,
      occurredAt: new Date('2026-04-01T10:00:00Z'),
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.scheduledAt).toBeUndefined()
    }
  })
})

describe('interactionUpdateSchema scheduledAt derivation', () => {
  const baseUpdate = {
    id: '44444444-4444-4444-8444-444444444444',
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
  }

  it('derives scheduledAt on update when only date+time supplied', () => {
    const result = interactionUpdateSchema.safeParse({
      ...baseUpdate,
      date: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
      time: '08:15',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.scheduledAt).toBeInstanceOf(Date)
    }
  })

  it('does not touch scheduledAt when caller omits date+time', () => {
    const result = interactionUpdateSchema.safeParse({
      ...baseUpdate,
      title: 'rename only',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.scheduledAt).toBeUndefined()
    }
  })

  it('preserves explicit scheduledAt: null (clear-the-date intent)', () => {
    const result = interactionUpdateSchema.safeParse({
      ...baseUpdate,
      scheduledAt: null,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.scheduledAt).toBeNull()
    }
  })
})

describe('person/company clearable URL & email update fields (#2526)', () => {
  const personBase = { id: ENTITY_ID, organizationId: ORG_ID, tenantId: TENANT_ID }
  const companyBase = { id: ENTITY_ID, organizationId: ORG_ID, tenantId: TENANT_ID }

  it('coerces empty-string URL/email person fields to null so the column can be cleared', () => {
    const result = personUpdateSchema.safeParse({
      ...personBase,
      linkedInUrl: '',
      twitterUrl: '',
      primaryEmail: '',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.linkedInUrl).toBeNull()
      expect(result.data.twitterUrl).toBeNull()
      expect(result.data.primaryEmail).toBeNull()
    }
  })

  it('accepts explicit null for person URL/email fields', () => {
    const result = personUpdateSchema.safeParse({
      ...personBase,
      linkedInUrl: null,
      twitterUrl: null,
      primaryEmail: null,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.linkedInUrl).toBeNull()
      expect(result.data.twitterUrl).toBeNull()
      expect(result.data.primaryEmail).toBeNull()
    }
  })

  it('treats whitespace-only URL/email person fields as a clear', () => {
    const result = personUpdateSchema.safeParse({
      ...personBase,
      linkedInUrl: '   ',
      primaryEmail: '   ',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.linkedInUrl).toBeNull()
      expect(result.data.primaryEmail).toBeNull()
    }
  })

  it('still validates non-empty person URL/email values', () => {
    expect(
      personUpdateSchema.safeParse({ ...personBase, linkedInUrl: 'not-a-url' }).success,
    ).toBe(false)
    expect(
      personUpdateSchema.safeParse({ ...personBase, primaryEmail: 'not-an-email' }).success,
    ).toBe(false)

    const ok = personUpdateSchema.safeParse({
      ...personBase,
      linkedInUrl: 'https://linkedin.com/in/ada',
      primaryEmail: 'ada@example.com',
    })
    expect(ok.success).toBe(true)
    if (ok.success) {
      expect(ok.data.linkedInUrl).toBe('https://linkedin.com/in/ada')
      expect(ok.data.primaryEmail).toBe('ada@example.com')
    }
  })

  it('omitting a person URL/email field leaves it undefined (no-op update)', () => {
    const result = personUpdateSchema.safeParse({ ...personBase })
    expect(result.success).toBe(true)
    if (result.success) {
      expect('linkedInUrl' in result.data).toBe(false)
      expect('primaryEmail' in result.data).toBe(false)
    }
  })

  it('coerces empty-string and null company website/email fields to null', () => {
    const empties = companyUpdateSchema.safeParse({
      ...companyBase,
      websiteUrl: '',
      primaryEmail: '',
    })
    expect(empties.success).toBe(true)
    if (empties.success) {
      expect(empties.data.websiteUrl).toBeNull()
      expect(empties.data.primaryEmail).toBeNull()
    }

    const nulls = companyUpdateSchema.safeParse({
      ...companyBase,
      websiteUrl: null,
      primaryEmail: null,
    })
    expect(nulls.success).toBe(true)
    if (nulls.success) {
      expect(nulls.data.websiteUrl).toBeNull()
      expect(nulls.data.primaryEmail).toBeNull()
    }
  })

  it('still validates non-empty company website/email values', () => {
    expect(
      companyUpdateSchema.safeParse({ ...companyBase, websiteUrl: 'not-a-url' }).success,
    ).toBe(false)
    expect(
      companyUpdateSchema.safeParse({ ...companyBase, primaryEmail: 'not-an-email' }).success,
    ).toBe(false)
  })

  it('coerces empty-string and null company domain to null (#2529)', () => {
    const empties = companyUpdateSchema.safeParse({ ...companyBase, domain: '' })
    expect(empties.success).toBe(true)
    if (empties.success) {
      expect(empties.data.domain).toBeNull()
    }

    const nulls = companyUpdateSchema.safeParse({ ...companyBase, domain: null })
    expect(nulls.success).toBe(true)
    if (nulls.success) {
      expect(nulls.data.domain).toBeNull()
    }

    const set = companyUpdateSchema.safeParse({ ...companyBase, domain: 'acme.com' })
    expect(set.success).toBe(true)
    if (set.success) {
      expect(set.data.domain).toBe('acme.com')
    }
  })
})

describe('company clearable plain-text & revenue update fields (#3050)', () => {
  const companyBase = { id: ENTITY_ID, organizationId: ORG_ID, tenantId: TENANT_ID }

  it('coerces empty-string legal/brand/size/description fields to null', () => {
    const result = companyUpdateSchema.safeParse({
      ...companyBase,
      legalName: '',
      brandName: '',
      sizeBucket: '',
      description: '',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.legalName).toBeNull()
      expect(result.data.brandName).toBeNull()
      expect(result.data.sizeBucket).toBeNull()
      expect(result.data.description).toBeNull()
    }
  })

  it('accepts explicit null for legal/brand/size/description fields', () => {
    const result = companyUpdateSchema.safeParse({
      ...companyBase,
      legalName: null,
      brandName: null,
      sizeBucket: null,
      description: null,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.legalName).toBeNull()
      expect(result.data.brandName).toBeNull()
      expect(result.data.sizeBucket).toBeNull()
      expect(result.data.description).toBeNull()
    }
  })

  it('treats whitespace-only plain-text fields as a clear', () => {
    const result = companyUpdateSchema.safeParse({ ...companyBase, legalName: '   ', description: '   ' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.legalName).toBeNull()
      expect(result.data.description).toBeNull()
    }
  })

  it('keeps non-empty plain-text values (trimmed)', () => {
    const result = companyUpdateSchema.safeParse({
      ...companyBase,
      legalName: '  Acme Corp.  ',
      brandName: 'Acme',
      sizeBucket: '11-50',
      description: 'B2B widgets',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.legalName).toBe('Acme Corp.')
      expect(result.data.brandName).toBe('Acme')
      expect(result.data.sizeBucket).toBe('11-50')
      expect(result.data.description).toBe('B2B widgets')
    }
  })

  it('clears annual revenue on empty-string/null without coercing to 0', () => {
    const empties = companyUpdateSchema.safeParse({ ...companyBase, annualRevenue: '' })
    expect(empties.success).toBe(true)
    if (empties.success) {
      expect(empties.data.annualRevenue).toBeNull()
    }

    const nulls = companyUpdateSchema.safeParse({ ...companyBase, annualRevenue: null })
    expect(nulls.success).toBe(true)
    if (nulls.success) {
      expect(nulls.data.annualRevenue).toBeNull()
    }
  })

  it('still coerces and validates a non-empty annual revenue', () => {
    const set = companyUpdateSchema.safeParse({ ...companyBase, annualRevenue: '1500000' })
    expect(set.success).toBe(true)
    if (set.success) {
      expect(set.data.annualRevenue).toBe(1500000)
    }

    expect(companyUpdateSchema.safeParse({ ...companyBase, annualRevenue: -5 }).success).toBe(false)
  })

  it('omitting a plain-text field leaves it undefined (no-op update)', () => {
    const result = companyUpdateSchema.safeParse({ ...companyBase })
    expect(result.success).toBe(true)
    if (result.success) {
      expect('legalName' in result.data).toBe(false)
      expect('annualRevenue' in result.data).toBe(false)
      expect('description' in result.data).toBe(false)
    }
  })
})
