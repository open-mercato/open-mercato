import {
  interactionCreateSchema,
  interactionUpdateSchema,
} from '../validators'

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const entityId = '33333333-3333-4333-8333-333333333333'
const interactionId = '44444444-4444-4444-8444-444444444444'
const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

describe('interaction validators — extended scheduling fields', () => {
  const basePayload = {
    tenantId,
    organizationId: orgId,
    interactionType: 'meeting',
    title: 'Kickoff',
    durationMinutes: 45,
    location: 'Room A',
    allDay: false,
    recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE',
    recurrenceEnd: '2026-05-01T00:00:00.000Z',
    participants: [
      { userId: userA, name: 'Ada', email: 'ada@example.com', status: 'accepted' },
      { userId: userB, name: 'Bob', status: 'pending' },
    ],
    reminderMinutes: 15,
    visibility: 'team',
    linkedEntities: [
      { id: entityId, type: 'company' as const, label: 'ACME' },
    ],
    guestPermissions: { canInviteOthers: true, canModify: false, canSeeList: true },
  }

  test('interactionCreateSchema preserves all extended fields', () => {
    const parsed = interactionCreateSchema.parse({ ...basePayload, entityId })
    expect(parsed.durationMinutes).toBe(45)
    expect(parsed.location).toBe('Room A')
    expect(parsed.allDay).toBe(false)
    expect(parsed.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO,WE')
    expect(parsed.recurrenceEnd).toBeInstanceOf(Date)
    expect(parsed.participants).toHaveLength(2)
    expect(parsed.participants?.[0].userId).toBe(userA)
    expect(parsed.reminderMinutes).toBe(15)
    expect(parsed.visibility).toBe('team')
    expect(parsed.linkedEntities).toEqual([
      { id: entityId, type: 'company', label: 'ACME' },
    ])
    expect(parsed.guestPermissions).toEqual({
      canInviteOthers: true,
      canModify: false,
      canSeeList: true,
    })
  })

  test('interactionUpdateSchema preserves all extended fields', () => {
    const parsed = interactionUpdateSchema.parse({ id: interactionId, ...basePayload })
    expect(parsed.id).toBe(interactionId)
    expect(parsed.durationMinutes).toBe(45)
    expect(parsed.location).toBe('Room A')
    expect(parsed.allDay).toBe(false)
    expect(parsed.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO,WE')
    expect(parsed.recurrenceEnd).toBeInstanceOf(Date)
    expect(parsed.participants?.map((p) => p.userId)).toEqual([userA, userB])
    expect(parsed.reminderMinutes).toBe(15)
    expect(parsed.visibility).toBe('team')
    expect(parsed.linkedEntities?.[0].type).toBe('company')
    expect(parsed.guestPermissions?.canInviteOthers).toBe(true)
  })

  test('interactionUpdateSchema treats omitted extended fields as undefined', () => {
    const parsed = interactionUpdateSchema.parse({
      id: interactionId,
      tenantId,
      organizationId: orgId,
      title: 'Just title',
    })
    expect(parsed.title).toBe('Just title')
    expect(parsed.durationMinutes).toBeUndefined()
    expect(parsed.location).toBeUndefined()
    expect(parsed.participants).toBeUndefined()
    expect(parsed.visibility).toBeUndefined()
    expect(parsed.linkedEntities).toBeUndefined()
    expect(parsed.guestPermissions).toBeUndefined()
  })

  test('interactionUpdateSchema allows null clears for nullable extended fields', () => {
    const parsed = interactionUpdateSchema.parse({
      id: interactionId,
      tenantId,
      organizationId: orgId,
      durationMinutes: null,
      location: null,
      allDay: null,
      recurrenceRule: null,
      recurrenceEnd: null,
      participants: null,
      reminderMinutes: null,
      visibility: null,
      linkedEntities: null,
      guestPermissions: null,
    })
    expect(parsed.durationMinutes).toBeNull()
    expect(parsed.location).toBeNull()
    expect(parsed.allDay).toBeNull()
    expect(parsed.recurrenceRule).toBeNull()
    expect(parsed.recurrenceEnd).toBeNull()
    expect(parsed.participants).toBeNull()
    expect(parsed.reminderMinutes).toBeNull()
    expect(parsed.visibility).toBeNull()
    expect(parsed.linkedEntities).toBeNull()
    expect(parsed.guestPermissions).toBeNull()
  })

  test('interactionUpdateSchema rejects invalid linked entity type', () => {
    expect(() =>
      interactionUpdateSchema.parse({
        id: interactionId,
        tenantId,
        organizationId: orgId,
        linkedEntities: [{ id: entityId, type: 'person', label: 'Nope' }],
      }),
    ).toThrow()
  })
})
