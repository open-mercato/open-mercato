/** @jest-environment node */

describe('payment gateway route metadata', () => {
  it('requires dedicated permissions for sensitive write-adjacent routes', async () => {
    const [{ metadata: cancelMetadata }, { metadata: statusMetadata }, { metadata: providersMetadata }] =
      await Promise.all([
        import('../cancel/route'),
        import('../status/route'),
        import('../providers/route'),
      ])

    expect(cancelMetadata.POST).toEqual({
      requireAuth: true,
      requireFeatures: ['payment_gateways.cancel'],
    })

    expect(statusMetadata.GET).toEqual({
      requireAuth: true,
      requireFeatures: ['payment_gateways.refresh'],
    })

    expect(providersMetadata.GET).toEqual({
      requireAuth: true,
      requireFeatures: ['payment_gateways.manage'],
    })
  })
})
