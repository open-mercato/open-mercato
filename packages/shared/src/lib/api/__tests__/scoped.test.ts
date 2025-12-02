import { z } from 'zod'
import { parseScopedCommandInput } from '../scoped'

const translate = (_key: string, fallback?: string) => fallback ?? _key

describe('parseScopedCommandInput', () => {
  it('preserves custom fields when parsing scoped payloads', () => {
    const schema = z.object({
      tenantId: z.string(),
      organizationId: z.string().optional(),
      name: z.string(),
    })
    const ctx = {
      auth: { tenantId: 'tenant-1', orgId: 'org-1' },
      selectedOrganizationId: 'org-1',
    } as any

    const result = parseScopedCommandInput(
      schema,
      {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        name: 'Test Product',
        customFields: { foo: 'bar' },
        cf_extra: '123',
      },
      ctx,
      translate
    )

    expect(result).toMatchObject({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      name: 'Test Product',
      customFields: { foo: 'bar', extra: '123' },
    })
  })
})
