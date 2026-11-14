import {
  extractPatchMemberIds,
  parseScimGroupFilter,
  parseScimGroupPatchOperations,
  scimGroupPayloadSchema,
} from '../scim-group'

describe('SCIM group compatibility', () => {
  const memberId = '11111111-1111-4111-8111-111111111111'

  it('accepts an Entra-compatible group payload', () => {
    const parsed = scimGroupPayloadSchema.parse({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
      externalId: 'entra-group-1',
      displayName: 'Finance',
      members: [{ value: memberId, $ref: null }],
    })

    expect(parsed.displayName).toBe('Finance')
    expect(parsed.members).toEqual([expect.objectContaining({ value: memberId })])
  })

  it('parses Entra add and filtered remove membership operations', () => {
    const operations = parseScimGroupPatchOperations({
      Operations: [
        { op: 'Add', path: 'members', value: [{ value: memberId }] },
        { op: 'Remove', path: `members[value eq "${memberId}"]` },
      ],
    })

    expect(extractPatchMemberIds(operations[0]!)).toEqual([memberId])
    expect(extractPatchMemberIds(operations[1]!)).toEqual([memberId])
  })

  it('parses group discovery filters case-insensitively', () => {
    expect(parseScimGroupFilter('displayName EQ "Finance"')).toEqual({
      field: 'displayName',
      value: 'Finance',
    })
    expect(parseScimGroupFilter(`members.value eq '${memberId}'`)).toEqual({
      field: 'members.value',
      value: memberId,
    })
  })
})
