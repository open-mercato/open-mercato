import { describe, it, expect } from '@jest/globals'
import { interactionCreateSchema, interactionUpdateSchema } from '../data/validators'

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
      date: '2026-07-20',
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
