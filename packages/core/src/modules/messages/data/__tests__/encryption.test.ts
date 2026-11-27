import { defaultEncryptionMaps } from '../../encryption'

describe('messages defaultEncryptionMaps', () => {
  it('encrypts message PII fields and provides a deterministic hash for external_email lookup', () => {
    const entry = defaultEncryptionMaps.find((map) => map.entityId === 'messages:message')
    if (!entry) throw new Error('messages:message encryption map missing')

    const byField = new Map(entry.fields.map((field) => [field.field, field]))
    const encryptedFields = [
      'subject',
      'body',
      'external_email',
      'external_name',
      'action_data',
      'action_result',
    ]
    for (const field of encryptedFields) {
      expect(byField.has(field)).toBe(true)
    }
    expect(byField.get('external_email')?.hashField).toBe('external_email_hash')
    expect(byField.get('subject')?.hashField).toBeUndefined()
    expect(byField.get('body')?.hashField).toBeUndefined()
  })

  it('encrypts external participant addresses with a lookup hash for search', () => {
    const entry = defaultEncryptionMaps.find((map) => map.entityId === 'messages:message_external_participant')
    if (!entry) throw new Error('messages:message_external_participant encryption map missing')
    const byField = new Map(entry.fields.map((field) => [field.field, field]))
    expect(byField.get('email')?.hashField).toBe('email_hash')
    expect(byField.has('name')).toBe(true)
    expect(byField.get('name')?.hashField).toBeUndefined()
  })
})
