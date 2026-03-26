import { parseScimPatchOperations, ScimPatchError } from '../scim-patch'

describe('parseScimPatchOperations', () => {
  test('throws ScimPatchError if Operations is missing', () => {
    expect(() => parseScimPatchOperations({})).toThrow(ScimPatchError)
    expect(() => parseScimPatchOperations({})).toThrow('PatchOp body must contain Operations array')
  })

  test('throws ScimPatchError for unsupported op', () => {
    const body = { Operations: [{ op: 'move', path: 'active', value: true }] }
    expect(() => parseScimPatchOperations(body)).toThrow(ScimPatchError)
    expect(() => parseScimPatchOperations(body)).toThrow('Unsupported SCIM PatchOp: move')
  })

  test('parses replace operation with path', () => {
    const body = {
      Operations: [{ op: 'replace', path: 'active', value: true }],
    }
    const result = parseScimPatchOperations(body)
    expect(result).toEqual([{ op: 'replace', path: 'active', value: true }])
  })

  test('normalizes op to lowercase', () => {
    const body = {
      Operations: [{ op: 'Replace', path: 'active', value: true }],
    }
    expect(parseScimPatchOperations(body)[0].op).toBe('replace')

    const body2 = {
      Operations: [{ op: 'REPLACE', path: 'active', value: false }],
    }
    expect(parseScimPatchOperations(body2)[0].op).toBe('replace')
  })

  test('filters out unsupported paths silently', () => {
    const body = {
      Operations: [
        { op: 'replace', path: 'emails[type eq "work"].value', value: 'x@y.com' },
      ],
    }
    const result = parseScimPatchOperations(body)
    expect(result).toEqual([])
  })

  test('coerces active value to boolean', () => {
    const cases = [
      { input: 'False', expected: false },
      { input: 'True', expected: true },
      { input: 'false', expected: false },
      { input: 'true', expected: true },
    ]

    for (const { input, expected } of cases) {
      const body = {
        Operations: [{ op: 'replace', path: 'active', value: input }],
      }
      const result = parseScimPatchOperations(body)
      expect(result[0].value).toBe(expected)
    }
  })

  test('handles remove operation', () => {
    const body = {
      Operations: [{ op: 'remove', path: 'displayName' }],
    }
    const result = parseScimPatchOperations(body)
    expect(result).toEqual([{ op: 'remove', path: 'displayName', value: undefined }])
  })

  test('handles add operation', () => {
    const body = {
      Operations: [{ op: 'add', path: 'externalId', value: 'ext-456' }],
    }
    const result = parseScimPatchOperations(body)
    expect(result).toEqual([{ op: 'add', path: 'externalId', value: 'ext-456' }])
  })

  test('handles value object (no-path) with active boolean coercion', () => {
    const body = {
      Operations: [{ op: 'replace', value: { active: 'False', displayName: 'John' } }],
    }
    const result = parseScimPatchOperations(body)
    expect(result).toEqual([
      { op: 'replace', path: undefined, value: { active: false, displayName: 'John' } },
    ])
  })

  test('filters out no-ops with unsupported path and undefined value', () => {
    const body = {
      Operations: [
        { op: 'replace', path: 'urn:custom:attr', value: 'something' },
        { op: 'replace', path: 'active', value: true },
      ],
    }
    const result = parseScimPatchOperations(body)
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('active')
  })
})
