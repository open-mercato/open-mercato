import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
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
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteAttachmentIfExists,
  uploadAttachmentFixture,
} from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import {
  createCheckoutClientHeaders,
  createFixedTemplateInput,
  createLinkFixture,
  createTemplateFixture,
  deleteCheckoutEntityIfExists,
  readPublicPayLink,
  updateLink,
  updateTemplate,
} from './helpers/fixtures'

/**
 * TC-CHKT-044: the pay page's logo loads for an anonymous visitor.
 *
 * The public pay payload used to point `logoPreviewUrl` at
 * `/api/attachments/image/{id}`, which refuses every anonymous read of a
 * tenant-scoped attachment (401), so an uploaded logo never rendered on a
 * published pay page. The logo is now served by `/api/checkout/pay/{slug}/logo`,
 * which reads the link's own logo by owner through the attachments service and
 * serves the 640x240 rendition the image pipeline produces.
 */

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

async function fetchLogo(request: APIRequestContext, path: string, headers?: Record<string, string>) {
  return request.get(`${BASE_URL}${path}`, { headers: createCheckoutClientHeaders(headers) })
}

async function readLogoUrl(request: APIRequestContext, slug: string): Promise<string> {
  const response = await readPublicPayLink(request, slug)
  expect(response.status()).toBe(200)
  const payload = await readJsonSafe<{ logoPreviewUrl?: string | null }>(response)
  expect(payload).not.toHaveProperty('logoAttachmentId')
  expect(payload).not.toHaveProperty('gatewaySettings')
  return expectId(payload?.logoPreviewUrl, 'Pay payload must have a logo URL')
}

async function expectRenderedLogo(page: Page, title: string, src: string) {
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  const logo = page.getByRole('img', { name: title, exact: true })
  await expect(logo).toBeVisible()
  await expect(logo).toHaveAttribute('src', src)
  await expect(logo).toHaveJSProperty('naturalWidth', 640)
  await expect(logo).toHaveJSProperty('naturalHeight', 240)
}

