/** @jest-environment node */
import {
  buildPhoneCallInteraction,
  buildPhoneCallInteractionKey,
  normalizePhoneDigits,
} from '../phoneCallInteractions'

describe('phone call interaction helpers', () => {
  it('normalizes phone numbers to digits and rejects short values', () => {
    expect(normalizePhoneDigits('+966 (50) 000-0000')).toBe('966500000000')
    expect(normalizePhoneDigits('12345')).toBeNull()
    expect(normalizePhoneDigits(null)).toBeNull()
  })

  it('derives a stable UUID per call and person', () => {
    const first = buildPhoneCallInteractionKey('call-1', 'person-1')
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(buildPhoneCallInteractionKey('call-1', 'person-1')).toBe(first)
    expect(buildPhoneCallInteractionKey('call-1', 'person-2')).not.toBe(first)
  })

  it('builds a completed call activity with duration and recording', () => {
    const draft = buildPhoneCallInteraction({
      call: {
        id: 'call-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        providerKey: 'twilio',
        direction: 'inbound',
        startedAt: '2026-10-19T10:00:00.000Z',
        endedAt: '2026-10-19T10:03:20.000Z',
        durationSeconds: 200,
        recordingUrl: 'https://example.com/rec.mp3',
        participants: [{ role: 'caller', displayName: 'Sara', phoneNumber: '+966500000000' }],
      },
      personId: 'person-1',
    })
    expect(draft).toMatchObject({
      interactionType: 'call',
      title: 'Inbound call',
      status: 'done',
      durationMinutes: 4,
      source: 'phone_calls',
      channelProviderKey: 'twilio',
      body: 'Recording: https://example.com/rec.mp3',
    })
    expect(draft.occurredAt.toISOString()).toBe('2026-10-19T10:03:20.000Z')
    expect(draft.participants).toEqual([{ name: 'Sara', email: undefined }])
  })
})
