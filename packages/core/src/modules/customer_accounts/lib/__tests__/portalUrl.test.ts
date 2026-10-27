/** @jest-environment node */

import {
  buildPortalRootUrl,
  buildPortalUrlPattern,
  resolvePortalRequestOrigin,
} from '../portalUrl'

function headersOf(values: Record<string, string>) {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? null
    },
  }
}

const ENV_KEYS = ['APP_URL', 'NEXT_PUBLIC_APP_URL'] as const
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

describe('resolvePortalRequestOrigin', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
  })

  it('mirrors window.location.origin for a plain local request', () => {
    expect(resolvePortalRequestOrigin(headersOf({ host: 'localhost:3000' }))).toBe('http://localhost:3000')
  })

  it('honors the forwarded host and protocol from a terminating proxy', () => {
    const origin = resolvePortalRequestOrigin(headersOf({
      host: 'internal-app:8080',
      'x-forwarded-host': 'demo.openmercato.com',
      'x-forwarded-proto': 'https',
    }))
    expect(origin).toBe('https://demo.openmercato.com')
  })

  it('uses the client-facing hop when a proxy chain appends values', () => {
    const origin = resolvePortalRequestOrigin(headersOf({
      'x-forwarded-host': 'demo.openmercato.com, internal-app',
      'x-forwarded-proto': 'https, http',
    }))
    expect(origin).toBe('https://demo.openmercato.com')
  })

  it('defaults a public host to https when the proxy omits x-forwarded-proto', () => {
    expect(resolvePortalRequestOrigin(headersOf({ host: 'demo.openmercato.com' }))).toBe('https://demo.openmercato.com')
  })

  // A real request always carries a Host header, so this — not the empty-headers
  // case below — is the state a plain-HTTP deployment actually reaches. Without
  // the configured protocol winning here, the hint and the "Open Portal" href
  // would both render an https:// URL that does not answer.
  it('takes the protocol from APP_URL when it names the requested host', () => {
    process.env.APP_URL = 'http://app.local:3000'
    expect(resolvePortalRequestOrigin(headersOf({ host: 'app.local:3000' }))).toBe('http://app.local:3000')
  })

  it('ignores APP_URL when it names a different host', () => {
    process.env.APP_URL = 'http://app.local:3000'
    expect(resolvePortalRequestOrigin(headersOf({ host: 'demo.openmercato.com' }))).toBe('https://demo.openmercato.com')
  })

  it('still lets an explicit x-forwarded-proto win over APP_URL', () => {
    process.env.APP_URL = 'http://app.local:3000'
    const origin = resolvePortalRequestOrigin(headersOf({ host: 'app.local:3000', 'x-forwarded-proto': 'https' }))
    expect(origin).toBe('https://app.local:3000')
  })

  it('treats a bracketed IPv6 loopback host as plain http, port and all', () => {
    expect(resolvePortalRequestOrigin(headersOf({ host: '[::1]:3000' }))).toBe('http://[::1]:3000')
    expect(resolvePortalRequestOrigin(headersOf({ host: '[::1]' }))).toBe('http://[::1]')
  })

  it('rejects a malformed host header instead of rendering it', () => {
    expect(resolvePortalRequestOrigin(headersOf({ host: 'evil.example.com/"><script>' }))).toBe('')
  })

  it('ignores a non-http forwarded protocol', () => {
    const origin = resolvePortalRequestOrigin(headersOf({ host: 'app.example.com', 'x-forwarded-proto': 'javascript' }))
    expect(origin).toBe('https://app.example.com')
  })

  it('falls back to APP_URL when no host header is present', () => {
    process.env.APP_URL = 'https://configured.example.com/'
    expect(resolvePortalRequestOrigin(headersOf({}))).toBe('https://configured.example.com')
  })

  it('falls back to NEXT_PUBLIC_APP_URL when APP_URL is unusable', () => {
    process.env.APP_URL = 'not a url'
    process.env.NEXT_PUBLIC_APP_URL = 'https://public.example.com'
    expect(resolvePortalRequestOrigin(headersOf({}))).toBe('https://public.example.com')
  })

  it('returns an empty origin when nothing is resolvable', () => {
    expect(resolvePortalRequestOrigin(headersOf({}))).toBe('')
    expect(resolvePortalRequestOrigin(null)).toBe('')
  })
})

describe('portal URL builders', () => {
  it('renders the tenant portal pattern against the resolved origin', () => {
    expect(buildPortalUrlPattern('https://demo.openmercato.com')).toBe('https://demo.openmercato.com/[org-slug]/portal')
    expect(buildPortalRootUrl('https://demo.openmercato.com')).toBe('https://demo.openmercato.com/portal')
  })

  it('degrades to a root-relative path so server and client markup stay identical', () => {
    expect(buildPortalUrlPattern('')).toBe('/[org-slug]/portal')
    expect(buildPortalRootUrl('')).toBe('/portal')
  })

  it('never doubles the separator when the origin carries a trailing slash', () => {
    expect(buildPortalUrlPattern('https://demo.openmercato.com/')).toBe('https://demo.openmercato.com/[org-slug]/portal')
    expect(buildPortalRootUrl('https://demo.openmercato.com/')).toBe('https://demo.openmercato.com/portal')
  })
})

// Portal pages only exist under `frontend/[orgSlug]/portal/**`, so the admin
// "Open Portal" action must carry the organization segment — without it the
// link resolved to a 404 (#5668).
describe('portal entry point for a resolved organization (regression for issue #5668)', () => {
  it('places the organization slug ahead of the portal segment', () => {
    expect(buildPortalRootUrl('https://demo.openmercato.com', 'acme')).toBe('https://demo.openmercato.com/acme/portal')
    expect(buildPortalRootUrl('http://localhost:3000', 'acme')).toBe('http://localhost:3000/acme/portal')
  })

  it('never doubles the separator when the origin carries a trailing slash', () => {
    expect(buildPortalRootUrl('https://demo.openmercato.com/', 'acme')).toBe('https://demo.openmercato.com/acme/portal')
  })

  it('degrades to a root-relative path when the origin is unresolvable', () => {
    expect(buildPortalRootUrl('', 'acme')).toBe('/acme/portal')
  })

  it('keeps the legacy slugless shape when no slug is supplied', () => {
    expect(buildPortalRootUrl('https://demo.openmercato.com', null)).toBe('https://demo.openmercato.com/portal')
    expect(buildPortalRootUrl('https://demo.openmercato.com', undefined)).toBe('https://demo.openmercato.com/portal')
    expect(buildPortalRootUrl('https://demo.openmercato.com', '   ')).toBe('https://demo.openmercato.com/portal')
  })

  it('escapes a slug that would otherwise alter the path structure', () => {
    expect(buildPortalRootUrl('https://demo.openmercato.com', 'acme/../admin')).toBe(
      'https://demo.openmercato.com/acme%2F..%2Fadmin/portal',
    )
  })
})
