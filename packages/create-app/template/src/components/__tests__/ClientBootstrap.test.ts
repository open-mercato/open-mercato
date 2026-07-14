import {
  profileUsesComponentOverrides,
  resolveClientBootstrapProfile,
} from '../ClientBootstrap'

describe('client bootstrap route profiles', () => {
  it.each([
    ['/login', 'public'],
    ['/start', 'public'],
    ['/example', 'public'],
    ['/backend', 'backend-dashboard'],
    ['/backend/customers', 'backend'],
    ['/backend/messages/compose', 'backend-messages'],
    ['/backend/checkout/templates/template-1/preview', 'backend-checkout'],
    ['/acme/portal', 'portal'],
    ['/acme/portal/dashboard', 'portal'],
    ['/pay/invoice-123', 'checkout'],
    ['/messages/view/token-123', 'message'],
  ])('maps %s to %s', (pathname, profile) => {
    expect(resolveClientBootstrapProfile(pathname)).toBe(profile)
  })

  it('normalizes query strings and trailing slashes', () => {
    expect(resolveClientBootstrapProfile('/backend/messages/?folder=sent')).toBe('backend-messages')
    expect(resolveClientBootstrapProfile('/acme/portal/?next=dashboard')).toBe('portal')
  })

  it('limits component overrides to extensible application surfaces', () => {
    expect(profileUsesComponentOverrides('public')).toBe(false)
    expect(profileUsesComponentOverrides('message')).toBe(false)
    expect(profileUsesComponentOverrides('backend')).toBe(true)
    expect(profileUsesComponentOverrides('portal')).toBe(true)
    expect(profileUsesComponentOverrides('checkout')).toBe(true)
  })
})
