import { sanitizeReturnUrl } from '../return-url'

describe('SSO return URL sanitization', () => {
  it.each([
    null, '', '//outside.example', 'https://outside.example', 'backend',
    '/.//outside.example', '/..//outside.example', '/x/..//outside.example',
    '/%2e//outside.example', '/x/%2e%2e//outside.example', '/\\outside.example',
    '/.\\/outside.example', '/\t/outside.example',
  ])('falls back for unsafe or empty return URL %j', (returnUrl) => {
    expect(sanitizeReturnUrl(returnUrl)).toBe('/backend')
  })

  it.each([
    ['/', '/'],
    ['/backend', '/backend'],
    ['/backend/orders?next=//outside.example#//section', '/backend/orders?next=//outside.example#//section'],
    ['/backend//orders', '/backend//orders'],
    ['/backend/../account?tab=profile#details', '/account?tab=profile#details'],
    ['/backend/%2Forders', '/backend/%2Forders'],
  ])('preserves safe return URL %j', (returnUrl, expected) => {
    expect(sanitizeReturnUrl(returnUrl)).toBe(expected)
  })
})
