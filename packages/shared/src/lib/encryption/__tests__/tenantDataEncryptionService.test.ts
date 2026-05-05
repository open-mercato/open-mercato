import { encryptWithAesGcm } from '../aes'
import {
  TenantDataEncryptionService,
  parseDecryptedFieldValue,
} from '../tenantDataEncryptionService'

const fixedKey = Buffer.alloc(32, 1).toString('base64')

describe('parseDecryptedFieldValue', () => {
  it('keeps purely-numeric strings as strings (regression: issue #1734)', () => {
    expect(parseDecryptedFieldValue('123')).toBe('123')
    expect(parseDecryptedFieldValue('00042')).toBe('00042')
    expect(parseDecryptedFieldValue('-9.5')).toBe('-9.5')
  })

  it('keeps boolean-like and null-like text as strings', () => {
    expect(parseDecryptedFieldValue('true')).toBe('true')
    expect(parseDecryptedFieldValue('false')).toBe('false')
    expect(parseDecryptedFieldValue('null')).toBe('null')
  })

  it('keeps ordinary text untouched', () => {
    expect(parseDecryptedFieldValue('Acme Corp')).toBe('Acme Corp')
    expect(parseDecryptedFieldValue('')).toBe('')
  })

  it('parses JSON objects and arrays back to structured values', () => {
    expect(parseDecryptedFieldValue('{"a":1,"b":"x"}')).toEqual({ a: 1, b: 'x' })
    expect(parseDecryptedFieldValue('[1,2,3]')).toEqual([1, 2, 3])
    expect(parseDecryptedFieldValue('[]')).toEqual([])
  })

  it('returns the raw text when the JSON-looking payload fails to parse', () => {
    expect(parseDecryptedFieldValue('{not json')).toBe('{not json')
    expect(parseDecryptedFieldValue('[broken')).toBe('[broken')
  })
})

describe('TenantDataEncryptionService.decryptFields (issue #1734)', () => {
  function makeService() {
    type Anything = Record<string, unknown>
    const service = new TenantDataEncryptionService({} as never) as unknown as {
      decryptFields: (
        obj: Anything,
        fields: { field: string }[],
        dek: { key: string },
      ) => Anything
    }
    return service
  }

  function encrypt(value: string): string {
    return encryptWithAesGcm(value, fixedKey).value as string
  }

  it('preserves a numeric-string display name through encrypt/decrypt round-trip', () => {
    const service = makeService()
    const obj = { display_name: encrypt('123') }
    const out = service.decryptFields(obj, [{ field: 'display_name' }], { key: fixedKey } as never)
    expect(out.display_name).toBe('123')
    expect(typeof out.display_name).toBe('string')
  })

  it('preserves arbitrary text values through encrypt/decrypt round-trip', () => {
    const service = makeService()
    const obj = {
      display_name: encrypt('Acme Corp'),
      primary_email: encrypt('mail@example.com'),
    }
    const out = service.decryptFields(
      obj,
      [{ field: 'display_name' }, { field: 'primary_email' }],
      { key: fixedKey } as never,
    )
    expect(out.display_name).toBe('Acme Corp')
    expect(out.primary_email).toBe('mail@example.com')
  })

  it('still recovers JSON object payloads (audit_logs use case)', () => {
    const service = makeService()
    const payload = { actor: 'user-1', changes: { name: 'old → new' } }
    const obj = { context_json: encrypt(JSON.stringify(payload)) }
    const out = service.decryptFields(obj, [{ field: 'context_json' }], { key: fixedKey } as never)
    expect(out.context_json).toEqual(payload)
  })

  it('still recovers JSON array payloads', () => {
    const service = makeService()
    const arr = [{ id: 1 }, { id: 2 }]
    const obj = { thread_messages: encrypt(JSON.stringify(arr)) }
    const out = service.decryptFields(obj, [{ field: 'thread_messages' }], { key: fixedKey } as never)
    expect(out.thread_messages).toEqual(arr)
  })

  it('keeps boolean-like and null-like text strings as strings', () => {
    const service = makeService()
    const obj = {
      display_name: encrypt('true'),
      description: encrypt('null'),
    }
    const out = service.decryptFields(
      obj,
      [{ field: 'display_name' }, { field: 'description' }],
      { key: fixedKey } as never,
    )
    expect(out.display_name).toBe('true')
    expect(out.description).toBe('null')
  })
})
