import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import * as policy from '../../../shared/src/lib/security/contentSecurityPolicy'
import { stripeContentSecurityPolicy } from '../../../gateway-stripe/src/contentSecurityPolicy'
import { resolveDocumentsCollaborationCspOrigins } from '../../../documents/src/contentSecurityPolicy'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const next = require('next/server') as typeof import('next/server')
const nextConstants = require('next/constants') as typeof import('next/constants')
const { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } = nextConstants

function loadSource(relativePath: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(path.join(root, relativePath), 'utf8')
  const { code } = transformSync(source, { loader: 'ts', format: 'cjs' })
  const module = { exports: {} as Record<string, unknown> }
  const localRequire = (specifier: string) => {
    if (specifier in dependencies) return dependencies[specifier]
    if (specifier.startsWith('node:')) return require(specifier)
    throw new Error(`Unexpected dependency in CSP test: ${specifier}`)
  }
  new Function('require', 'module', 'exports', code)(localRequire, module, module.exports)
  return module.exports
}

type HeaderRule = { source: string; headers: Array<{ key: string; value: string }> }
type NextConfigFactory = (phase: string) => { env?: Record<string, string | undefined>; headers: () => Promise<HeaderRule[]> }

const sharedDependencies = {
  'next/constants': nextConstants,
  '@open-mercato/shared/lib/security/contentSecurityPolicy': policy,
  '@open-mercato/gateway-stripe/contentSecurityPolicy': { stripeContentSecurityPolicy },
  '@open-mercato/documents/contentSecurityPolicy': { resolveDocumentsCollaborationCspOrigins },
}

test('both configs preserve the explicitly configured documents collaboration origin', async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_DOCUMENTS_COLLAB_URL: process.env.NEXT_PUBLIC_DOCUMENTS_COLLAB_URL,
    OM_DOCUMENTS_COLLAB_INTEGRATION: process.env.OM_DOCUMENTS_COLLAB_INTEGRATION,
  }
  try {
    process.env.NODE_ENV = 'production'
    for (const endpoint of ['wss://collab.example.com/documents', 'ws://127.0.0.1:4101']) {
      process.env.NEXT_PUBLIC_DOCUMENTS_COLLAB_URL = endpoint
      process.env.OM_DOCUMENTS_COLLAB_INTEGRATION = '1'
      for (const relativePath of ['apps/mercato/next.config.ts', 'packages/create-app/template/next.config.ts']) {
        const config = loadSource(relativePath, {
          ...sharedDependencies,
          './src/lib/dev-origins': { resolveAllowedDevOrigins: () => [] },
          '@open-mercato/telemetry/nextjs-config': { telemetryServerExternalPackages: [] },
        }).default as NextConfigFactory
        const definitions = await config(PHASE_PRODUCTION_SERVER).headers()
        const policy = definitions[0].headers.find((header) => header.key === 'Content-Security-Policy')?.value ?? ''
        const connections = policy.split('; ').find((directive) => directive.startsWith('connect-src '))?.split(' ') ?? []
        assert.ok(connections.some((origin) => origin === new URL(endpoint).origin))
        assert.ok(!connections.some((origin) => ['ws:', 'wss:'].includes(origin)))
      }
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('both production configs restrict scripts and connections and preserve the attachment sandbox', async () => {
  const previousEnvironment = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    for (const relativePath of ['apps/mercato/next.config.ts', 'packages/create-app/template/next.config.ts']) {
      const config = loadSource(relativePath, {
        ...sharedDependencies,
        './src/lib/dev-origins': { resolveAllowedDevOrigins: () => [] },
        '@open-mercato/telemetry/nextjs-config': { telemetryServerExternalPackages: [] },
      }).default as NextConfigFactory
      const headers = await config(PHASE_PRODUCTION_SERVER).headers()
      const globalPolicy = headers[0].headers.find((header) => header.key === 'Content-Security-Policy')?.value
      assert.ok(globalPolicy)
      assert.doesNotMatch(globalPolicy.split('; ').find((directive) => directive.startsWith('script-src '))!, /unsafe-inline|unsafe-eval/)
      const connections = globalPolicy.split('; ').find((directive) => directive.startsWith('connect-src '))!.split(' ')
      assert.ok(!connections.some((source) => ['https:', 'ws:', 'wss:', '*'].includes(source)))
      assert.ok(connections.some((source) => source === 'https://api.stripe.com'))
      const attachment = headers.find((entry) => entry.source === '/api/attachments/file/:path*')
      assert.equal(attachment?.headers.find((header) => header.key === 'Content-Security-Policy')?.value, "default-src 'none'; sandbox")
    }
  } finally {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousEnvironment
  }
})

test('main proxy attaches matching fresh nonces for platform, unknown, custom and error responses', async () => {
  let resolution: { orgSlug: string } | null = null
  let failed = false
  const loaded = loadSource('apps/mercato/src/proxy.ts', {
    ...sharedDependencies,
    'next/server': next,
    './lib/customDomainResolver': {
      ensureWarmUp: async () => {},
      isPlatformHost: (hostname: string) => hostname === 'platform.example.com',
      getSharedCustomDomainRouter: () => ({ resolve: async () => {
        if (failed) throw new Error('Test outage')
        return resolution
      } }),
    },
    '@open-mercato/core/modules/customer_accounts/lib/hostname': { tryNormalizeHostname: (hostname: string) => hostname },
    '@open-mercato/core/modules/customer_accounts/lib/secretCompare': { secretEqual: () => false },
  })
  const proxy = loaded.proxy as (request: InstanceType<typeof next.NextRequest>) => Promise<InstanceType<typeof next.NextResponse>>
  const nonces = new Set<string>()
  for (const mode of ['platform', 'unknown', 'custom', 'error']) {
    resolution = mode === 'custom' ? { orgSlug: 'example' } : null
    failed = mode === 'error'
    const hostname = mode === 'platform' ? 'platform.example.com' : 'portal.example.com'
    const response = await proxy(new next.NextRequest(`https://${hostname}/backend`, { headers: { host: hostname, 'x-nonce': 'attacker' } }))
    const csp = response.headers.get('Content-Security-Policy')!
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1]
    assert.ok(nonce)
    assert.notEqual(nonce, 'attacker')
    assert.ok(!nonces.has(nonce))
    nonces.add(nonce)
    if (mode === 'error') {
      assert.equal(response.status, 503)
      assert.equal(response.headers.get('retry-after'), '5')
    } else {
      assert.equal(response.headers.get('x-middleware-request-x-nonce'), nonce)
      assert.equal(response.headers.get('x-middleware-request-content-security-policy'), csp)
      assert.equal(response.headers.get('x-middleware-request-x-next-url'), mode === 'custom' ? '/example/portal/backend' : '/backend')
    }
    if (mode === 'custom') assert.equal(response.headers.get('x-custom-domain'), '1')
  }
})

