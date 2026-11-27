import { NextRequest } from 'next/server'
import { registerRequestGate, unregisterRequestGate } from '@open-mercato/shared/lib/runtime/request-gate'

jest.mock('@/lib/customDomainResolver', () => ({
  ensureWarmUp: jest.fn(async () => {}),
  getSharedCustomDomainRouter: jest.fn(() => ({ resolve: jest.fn(async () => null) })),
  isPlatformHost: jest.fn(() => true),
}))

jest.mock('@open-mercato/gateway-stripe/contentSecurityPolicy', () => ({
  stripeContentSecurityPolicy: { connectOrigins: [], scriptOrigins: [], frameOrigins: [] },
}))

jest.mock('@open-mercato/documents/contentSecurityPolicy', () => ({
  resolveDocumentsCollaborationCspOrigins: () => [],
}))

import { proxy } from '@/proxy'

afterEach(() => {
  unregisterRequestGate('proxy-test-gate')
})

describe('proxy request gate', () => {
  it('passes pages through when no gate is registered', async () => {
    const response = await proxy(new NextRequest('http://localhost/backend'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Security-Policy')).toBeTruthy()
  })

  it('serves the gate response for page requests, keeping the CSP header', async () => {
    const seen: string[] = []
    registerRequestGate({
      id: 'proxy-test-gate',
      evaluate: (ctx) => {
        seen.push(`${ctx.surface} ${ctx.method} ${ctx.pathname} ${ctx.cookies.get('session') ?? '-'}`)
        return {
          response: new Response('<html>maintenance</html>', {
            status: 503,
            headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '300' },
          }),
        }
      },
    })
    const request = new NextRequest('http://localhost/backend/customers', { headers: { cookie: 'session=abc' } })
    const response = await proxy(request)
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('300')
    expect(response.headers.get('Content-Security-Policy')).toBeTruthy()
    expect(await response.text()).toContain('maintenance')
    expect(seen).toEqual(['page GET /backend/customers abc'])
  })

  it('keeps a Content-Security-Policy the gate response already sets', async () => {
    registerRequestGate({
      id: 'proxy-test-gate',
      evaluate: () => ({
        response: new Response('<html></html>', {
          status: 503,
          headers: { 'content-security-policy': "default-src 'none'" },
        }),
      }),
    })
    const response = await proxy(new NextRequest('http://localhost/'))
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'")
  })
})