test.describe('TC-CHKT-044: public pay link logo', () => {
  test('renders link and template logos for anonymous visitors', async ({ page, request }) => {
    const token = await getAuthToken(request)
    const attachmentIds: string[] = []
    const linkIds: string[] = []
    let templateId: string | null = null

    try {
      const ownTitle = `Checkout logo ${randomUUID()}`
      const ownLink = await createLinkFixture(request, token, createFixedTemplateInput({ title: ownTitle, status: 'active' }))
      linkIds.push(ownLink.id)
      const ownLogo = await uploadAttachmentFixture(request, token, {
        entityId: 'checkout:checkout_link',
        recordId: ownLink.id,
        fileName: 'logo.png',
        mimeType: 'image/png',
        buffer: PNG,
      })
      attachmentIds.push(ownLogo.id)
      expect((await updateLink(request, token, ownLink.id, { logoAttachmentId: ownLogo.id, status: 'active' })).ok()).toBeTruthy()

      const ownLogoUrl = await readLogoUrl(page.request, ownLink.slug)
      expect(ownLogoUrl).toBe(`/api/checkout/pay/${encodeURIComponent(ownLink.slug)}/logo`)
      const ownLogoResponse = await fetchLogo(page.request, ownLogoUrl)
      expect(ownLogoResponse.status()).toBe(200)
      expect(ownLogoResponse.headers()['content-type']).toBe('image/png')
      expect(Buffer.from(await ownLogoResponse.body()).subarray(0, 8)).toEqual(PNG.subarray(0, 8))

      await page.setViewportSize({ width: 390, height: 844 })
      await page.context().addCookies([{ name: 'locale', value: 'pl', url: BASE_URL }])
      await page.goto(`/pay/${encodeURIComponent(ownLink.slug)}`)
      await expectRenderedLogo(page, ownTitle, ownLogoUrl)
      await expect(page.getByText('Bezpieczna płatność', { exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)

      const legacyImageRoute = await fetchLogo(page.request, `/api/attachments/image/${encodeURIComponent(ownLogo.id)}`)
      expect(legacyImageRoute.status()).toBe(401)

      const inheritedTitle = `Checkout template logo ${randomUUID()}`
      templateId = await createTemplateFixture(request, token, createFixedTemplateInput({ title: inheritedTitle }))
      const templateLogo = await uploadAttachmentFixture(request, token, {
        entityId: 'checkout:checkout_link_template',
        recordId: templateId,
        fileName: 'template-logo.png',
        mimeType: 'image/png',
        buffer: PNG,
      })
      attachmentIds.push(templateLogo.id)
      expect((await updateTemplate(request, token, templateId, { logoAttachmentId: templateLogo.id })).ok()).toBeTruthy()
      const inheritingLink = await createLinkFixture(request, token, createFixedTemplateInput({ templateId, title: inheritedTitle, status: 'active' }))
      linkIds.push(inheritingLink.id)
      const inheritedLogoUrl = await readLogoUrl(page.request, inheritingLink.slug)
      await page.goto(`/pay/${encodeURIComponent(inheritingLink.slug)}`)
      await expectRenderedLogo(page, inheritedTitle, inheritedLogoUrl)

      const borrowingLink = await createLinkFixture(request, token, createFixedTemplateInput({ status: 'active' }))
      linkIds.push(borrowingLink.id)
      expect((await updateLink(request, token, borrowingLink.id, { logoAttachmentId: ownLogo.id, status: 'active' })).ok()).toBeTruthy()
      const borrowedResponse = await fetchLogo(page.request, `/api/checkout/pay/${encodeURIComponent(borrowingLink.slug)}/logo`)
      expect(borrowedResponse.status()).toBe(404)

      expect((await updateLink(request, token, ownLink.id, { status: 'draft' })).ok()).toBeTruthy()
      const unpublishedResponse = await fetchLogo(page.request, `/api/checkout/pay/${encodeURIComponent(ownLink.slug)}/logo`)
      expect(unpublishedResponse.status()).toBe(404)
    } finally {
      for (const linkId of linkIds) await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
      await deleteCheckoutEntityIfExists(request, token, 'templates', templateId)
      for (const attachmentId of attachmentIds) await deleteAttachmentIfExists(request, token, attachmentId)
    }
  })

  test('shows a draft logo only in an authorized preview and handles missing logos', async ({ page, request }) => {
    const token = await getAuthToken(request)
    const linkIds: string[] = []
    let attachmentId: string | null = null

    try {
      const noLogoTitle = `Checkout without a logo ${randomUUID()}`
      const noLogoLink = await createLinkFixture(request, token, createFixedTemplateInput({ title: noLogoTitle, status: 'active' }))
      linkIds.push(noLogoLink.id)
      await page.goto(`/pay/${encodeURIComponent(noLogoLink.slug)}`)
      await expect(page.getByRole('heading', { name: noLogoTitle, exact: true })).toBeVisible()
      await expect(page.getByRole('img', { name: noLogoTitle, exact: true })).toHaveCount(0)
      expect((await fetchLogo(page.request, `/api/checkout/pay/${encodeURIComponent(noLogoLink.slug)}/logo`)).status()).toBe(404)

      await page.context().addCookies([{ name: 'locale', value: 'pl', url: BASE_URL }])
      await page.goto(`/pay/missing-${randomUUID()}`)
      await expect(page.getByText('Nie udało się załadować linku płatności', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Ponów', exact: true })).toBeVisible()

      const draftTitle = `Draft checkout logo ${randomUUID()}`
      const draft = await createLinkFixture(request, token, createFixedTemplateInput({ title: draftTitle }))
      linkIds.push(draft.id)
      const attachment = await uploadAttachmentFixture(request, token, {
        entityId: 'checkout:checkout_link',
        recordId: draft.id,
        fileName: 'draft-logo.png',
        mimeType: 'image/png',
        buffer: PNG,
      })
      attachmentId = attachment.id
      expect((await updateLink(request, token, draft.id, { logoAttachmentId: attachmentId })).ok()).toBeTruthy()

      const publicLogoPath = `/api/checkout/pay/${encodeURIComponent(draft.slug)}/logo`
      const previewLogoPath = `${publicLogoPath}?preview=true`
      expect((await fetchLogo(page.request, publicLogoPath)).status()).toBe(404)
      expect((await fetchLogo(page.request, previewLogoPath)).status()).toBe(401)

      await page.context().addCookies([{ name: 'auth_token', value: token, url: BASE_URL }])
      expect((await fetchLogo(page.request, publicLogoPath)).status()).toBe(404)
      const [logoResponse] = await Promise.all([
        page.waitForResponse((response) => response.url() === `${BASE_URL}${previewLogoPath}`),
        page.goto(`/pay/${encodeURIComponent(draft.slug)}?preview=true`),
      ])
      expect(logoResponse.status()).toBe(200)
      expect(logoResponse.headers()['cache-control']).toBe('private, no-store')
      await expectRenderedLogo(page, draftTitle, previewLogoPath)
    } finally {
      for (const linkId of linkIds) await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
      await deleteAttachmentIfExists(request, token, attachmentId)
    }
  })

  test('denies preview logos to users without the required feature or scope', async ({ page, request }) => {
    const adminToken = await getAuthToken(request)
    const superadminToken = await getAuthToken(request, 'superadmin')
    const owner = getTokenScope(adminToken)
    const label = `checkout-logo-scope-${randomUUID()}`
    const password = `Qa-${randomUUID()}-Aa1!`
    const organizationIds: string[] = []
    const roleIds: string[] = []
    const userIds: string[] = []
    let tenantId: string | null = null
    let linkId: string | null = null
    let attachmentId: string | null = null

    try {
      const draftTitle = `Private checkout logo ${randomUUID()}`
      const draft = await createLinkFixture(request, adminToken, createFixedTemplateInput({ title: draftTitle }))
      linkId = draft.id
      const attachment = await uploadAttachmentFixture(request, adminToken, {
        entityId: 'checkout:checkout_link',
        recordId: draft.id,
        fileName: 'scoped-logo.png',
        mimeType: 'image/png',
        buffer: PNG,
      })
      attachmentId = attachment.id
      expect((await updateLink(request, adminToken, draft.id, { logoAttachmentId: attachmentId })).ok()).toBeTruthy()
      const previewPath = `/api/checkout/pay/${encodeURIComponent(draft.slug)}/logo?preview=true`
      expect((await fetchLogo(page.request, previewPath, { Authorization: `Bearer ${adminToken}` })).status()).toBe(200)

      const tenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token: superadminToken,
        data: { name: label },
      })
      expect(tenantResponse.status()).toBe(201)
      tenantId = expectId((await readJsonSafe<{ id?: string }>(tenantResponse))?.id, 'Owned tenant id')
      for (const [name, orgTenantId] of [['organization', owner.tenantId], ['tenant', tenantId]]) {
        organizationIds.push(await createOrganizationFixture(request, superadminToken, {
          name: `${label}-${name}`,
          tenantId: orgTenantId,
        }))
      }

      const actors = [
        { name: 'narrow', tenantId: owner.tenantId, organizationId: owner.organizationId, features: ['attachments.view'], status: 403 },
        { name: 'other-organization', tenantId: owner.tenantId, organizationId: organizationIds[0], features: ['checkout.view'], status: 404 },
        { name: 'other-tenant', tenantId, organizationId: organizationIds[1], features: ['checkout.view'], status: 404 },
      ]
      for (const actor of actors) {
        const email = `${label}-${actor.name}@example.test`
        const roleId = await createRoleFixture(request, superadminToken, {
          name: `${label}-${actor.name}`,
          tenantId: actor.tenantId,
        })
        roleIds.push(roleId)
        await setRoleAclFeatures(request, superadminToken, {
          roleId,
          features: actor.features,
          organizations: [actor.organizationId],
        })
        const userId = await createUserFixture(request, superadminToken, {
          email, password, organizationId: actor.organizationId, roles: [roleId],
        })
        userIds.push(userId)
        const actorToken = await getAuthToken(request, email, password)
        expect(getTokenScope(actorToken)).toEqual({ userId, tenantId: actor.tenantId, organizationId: actor.organizationId })

        await page.context().clearCookies({ name: 'auth_token' })
        const bearerResponse = await fetchLogo(page.request, previewPath, { Authorization: `Bearer ${actorToken}` })
        expect(bearerResponse.status(), `${actor.name} bearer preview`).toBe(actor.status)
        await page.context().addCookies([{ name: 'auth_token', value: actorToken, url: BASE_URL }])
        expect((await fetchLogo(page.request, previewPath)).status(), `${actor.name} browser-cookie preview`).toBe(actor.status)
        if (actor.status === 403) {
          await page.goto(`/pay/${encodeURIComponent(draft.slug)}?preview=true`)
          await expect(page.getByText('Forbidden', { exact: true })).toBeVisible()
          await expect(page.getByRole('heading', { name: draftTitle, exact: true })).toHaveCount(0)
          await expect(page.getByRole('img', { name: draftTitle, exact: true })).toHaveCount(0)
        }
      }
    } finally {
      await deleteCheckoutEntityIfExists(request, adminToken, 'links', linkId)
      await deleteAttachmentIfExists(request, adminToken, attachmentId)
      for (const userId of userIds.reverse()) await deleteUserIfExists(request, superadminToken, userId)
      for (const roleId of roleIds.reverse()) await deleteRoleIfExists(request, superadminToken, roleId)
      for (const organizationId of organizationIds.reverse()) await deleteOrganizationIfExists(request, superadminToken, organizationId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', tenantId)
    }
  })
})
