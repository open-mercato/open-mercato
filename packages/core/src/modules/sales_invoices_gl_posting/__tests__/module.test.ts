import { metadata } from '../index'
import { features } from '../acl'
import { setup } from '../setup'

describe('sales_invoices_gl_posting module skeleton', () => {
  it('declares the two features named by the spec, owned by this module', () => {
    expect(features.map((feature) => feature.id).sort()).toEqual([
      'sales_invoices_gl_posting.invoices.post',
      'sales_invoices_gl_posting.settings.manage',
    ])
    expect(features.every((feature) => feature.module === 'sales_invoices_gl_posting')).toBe(true)
  })

  it('grants every feature to admin and none to other roles', () => {
    const roles = setup.defaultRoleFeatures ?? {}
    expect(Object.keys(roles)).toEqual(['admin'])
    expect([...(roles.admin ?? [])].sort()).toEqual(features.map((feature) => feature.id).sort())
  })

  it('requires the ledger, sales and currencies modules', () => {
    expect(metadata.name).toBe('sales_invoices_gl_posting')
    expect(metadata.requires).toEqual(['ledger', 'sales', 'currencies'])
  })

  it('seeds nothing', () => {
    expect(setup.seedDefaults).toBeUndefined()
    expect(setup.seedExamples).toBeUndefined()
    expect(setup.onTenantCreated).toBeUndefined()
  })
})
