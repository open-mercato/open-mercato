jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    customers: {
      customer_entity: 'customer_entity',
      customer_company_profile: 'customer_company_profile',
      customer_person_profile: 'customer_person_profile',
      customer_deal: 'customer_deal',
    },
  },
}), { virtual: true })

describe('customers detail route metadata', () => {
  it('requires companies view feature', async () => {
    const { metadata } = await import('../companies/[id]/route')
    expect(metadata?.GET?.requireAuth).toBe(true)
    expect(metadata?.GET?.requireFeatures).toContain('customers.company.view')
  })

  it('requires people view feature', async () => {
    const { metadata } = await import('../people/[id]/route')
    expect(metadata?.GET?.requireAuth).toBe(true)
    expect(metadata?.GET?.requireFeatures).toContain('customers.person.view')
  })

  it('requires deals view feature', async () => {
    const { metadata } = await import('../deals/[id]/route')
    expect(metadata?.GET?.requireAuth).toBe(true)
    expect(metadata?.GET?.requireFeatures).toContain('customers.deal.view')
  })
})
