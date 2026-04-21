import { defaultEncryptionMaps } from '../../encryption'

describe('messages defaultEncryptionMaps', () => {
  it('encrypts message PII fields and provides a deterministic hash for external_email lookup', () => {
    expect(defaultEncryptionMaps).toHaveLength(1)
    const [entry] = defaultEncryptionMaps
    expect(entry.entityId).toBe('messages:message')

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
})
