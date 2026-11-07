import { describeCompanyCard, resolveGusStatus } from '../lib/status'
import { isWidgetAllowed } from '../lib/widget-config'

describe('resolveGusStatus', () => {
  it('keeps the CRM company card off by default', () => {
    const status = resolveGusStatus(true, { environment: 'test' })
    expect(status).toEqual({
      enabled: true,
      environment: 'test',
      hasApiKey: false,
      lookupAvailable: true,
      companyFormsRequested: false,
      companyFormsActive: false,
    })
    expect(describeCompanyCard(status)).toBe('switch_off')
  })

  it('never activates the card without an API key — not even in Test', () => {
    const status = resolveGusStatus(true, { environment: 'test', showOnCompanyForms: true })
    expect(status.lookupAvailable).toBe(true)
    expect(status.companyFormsActive).toBe(false)
    expect(describeCompanyCard(status)).toBe('missing_key')
  })

  it('activates the card with the switch on and a key', () => {
    const status = resolveGusStatus(true, { environment: 'production', apiKey: 'k', showOnCompanyForms: true })
    expect(status.companyFormsActive).toBe(true)
    expect(describeCompanyCard(status)).toBe('active')
    // boolean credentials may arrive as strings
    expect(resolveGusStatus(true, { environment: 'production', apiKey: 'k', showOnCompanyForms: 'true' }).companyFormsActive).toBe(true)
  })

  it('reports a disabled integration', () => {
    const status = resolveGusStatus(false, { environment: 'production', apiKey: 'k', showOnCompanyForms: true })
    expect(status.lookupAvailable).toBe(false)
    expect(status.companyFormsActive).toBe(false)
    expect(describeCompanyCard(status)).toBe('integration_off')
  })

  it('treats production without a key as unusable and blank keys as missing', () => {
    const status = resolveGusStatus(true, { environment: 'production', apiKey: '   ', showOnCompanyForms: true })
    expect(status.hasApiKey).toBe(false)
    expect(status.lookupAvailable).toBe(false)
    expect(describeCompanyCard(status)).toBe('missing_key')
  })

  it('never exposes the key', () => {
    expect(JSON.stringify(resolveGusStatus(true, { apiKey: 'secret-key-1' }))).not.toContain('secret-key-1')
  })
})

describe('isWidgetAllowed', () => {
  const on = { lookupAvailable: true, companyFormsActive: true }
  it('hides widgets while the status is unknown', () => {
    expect(isWidgetAllowed(undefined, undefined)).toBe(false)
    expect(isWidgetAllowed('companyForms', null)).toBe(false)
  })
  it('gates host widgets on lookup availability and the CRM card on the switch', () => {
    expect(isWidgetAllowed(undefined, { lookupAvailable: true, companyFormsActive: false })).toBe(true)
    expect(isWidgetAllowed('lookup', { lookupAvailable: false, companyFormsActive: false })).toBe(false)
    expect(isWidgetAllowed('companyForms', { lookupAvailable: true, companyFormsActive: false })).toBe(false)
    expect(isWidgetAllowed('companyForms', on)).toBe(true)
  })
})
