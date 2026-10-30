import { clickUrl, openPixelUrl, TRACKING_TOKEN_PARAM } from '../urls'
import { verifyTrackingToken } from '../token'
import { resolveTrackingBaseUrl } from '../secret'

const SECRET = 'secret'
const claims = {
  tenantId: 't',
  organizationId: 'o',
  campaignId: 'c',
  runId: 'r',
  stepId: 's',
}

function tokenOf(url: string): string {
  return new URL(url).searchParams.get(TRACKING_TOKEN_PARAM) ?? ''
}

describe('tracking urls', () => {
  test('the pixel url carries a verifiable open token', () => {
    const url = openPixelUrl('https://shop.test', claims, SECRET)
    expect(url.startsWith('https://shop.test/api/marketing_automation/track/open?t=')).toBe(true)
    expect(verifyTrackingToken(tokenOf(url), SECRET)).toEqual({ ...claims, purpose: 'open', target: undefined })
  })

  test('the click url carries the target inside the signature', () => {
    const target = 'https://shop.test/offer?a=1&b=2'
    const url = clickUrl('https://shop.test', claims, SECRET, target)
    expect(verifyTrackingToken(tokenOf(url), SECRET)).toEqual({ ...claims, purpose: 'click', target })
  })

  // One query parameter, so the url has no `&` to escape in an html attribute.
  test('the url has exactly one query parameter', () => {
    const url = clickUrl('https://shop.test', claims, SECRET, 'https://x.test/a?b=1&c=2')
    expect(url.split('?')).toHaveLength(2)
    expect(url.includes('&')).toBe(false)
  })

  test('a trailing slash on the base does not double up', () => {
    expect(openPixelUrl('https://shop.test/', claims, SECRET)).toContain('shop.test/api/')
  })
})

describe('resolveTrackingBaseUrl', () => {
  test('uses APP_URL', () => {
    expect(resolveTrackingBaseUrl({ APP_URL: 'https://shop.test/' })).toBe('https://shop.test')
  })

  test('falls back to the public variable', () => {
    expect(resolveTrackingBaseUrl({ NEXT_PUBLIC_APP_URL: 'https://shop.test' })).toBe('https://shop.test')
  })

  test('in development an unset base is localhost, which is where the tests run', () => {
    expect(resolveTrackingBaseUrl({})).toBe('http://localhost:3000')
  })

  // Emitting localhost links to real recipients is worse than not tracking at all.
  test('in production an unset base disables tracking', () => {
    expect(resolveTrackingBaseUrl({ NODE_ENV: 'production' })).toBeNull()
  })
})
