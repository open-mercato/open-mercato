/** @jest-environment node */

import {
  buildPortalRootUrl,
  buildPortalUrlPattern,
  resolveRequestOrigin,
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

describe('resolveRequestOrigin', () => {
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
    expect(resolveRequestOrigin(headersOf({ host: 'localhost:3000' }))).toBe('http://localhost:3000')
  })

  it('honors the forwarded host and protocol from a terminating proxy', () => {
    const origin = resolveRequestOrigin(headersOf({
      host: 'internal-app:8080',
      'x-forwarded-host': 'demo.openmercato.com',
      'x-forwarded-proto': 'https',
    }))
    expect(origin).toBe('https://demo.openmercato.com')
  })

  it('uses the client-facing hop when a proxy chain appends values', () => {
    const origin = resolveRequestOrigin(headersOf({
      'x-forwarded-host': 'demo.openmercato.com, internal-app',
      'x-forwarded-proto': 'https, http',
    }))
    expect(origin).toBe('https://demo.openmercato.com')
  })

  it('defaults a public host to https when the proxy omits x-forwarded-proto', () => {
    expect(resolveRequestOrigin(headersOf({ host: 'demo.openmercato.com' }))).toBe('https://demo.openmercato.com')
  })

  it('rejects a malformed host header instead of rendering it', () => {
    expect(resolveRequestOrigin(headersOf({ host: 'evil.example.com/"><script>' }))).toBe('')
  })

  it('ignores a non-http forwarded protocol', () => {
    const origin = resolveRequestOrigin(headersOf({ host: 'app.example.com', 'x-forwarded-proto': 'javascript' }))
    expect(origin).toBe('https://app.example.com')
  })

  it('falls back to APP_URL when no host header is present', () => {
    process.env.APP_URL = 'https://configured.example.com/'
    expect(resolveRequestOrigin(headersOf({}))).toBe('https://configured.example.com')
  })

  it('falls back to NEXT_PUBLIC_APP_URL when APP_URL is unusable', () => {
    process.env.APP_URL = 'not a url'
    process.env.NEXT_PUBLIC_APP_URL = 'https://public.example.com'
    expect(resolveRequestOrigin(headersOf({}))).toBe('https://public.example.com')
  })

  it('returns an empty origin when nothing is resolvable', () => {
    expect(resolveRequestOrigin(headersOf({}))).toBe('')
    expect(resolveRequestOrigin(null)).toBe('')
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
