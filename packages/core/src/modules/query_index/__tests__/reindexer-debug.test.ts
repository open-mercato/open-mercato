import { buildReindexDecryptDebugPayload } from '../lib/reindexer'

describe('buildReindexDecryptDebugPayload redaction (issue #2709)', () => {
  const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

  it('reports only field keys, never decrypted values', () => {
    const doc = {
      id: 'rec-1',
      display_name: 'Jane Doe',
      first_name: 'Jane',
      last_name: 'Doe',
      primary_email: 'jane@example.com',
      primary_phone: '+15551234567',
      brand_name: 'Acme',
      legal_name: 'Acme Inc',
    }

    const payload = buildReindexDecryptDebugPayload('customers:customer_person_profile', doc, scope)

    expect(payload).toEqual({
      entityType: 'customers:customer_person_profile',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      keys: ['display_name', 'first_name', 'last_name', 'brand_name', 'legal_name', 'primary_email', 'primary_phone'],
    })

    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('Jane Doe')
    expect(serialized).not.toContain('jane@example.com')
    expect(serialized).not.toContain('+15551234567')
    expect(serialized).not.toContain('Acme')
  })

  it('omits keys whose values are missing or empty', () => {
    const doc = {
      display_name: 'Present',
      first_name: '',
      last_name: null as unknown as string,
    }

    const payload = buildReindexDecryptDebugPayload('customers:customer_person_profile', doc, scope)

    expect(payload.keys).toEqual(['display_name'])
  })

  it('normalizes nullish scope identifiers', () => {
    const payload = buildReindexDecryptDebugPayload('customers:customer_person_profile', {}, {
      tenantId: null,
      organizationId: null,
    })

    expect(payload.tenantId).toBeNull()
    expect(payload.organizationId).toBeNull()
    expect(payload.keys).toEqual([])
  })
})
