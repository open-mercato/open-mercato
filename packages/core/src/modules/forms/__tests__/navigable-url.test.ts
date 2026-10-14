import { z } from 'zod'
import { isNavigableUrl, normalizeNavigableUrl } from '../lib/navigable-url'
import { distributionCreateCommandSchema } from '../data/validators'

/**
 * The defect this pins: a distribution's `redirect_url` is assigned to
 * `window.location` by the anonymous public runner, inside the app's own origin,
 * under a CSP that allows `'unsafe-inline'`. It was validated with
 * `z.string().url()` alone, which only checks that `new URL(...)` parses — so a
 * `javascript:` target was accepted and stored, and every respondent who
 * completed that form executed it.
 */
describe('normalizeNavigableUrl', () => {
  it('rejects every scheme a browser may treat as script or inline content', () => {
    for (const candidate of [
      'javascript:alert(document.cookie)',
      'JaVaScRiPt:alert(1)',
      '  javascript:alert(1)  ',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'blob:https://example.com/abc',
      'file:///etc/passwd',
    ]) {
      expect(normalizeNavigableUrl(candidate)).toBeNull()
      expect(isNavigableUrl(candidate)).toBe(false)
    }
  })

  it('documents that z.string().url() alone does NOT reject them', () => {
    // If this ever starts failing, zod tightened `url()` and the refinement in
    // data/validators.ts is belt-and-braces rather than load-bearing.
    expect(z.string().url().safeParse('javascript:alert(1)').success).toBe(true)
    expect(z.string().url().safeParse('data:text/html,x').success).toBe(true)
  })

  it('accepts ordinary http and https targets, including path, query and fragment', () => {
    expect(normalizeNavigableUrl('https://example.com')).toBe('https://example.com/')
    expect(normalizeNavigableUrl('https://example.com/thanks?ref=a#top'))
      .toBe('https://example.com/thanks?ref=a#top')
    expect(normalizeNavigableUrl('http://localhost:3000/done')).toBe('http://localhost:3000/done')
  })

  it('rejects embedded credentials and non-strings', () => {
    expect(normalizeNavigableUrl('https://user:pw@example.com/')).toBeNull()
    expect(normalizeNavigableUrl('not a url')).toBeNull()
    expect(normalizeNavigableUrl('')).toBeNull()
    expect(normalizeNavigableUrl(null)).toBeNull()
    expect(normalizeNavigableUrl(undefined)).toBeNull()
    expect(normalizeNavigableUrl(42)).toBeNull()
  })
})

describe('distributionCreateCommandSchema redirectUrl', () => {
  const base = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    formId: '33333333-3333-4333-8333-333333333333',
    mode: 'open' as const,
    defaultLocale: 'en',
  }

  it('refuses a javascript: redirect target', () => {
    const result = distributionCreateCommandSchema.safeParse({
      ...base,
      redirectUrl: 'javascript:alert(1)',
    })
    expect(result.success).toBe(false)
  })

  it('accepts an https redirect target', () => {
    const result = distributionCreateCommandSchema.safeParse({
      ...base,
      redirectUrl: 'https://example.com/thanks',
    })
    expect(result.success).toBe(true)
  })

  it('still accepts an absent or null redirect target', () => {
    expect(distributionCreateCommandSchema.safeParse({ ...base }).success).toBe(true)
    expect(distributionCreateCommandSchema.safeParse({ ...base, redirectUrl: null }).success).toBe(true)
  })
})