test('standalone proxy passes nonce and pathname without dropping the response policy', () => {
  const loaded = loadSource('packages/create-app/template/src/proxy.ts', { ...sharedDependencies, 'next/server': next })
  const proxy = loaded.proxy as (request: InstanceType<typeof next.NextRequest>) => InstanceType<typeof next.NextResponse>
  const response = proxy(new next.NextRequest('https://example.com/backend', { headers: { 'x-nonce': 'attacker' } }))
  const nonce = response.headers.get('x-middleware-request-x-nonce')
  assert.ok(nonce)
  assert.notEqual(nonce, 'attacker')
  assert.equal(response.headers.get('x-middleware-request-x-next-url'), '/backend')
  assert.equal(response.headers.get('Content-Security-Policy'), response.headers.get('x-middleware-request-content-security-policy'))
})

test('both configs hand loopback framing to the proxy only in the development server phase', async () => {
  for (const relativePath of ['apps/mercato/next.config.ts', 'packages/create-app/template/next.config.ts']) {
    const resolveConfig = loadSource(relativePath, {
      ...sharedDependencies,
      './src/lib/dev-origins': { resolveAllowedDevOrigins: () => [] },
      '@open-mercato/telemetry/nextjs-config': { telemetryServerExternalPackages: [] },
    }).default as NextConfigFactory
    assert.equal(resolveConfig(PHASE_DEVELOPMENT_SERVER).env?.OM_DEV_SERVER_LOOPBACK_FRAMING, '1')
    for (const phase of [PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER]) {
      assert.equal(resolveConfig(phase).env?.OM_DEV_SERVER_LOOPBACK_FRAMING, '')
    }
  }
})

test('both proxies widen frame-ancestors to loopback origins only when the development server flag is set', async () => {
  const previous = process.env.OM_DEV_SERVER_LOOPBACK_FRAMING
  const mainProxy = loadSource('apps/mercato/src/proxy.ts', {
    ...sharedDependencies,
    'next/server': next,
    './lib/customDomainResolver': {
      ensureWarmUp: async () => {},
      isPlatformHost: () => true,
      getSharedCustomDomainRouter: () => ({ resolve: async () => null }),
    },
    '@open-mercato/core/modules/customer_accounts/lib/hostname': { tryNormalizeHostname: (hostname: string) => hostname },
    '@open-mercato/core/modules/customer_accounts/lib/secretCompare': { secretEqual: () => false },
  }).proxy as (request: InstanceType<typeof next.NextRequest>) => Promise<InstanceType<typeof next.NextResponse>>
  const templateProxy = loadSource('packages/create-app/template/src/proxy.ts', { ...sharedDependencies, 'next/server': next })
    .proxy as (request: InstanceType<typeof next.NextRequest>) => InstanceType<typeof next.NextResponse>
  const frameAncestors = async () => {
    const request = () => new next.NextRequest('https://example.com/backend', { headers: { host: 'example.com' } })
    return [await mainProxy(request()), templateProxy(request())].map((response) =>
      response.headers.get('Content-Security-Policy')!.split('; ').find((directive) => directive.startsWith('frame-ancestors ')))
  }
  try {
    delete process.env.OM_DEV_SERVER_LOOPBACK_FRAMING
    assert.deepEqual(await frameAncestors(), ["frame-ancestors 'self'", "frame-ancestors 'self'"])
    process.env.OM_DEV_SERVER_LOOPBACK_FRAMING = '1'
    const loopback = "frame-ancestors 'self' http://localhost:* http://127.0.0.1:*"
    assert.deepEqual(await frameAncestors(), [loopback, loopback])
  } finally {
    if (previous === undefined) delete process.env.OM_DEV_SERVER_LOOPBACK_FRAMING
    else process.env.OM_DEV_SERVER_LOOPBACK_FRAMING = previous
  }
})
