import {
  serviceCreateSchema,
  serviceUpdateSchema,
  serviceWorkRequirementInputSchema,
} from '../validators'

const SCOPE = {
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
}

const UUID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

describe('catalog service validators', () => {
  it('accepts service details, media, default price, and work requirements', () => {
    const result = serviceCreateSchema.safeParse({
      ...SCOPE,
      title: 'Implementation workshop',
      description: 'Discovery and execution support',
      scope: 'Remote workshop with follow-up planning.',
      categoryId: UUID,
      defaultPriceAmount: '1200.50',
      defaultPriceCurrencyCode: 'EUR',
      defaultMediaUrl: 'https://example.test/service.png',
      media: [
        {
          url: 'https://example.test/service.png',
          alt: 'Service preview',
          contentType: 'image/png',
          sortOrder: 0,
          isDefault: true,
        },
      ],
      workRequirements: [
        {
          targetType: 'staff_role',
          targetId: UUID,
          labelSnapshot: 'Designer',
          allocationMode: 'ratio',
          allocationValue: '1',
        },
        {
          targetType: 'generic',
          labelSnapshot: 'Developer support',
          allocationMode: 'fixed_hours',
          allocationValue: 8,
          metadata: { source: 'manual' },
        },
      ],
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.defaultPriceAmount).toBe(1200.5)
      expect(result.data.workRequirements?.[0]?.allocationValue).toBe(1)
      expect(result.data.workRequirements?.[1]?.allocationMode).toBe('fixed_hours')
    }
  })

  it('rejects unsupported requirement target and allocation modes', () => {
    const result = serviceWorkRequirementInputSchema.safeParse({
      targetType: 'product',
      targetId: UUID,
      labelSnapshot: 'Invalid target',
      allocationMode: 'days',
      allocationValue: 1,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual([
        'targetType',
        'allocationMode',
      ])
    }
  })

  it('allows nullable optional defaults on update', () => {
    const result = serviceUpdateSchema.safeParse({
      id: UUID,
      defaultPriceAmount: null,
      defaultPriceCurrencyCode: null,
      categoryId: null,
      defaultMediaId: null,
      defaultMediaUrl: null,
    })

    expect(result.success).toBe(true)
  })
})
