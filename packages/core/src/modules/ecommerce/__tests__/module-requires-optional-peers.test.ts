import { metadata } from '../index'

describe('ecommerce module dependencies', () => {
  it('keeps catalog and sales as hard requirements', () => {
    expect(metadata.requires).toEqual(expect.arrayContaining(['catalog', 'sales']))
  })

  it('treats customer_groups and customer_accounts as optional peers', () => {
    expect(metadata.requires).not.toContain('customer_groups')
    expect(metadata.requires).not.toContain('customer_accounts')
  })
})
