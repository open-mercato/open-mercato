import { defaultEncryptionMaps } from '../../encryption'

describe('messages defaultEncryptionMaps', () => {
  it('encrypts message body, subject, and external recipient PII', () => {
    const entry = defaultEncryptionMaps.find((m) => m.entityId === 'messages:message')
    expect(entry).toBeDefined()
    expect(entry!.fields).toEqual(expect.arrayContaining([
      { field: 'subject' },
      { field: 'body' },
      { field: 'external_email' },
      { field: 'external_name' },
    ]))
  })

  it('encrypts opaque action payloads attached to a message', () => {
    const entry = defaultEncryptionMaps.find((m) => m.entityId === 'messages:message')
    expect(entry).toBeDefined()
    expect(entry!.fields).toEqual(expect.arrayContaining([
      { field: 'action_data' },
      { field: 'action_result' },
    ]))
  })
})
