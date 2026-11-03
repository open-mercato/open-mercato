import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createFixedTemplateInput, readPublicPayLink } from './helpers/fixtures'

type Scope = { tenantId: string; organizationId: string }
type LinkFixture = Scope & { id: string; slug: string; title: string; status: 'draft' | 'inactive' | 'active' }

function scopeHeaders(scope: Scope) {
  return { Cookie: `om_selected_tenant=${scope.tenantId}; om_selected_org=${scope.organizationId}` }
}

test.describe('TC-CHKT-045: Checkout preview tenant and organization isolation', () => {
  const label = `checkout-preview-${randomUUID()}`
  const password = `Qa-${randomUUID()}-Aa1!`
  const email = `${label}@example.com`
  const tenantIds: string[] = []
  const organizationIds: string[] = []
  const links: LinkFixture[] = []
  let superadminToken: string | null = null
  let roleId: string | null = null
  let userId: string | null = null
  let ownScope: Scope
  let viewerToken: string

  test.beforeAll(async ({ request }) => {
    superadminToken = await getAuthToken(request, 'superadmin')
    for (const suffix of ['a', 'b']) {
      const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token: superadminToken,
        data: { name: `${label}-${suffix}` },
      })
      const body = await readJsonSafe<{ id?: string }>(response)
      expect(response.status()).toBe(201)
      tenantIds.push(expectId(body?.id, 'Tenant fixture must have an id'))
    }
    for (const tenantId of [tenantIds[0], tenantIds[0], tenantIds[1]]) {
      organizationIds.push(await createOrganizationFixture(request, superadminToken, {
        name: `${label}-org-${organizationIds.length}`,
        tenantId,
      }))
    }
    ownScope = { tenantId: tenantIds[0], organizationId: organizationIds[0] }
    const scopes: Scope[] = [
      ownScope,
      { tenantId: tenantIds[0], organizationId: organizationIds[1] },
      { tenantId: tenantIds[1], organizationId: organizationIds[2] },
    ]
    roleId = await createRoleFixture(request, superadminToken, { name: label, tenantId: ownScope.tenantId })
    await setRoleAclFeatures(request, superadminToken, {
      roleId,
      features: ['checkout.view'],
      organizations: [ownScope.organizationId],
    })
    userId = await createUserFixture(request, superadminToken, {
      email,
      password,
      organizationId: ownScope.organizationId,
      roles: [roleId],
    })
    viewerToken = await getAuthToken(request, email, password)

    for (const scope of scopes) {
      for (const status of ['draft', 'inactive', 'active'] as const) {
        const title = `${label}-${links.length}`
        const response = await apiRequest(request, 'POST', '/api/checkout/links', {
          token: superadminToken,
          headers: scopeHeaders(scope),
          data: createFixedTemplateInput({ status, title, password, collectCustomerDetails: false }),
        })
        const body = await readJsonSafe<{ id?: string; slug?: string }>(response)
        expect(response.status()).toBe(201)
        links.push({
          ...scope,
          id: expectId(body?.id, 'Link fixture must have an id'),
          slug: expectId(body?.slug, 'Link fixture must have a slug'),
          title,
          status,
        })
      }
    }

  })

  test('limits a checkout.view user to same-scope previews and preserves public gates', async ({ request }) => {
    for (const link of links) {
      const preview = await apiRequest(request, 'GET', `/api/checkout/pay/${encodeURIComponent(link.slug)}?preview=true`, {
        token: viewerToken,
      })
      if (link.tenantId === ownScope.tenantId && link.organizationId === ownScope.organizationId) {
        expect(preview.status(), `Same-scope ${link.status} preview`).toBe(200)
        expect(await readJsonSafe(preview)).toMatchObject({
          id: link.id, title: link.title, preview: true, available: false, requiresPassword: false,
        })
      } else {
        expect(preview.status(), `Foreign-scope ${link.status} preview`).toBe(404)
        expect(await readJsonSafe(preview)).toEqual({ error: 'Payment link not found' })
      }

      const publicResponse = await readPublicPayLink(request, link.slug)
      if (link.status === 'active') {
        expect(publicResponse.status()).toBe(200)
        expect(await readJsonSafe(publicResponse)).toEqual({ requiresPassword: true, title: link.title })
      } else {
        expect(publicResponse.status()).toBe(404)
      }
    }
  })

  test.afterAll(async ({ request }) => {
    if (superadminToken) {
      for (const link of links.reverse()) {
        await apiRequest(request, 'DELETE', `/api/checkout/links/${encodeURIComponent(link.id)}`, {
          token: superadminToken,
          headers: scopeHeaders(link),
        }).catch(() => undefined)
      }
    }
    await deleteUserIfExists(request, superadminToken, userId)
    await deleteRoleIfExists(request, superadminToken, roleId)
    for (const organizationId of organizationIds.reverse()) {
      await deleteOrganizationIfExists(request, superadminToken, organizationId)
    }
    for (const tenantId of tenantIds.reverse()) {
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', tenantId)
    }
  })
})
