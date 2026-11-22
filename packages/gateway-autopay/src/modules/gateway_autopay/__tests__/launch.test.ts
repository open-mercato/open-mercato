import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  buildLaunchPath,
  createLaunchGrant,
  escapeHtml,
  isWellFormedLaunchToken,
  isWellFormedOrderId,
  LAUNCH_PAGE_CONTENT_SECURITY_POLICY,
  LAUNCH_TOKEN_TTL_MS,
  launchGrantMatches,
  pickReturnTarget,
  readFormPost,
  readHttpUrl,
  readReturnTargets,
  renderLaunchPage,
  resolveLaunchUrl,
} from '../lib/launch'

const copy = { title: 'Redirecting', message: 'Please wait', continueLabel: 'Continue' }

describe('launch grant', () => {
  it('issues an unguessable URL-safe token that expires after the TTL', () => {
    const now = Date.parse('2026-10-29T10:00:00.000Z')
    const grant = createLaunchGrant(now)

    expect(grant.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Date.parse(grant.expiresAt) - now).toBe(LAUNCH_TOKEN_TTL_MS)
  })

  it('accepts only the exact token before it expires', () => {
    const now = Date.now()
    const grant = createLaunchGrant(now)

    expect(launchGrantMatches(grant, grant.token, now + 1000)).toBe(true)
    expect(launchGrantMatches(grant, `${grant.token.slice(0, -1)}x`, now + 1000)).toBe(false)
    expect(launchGrantMatches(grant, grant.token.slice(0, -1), now + 1000)).toBe(false)
    expect(launchGrantMatches(grant, grant.token, now + LAUNCH_TOKEN_TTL_MS + 1)).toBe(false)
  })

  it.each([undefined, null, 'token', 42, [], {}, { token: 1, expiresAt: 2 }, { token: 'a', expiresAt: 'not-a-date' }])(
    'rejects a malformed stored grant: %p',
    (stored) => {
      expect(launchGrantMatches(stored, 'a')).toBe(false)
    },
  )

  it('validates token and order id shapes before any lookup', () => {
    expect(isWellFormedLaunchToken(createLaunchGrant().token)).toBe(true)
    expect(isWellFormedLaunchToken('short')).toBe(false)
    expect(isWellFormedLaunchToken(`${'a'.repeat(42)}!`)).toBe(false)
    expect(isWellFormedOrderId('3fa85f6457174562b3fc2c963f66afa6')).toBe(true)
    expect(isWellFormedOrderId('')).toBe(false)
    expect(isWellFormedOrderId('a'.repeat(33))).toBe(false)
    expect(isWellFormedOrderId('x"; DROP TABLE')).toBe(false)
  })
})

describe('launch URL', () => {
  it('carries only the order id and the token', () => {
    expect(buildLaunchPath('order1', 'tok')).toBe('/api/gateway_autopay/launch?o=order1&t=tok')
  })

  it('is anchored on the origin of the absolute success URL', () => {
    expect(resolveLaunchUrl('/api/x', 'https://shop.example.com/pay/s/success/1')).toBe('https://shop.example.com/api/x')
  })

  it.each([undefined, '', '/relative/path', 'javascript:alert(1)'])('stays relative for %p', (successUrl) => {
    expect(resolveLaunchUrl('/api/x', successUrl)).toBe('/api/x')
  })
})

describe('return targets', () => {
  it('keeps only http(s) URLs', () => {
    expect(readHttpUrl('https://shop.example.com/a')).toBe('https://shop.example.com/a')
    expect(readHttpUrl('http://localhost:3000/a')).toBe('http://localhost:3000/a')
    expect(readHttpUrl('javascript:alert(1)')).toBeNull()
    expect(readHttpUrl('data:text/html,<script>')).toBeNull()
    expect(readHttpUrl('//evil.example.com')).toBeNull()
    expect(readHttpUrl(undefined)).toBeNull()
  })

  it('drops an unsafe stored target instead of redirecting to it', () => {
    expect(readReturnTargets({ successUrl: 'javascript:alert(1)', cancelUrl: 'https://shop.example.com/c' })).toEqual({
      successUrl: null,
      cancelUrl: 'https://shop.example.com/c',
    })
    expect(readReturnTargets('nope')).toEqual({ successUrl: null, cancelUrl: null })
  })

  it('sends failed, cancelled and expired payers to the cancel page and everyone else to success', () => {
    const targets = { successUrl: 'https://shop.example.com/s', cancelUrl: 'https://shop.example.com/c' }

    for (const status of ['failed', 'cancelled', 'expired'] as const) {
      expect(pickReturnTarget(status, targets)).toBe(targets.cancelUrl)
    }
    for (const status of ['captured', 'authorized', 'pending', 'unknown'] as const) {
      expect(pickReturnTarget(status, targets)).toBe(targets.successUrl)
    }
  })
})

describe('form post descriptor', () => {
  it('reads a well-formed descriptor', () => {
    expect(readFormPost({ url: 'https://testpay.autopay.eu/x', fields: { A: '1' } })).toEqual({
      url: 'https://testpay.autopay.eu/x',
      fields: { A: '1' },
    })
  })

  it.each([null, 'x', { url: 1, fields: {} }, { url: 'u' }, { url: 'u', fields: { A: 1 } }])('rejects %p', (value) => {
    expect(readFormPost(value)).toBeNull()
  })
})

describe('renderLaunchPage', () => {
  it('posts every signed field as a hidden input to the gateway', () => {
    const html = renderLaunchPage(
      { url: 'https://testpay.autopay.eu/x', fields: { ServiceID: '2', OrderID: '100', Hash: 'abc' } },
      copy,
    )

    expect(html).toContain('method="POST" action="https://testpay.autopay.eu/x"')
    expect(html).toContain('<input type="hidden" name="ServiceID" value="2">')
    expect(html).toContain('<input type="hidden" name="Hash" value="abc">')
    expect(html).toContain('<button type="submit">Continue</button>')
  })

  it('escapes hostile field names, values and copy so nothing can break out of the markup', () => {
    const hostile = '"><script>alert(1)</script>'
    const html = renderLaunchPage(
      { url: `https://testpay.autopay.eu/x?a=${hostile}`, fields: { [hostile]: hostile } },
      { title: hostile, message: hostile, continueLabel: hostile },
    )

    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain(escapeHtml(hostile))
  })
})

describe('content security policy', () => {
  const policyOf = (relativePath: string): string => {
    const source = readFileSync(path.resolve(process.cwd(), relativePath), 'utf8')
    const match = source.match(/source: '\/api\/gateway_autopay\/launch',[\s\S]*?key: 'Content-Security-Policy', value: "([^"]+)"/)
    if (!match) throw new Error(`launch CSP entry not found in ${relativePath}`)
    return match[1]
  }

  it('lets the launch page post to Autopay and nothing else', () => {
    expect(LAUNCH_PAGE_CONTENT_SECURITY_POLICY).toContain('form-action https:')
    expect(LAUNCH_PAGE_CONTENT_SECURITY_POLICY).toContain("default-src 'none'")
    expect(LAUNCH_PAGE_CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'")
  })

  it.each([
    ['the app', '../../apps/mercato/next.config.ts'],
    ['the create-app template', '../create-app/template/next.config.ts'],
  ])('is declared at the Next.js config layer of %s with the same value', (_label, relativePath) => {
    expect(policyOf(relativePath)).toBe(LAUNCH_PAGE_CONTENT_SECURITY_POLICY)
  })
})
