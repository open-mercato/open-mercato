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
    expect(source).toMatch(/resolveRequestOrigin\(await headers\(\)\)/)
    expect(source).toMatch(/portalOrigin=\{portalOrigin\}/)
  })

  it.each(CLIENT_SURFACES)('%s takes the resolved origin as a prop', (surface) => {
    const source = readSource(surface)
    expect(source).toMatch(/portalOrigin: string/)
    expect(source).toMatch(/from '(?:\.\.\/)+lib\/portalUrl'/)
  })
})
