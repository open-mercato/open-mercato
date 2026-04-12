import {
  classifyFields,
  extractHashOnlyFields,
  extractSearchableFields,
} from '../lib/field-policy'

describe('extractSearchableFields', () => {
  it('returns non-null fields when no policy is configured', () => {
    expect(
      extractSearchableFields({
        name: 'Acme',
        notes: 'Preferred customer',
        visits: 3,
        archivedAt: null,
        ownerId: undefined,
      }),
    ).toEqual({
      name: 'Acme',
      notes: 'Preferred customer',
      visits: 3,
    })
  })

  it('excludes encrypted, excluded, hash-only, and non-whitelisted fields', () => {
    expect(
      extractSearchableFields(
        {
          name: 'Acme',
          notes: 'Preferred customer',
          email: 'team@acme.test',
          phone: '+1-555-0100',
          ssn: '111-22-3333',
          encryptedButWhitelisted: 'top-secret',
          apiKey: 'secret',
          title: 'CEO',
          ignoredNull: null,
        },
        {
          encryptedFields: [
            { field: 'ssn' },
            { field: 'encryptedButWhitelisted', hashField: 'encrypted_but_whitelisted_hash' },
          ],
          fieldPolicy: {
            searchable: ['name', 'notes', 'email', 'encryptedButWhitelisted'],
            hashOnly: ['email', 'phone'],
            excluded: ['apiKey'],
          },
        },
      ),
    ).toEqual({
      name: 'Acme',
      notes: 'Preferred customer',
    })
  })
})

describe('extractHashOnlyFields', () => {
  it('returns the union of policy hash-only fields and encrypted fields with hash columns', () => {
    expect(
      extractHashOnlyFields(
        {
          name: 'Acme',
          email: 'team@acme.test',
          phone: '+1-555-0100',
          ssn: '111-22-3333',
          encryptedEmail: 'ciphertext',
          empty: null,
        },
        {
          encryptedFields: [
            { field: 'ssn' },
            { field: 'encryptedEmail', hashField: 'encrypted_email_hash' },
          ],
          fieldPolicy: {
            hashOnly: ['email', 'phone'],
          },
        },
      ),
    ).toEqual({
      email: 'team@acme.test',
      phone: '+1-555-0100',
      encryptedEmail: 'ciphertext',
    })
  })
})

describe('classifyFields', () => {
  it('marks all fields searchable by default', () => {
    expect(
      classifyFields({
        name: 'Acme',
        status: 'active',
      }),
    ).toEqual({
      searchable: ['name', 'status'],
      hashOnly: [],
      excluded: [],
    })
  })

  it('applies exclusion and hash precedence before whitelist fallback', () => {
    expect(
      classifyFields(
        {
          name: 'Acme',
          email: 'team@acme.test',
          phone: '+1-555-0100',
          ssn: '111-22-3333',
          encryptedEmail: 'ciphertext',
          apiKey: 'secret',
          title: 'CEO',
        },
        {
          encryptedFields: [
            { field: 'ssn' },
            { field: 'encryptedEmail', hashField: 'encrypted_email_hash' },
          ],
          fieldPolicy: {
            searchable: ['name', 'email', 'encryptedEmail'],
            hashOnly: ['email', 'phone'],
            excluded: ['apiKey', 'phone'],
          },
        },
      ),
    ).toEqual({
      searchable: ['name'],
      hashOnly: ['email', 'encryptedEmail'],
      excluded: ['phone', 'ssn', 'apiKey', 'title'],
    })
  })
})
