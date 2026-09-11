import { mapStatus, normalizeTillioCall } from '../lib/normalizer'

const context = { operatorId: 'ringostat-1', plugin: 'Ringostat' as const }

const answeredCall = {
  id: 'pl5_-id1235453.9876543',
  date: '2026-05-26T14:07:23+0200',
  type: 'OUT',
  caller: '48579771838',
  destination: '48726861925',
  status: 'ANSWERED',
  waitTime: '10',
  billSec: '7',
  extraFields: {
    caller: '&quot;itrixcom_Kontakt&quot; &lt;itrixcom_Kontakt&gt;',
    has_recording: '1',
    recording: 'https://app.ringostat.com/recordings/pl5_-1779797243.25187642.wav?token=fajny_token',
    call_card: 'https://app.ringostat.com/project/callcards/card/pl5_-1779797243.25187642/?project_id=projekt_id',
  },
}

const missedCall = {
  id: 'kz1_-1775904448.9517822',
  date: '2026-04-11T12:47:28+0200',
  type: 'IN',
  caller: '48739109594',
  destination: '48579771838',
  status: 'NO FORWARD',
  waitTime: '1',
  billSec: '0',
  extraFields: {},
}

describe('mapStatus', () => {
  it('lets a billed call win over the textual status', () => {
    expect(mapStatus('NO ANSWER', 12)).toBe('answered')
  })

  it('maps the answered family', () => {
    for (const status of ['ANSWERED', 'PROPER', 'REPEATED', 'CONNECTED']) {
      expect(mapStatus(status, 0)).toBe('answered')
    }
  })

  it('maps the missed family', () => {
    for (const status of ['NO ANSWER', 'NO FORWARD', 'VOICEMAIL', 'NO EXTENSION', 'BUSY']) {
      expect(mapStatus(status, 0)).toBe('missed')
    }
  })

  it('maps a call that never got set up to failed', () => {
    expect(mapStatus('FAILED', 0)).toBe('failed')
  })

  it('falls back to unknown for statuses Tillio has not documented', () => {
    expect(mapStatus('SOMETHING NEW', 0)).toBe('unknown')
    expect(mapStatus(undefined, null)).toBe('unknown')
    expect(mapStatus('', 0)).toBe('unknown')
  })
})

describe('normalizeTillioCall', () => {
  it('maps an answered Ringostat call end to end', () => {
    const normalized = normalizeTillioCall(answeredCall, context)

    expect(normalized.externalCallId).toBe('pl5_-id1235453.9876543')
    expect(normalized.direction).toBe('outbound')
    expect(normalized.status).toBe('answered')
    expect(normalized.durationSeconds).toBe(7)
    expect(normalized.startedAt?.toISOString()).toBe('2026-05-26T12:07:23.000Z')
    expect(normalized.recording?.url).toContain('.wav')
    expect(normalized.participants).toEqual([
      { role: 'caller', phoneNumber: '48579771838', displayName: 'itrixcom_Kontakt' },
      { role: 'callee', phoneNumber: '48726861925' },
    ])
    expect(normalized.providerFacts).toMatchObject({
      tillioStatus: 'ANSWERED',
      tillioType: 'OUT',
      tillioWaitTimeSeconds: 10,
      operatorId: 'ringostat-1',
      plugin: 'Ringostat',
    })
    expect(normalized.rawPayload).toBe(answeredCall)
  })

  it('never invents answeredAt or endedAt', () => {
    const normalized = normalizeTillioCall(answeredCall, context)
    expect(normalized.answeredAt).toBeNull()
    expect(normalized.endedAt).toBeNull()
  })

  it('maps an inbound missed call without a recording', () => {
    const normalized = normalizeTillioCall(missedCall, context)
    expect(normalized.direction).toBe('inbound')
    expect(normalized.status).toBe('missed')
    expect(normalized.durationSeconds).toBe(0)
    expect(normalized.recording).toBeNull()
    expect(normalized.participants[0].displayName).toBeNull()
  })

  it('does not preserve decoded markup in a caller display name', () => {
    const normalized = normalizeTillioCall({
      ...answeredCall,
      extraFields: {
        ...answeredCall.extraFields,
        caller: '&quot;Safe caller&quot; &lt;script&gt;alert(1)&lt;/script&gt;',
      },
    }, context)

    expect(normalized.participants[0].displayName).toBe('Safe caller')
    expect(normalized.participants[0].displayName).not.toContain('<')
  })

  it('tolerates a missing waitTime, which Tillio does not always send', () => {
    const { waitTime: _waitTime, ...withoutWaitTime } = missedCall
    const normalized = normalizeTillioCall(withoutWaitTime, context)
    expect(normalized.providerFacts).not.toHaveProperty('tillioWaitTimeSeconds')
    expect(normalized.status).toBe('missed')
  })

  it('ignores a recording url when has_recording is not set', () => {
    const normalized = normalizeTillioCall(
      { ...answeredCall, extraFields: { ...answeredCall.extraFields, has_recording: '0' } },
      context,
    )
    expect(normalized.recording).toBeNull()
  })

  it('keeps the raw payload untouched for provider_facts remapping later', () => {
    const normalized = normalizeTillioCall(missedCall, context)
    expect(normalized.rawPayload).toEqual(missedCall)
  })

  it('maps an unknown call type to unknown direction', () => {
    const normalized = normalizeTillioCall({ ...missedCall, type: 'INTERNAL' }, context)
    expect(normalized.direction).toBe('unknown')
  })

  it('throws when the payload has no id', () => {
    const { id: _id, ...withoutId } = missedCall
    expect(() => normalizeTillioCall(withoutId, context)).toThrow()
  })
})
