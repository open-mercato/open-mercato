/** @jest-environment node */

import path from 'path'
import fs from 'fs'

const moduleDir = path.join(__dirname, '..')

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(moduleDir, relativePath), 'utf8')
}

// Rendering `window.location.origin` inside a client component makes the
// server-rendered HTML disagree with the hydrated output: the portal address
// paints as `/[org-slug]/portal`, React logs a hydration error, and the text
// visibly corrects itself to the full URL a frame later.
const CLIENT_SURFACES = [
  'backend/customer_accounts/users/PortalUsersPageClient.tsx',
  'backend/customer_accounts/users/[id]/PortalUserDetailPageClient.tsx',
  'backend/customer_accounts/settings/CustomerAccountsSettingsPageClient.tsx',
]

const ROUTE_ENTRYPOINTS = [
  'backend/customer_accounts/users/page.tsx',
  'backend/customer_accounts/users/[id]/page.tsx',
  'backend/customer_accounts/settings/page.tsx',
]

describe('customer_accounts portal address hydration (regression for issue #5457)', () => {
  it.each(CLIENT_SURFACES)('%s never derives the portal address from window.location', (surface) => {
    expect(readSource(surface)).not.toMatch(/window\.location/)
  })

  it.each(ROUTE_ENTRYPOINTS)('%s resolves the origin on the server before rendering', (entrypoint) => {
    const source = readSource(entrypoint)
    expect(source).not.toMatch(/^["']use client["']/m)
    expect(source).toContain("import { headers } from 'next/headers'")
    expect(source).toMatch(/resolvePortalRequestOrigin\(await headers\(\)\)/)
    expect(source).toMatch(/portalOrigin=\{portalOrigin\}/)
  })

  // The `om-ds/require-page-wrapper` DS rule wants the page shell in the route
  // file, and there is no per-line opt-out — so the server wrappers own it and
  // the client bodies return fragments.
  it.each(ROUTE_ENTRYPOINTS)('%s owns the Page/PageBody shell', (entrypoint) => {
    const source = readSource(entrypoint)
    expect(source).toContain("import { Page, PageBody } from '@open-mercato/ui/backend/Page'")
    expect(source).toMatch(/<Page>/)
    expect(source).toMatch(/<PageBody/)
  })

  it.each(CLIENT_SURFACES)('%s no longer renders its own Page shell', (surface) => {
    const source = readSource(surface)
    expect(source).not.toMatch(/<Page>/)
    expect(source).not.toMatch(/<PageBody/)
  })

  it.each(CLIENT_SURFACES)('%s takes the resolved origin as a prop', (surface) => {
    const source = readSource(surface)
    expect(source).toMatch(/portalOrigin: string/)
    expect(source).toMatch(/from '(?:\.\.\/)+lib\/portalUrl'/)
  })
})

// The "Open Portal" action linked to `${origin}/portal`, but portal pages only
// exist under `frontend/[orgSlug]/portal/**`, so the link always 404'd.
const PORTAL_LINK_SURFACES = [
  {
    entrypoint: 'backend/customer_accounts/users/page.tsx',
    client: 'backend/customer_accounts/users/PortalUsersPageClient.tsx',
  },
  {
    entrypoint: 'backend/customer_accounts/settings/page.tsx',
    client: 'backend/customer_accounts/settings/CustomerAccountsSettingsPageClient.tsx',
  },
]

describe('customer_accounts "Open Portal" link (regression for issue #5668)', () => {
  it.each(PORTAL_LINK_SURFACES)('$entrypoint resolves the organization slug on the server', ({ entrypoint }) => {
    const source = readSource(entrypoint)
    expect(source).toMatch(/resolveCurrentOrgPortalSlug\(\)/)
    expect(source).toMatch(/portalOrgSlug=\{portalOrgSlug\}/)
  })

  it.each(PORTAL_LINK_SURFACES)('$client takes the slug as a prop and never links without it', ({ client }) => {
    const source = readSource(client)
    expect(source).toMatch(/portalOrgSlug\?: string \| null/)
    expect(source).toMatch(/buildPortalRootUrl\(portalOrigin, portalOrgSlug\)/)
    // A slugless call would rebuild the 404 link this regression is about.
    expect(source).not.toMatch(/buildPortalRootUrl\(portalOrigin\)/)
  })

  // The slug resolver reaches for the EntityManager, so it must stay out of the
  // module client components import — otherwise the ORM lands in the browser bundle.
  it('keeps the ORM-backed slug lookup out of the client-imported portalUrl module', () => {
    const source = readSource('lib/portalUrl.ts')
    expect(source).not.toMatch(/@mikro-orm/)
    expect(source).not.toMatch(/organizationLookup/)
  })
})
