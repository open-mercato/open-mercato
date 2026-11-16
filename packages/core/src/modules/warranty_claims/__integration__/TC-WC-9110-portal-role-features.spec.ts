import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCustomerCompanyFixture,
  createCustomerRoleFixture,
  createCustomerUserFixture,
  deleteCustomerCompanyFixture,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { cancelThenDeleteClaimIfPossible, createClaimFixture } from './helpers'
import plDict from '../i18n/pl.json'

const portalBase = '/api/warranty_claims/portal'

for (const role of ['viewer', 'restricted', 'buyer'] as const) {
  test(`TC-WC-9110: ${role} portal permissions cover every warranty endpoint`, async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(token)
    const companyId = await createCustomerCompanyFixture(request, token)
    let roleId: string | null = null
    let userId: string | null = null
    const claimIds: string[] = []
    try {
      const features = role === 'restricted' ? ['portal.account.manage'] : [
        'portal.account.manage', 'portal.orders.view', 'portal.warranty_claims.view',
        ...(role === 'buyer' ? ['portal.warranty_claims.manage'] : []),
      ]
      roleId = (await createCustomerRoleFixture(request, token, { features })).id
      const user = await createCustomerUserFixture(request, token, { customerEntityId: companyId, roleIds: [roleId] })
      userId = user.id
      const headers = portalCookieHeaders(await portalLogin(request, { ...user, tenantId }))
      const claim = await createClaimFixture(request, token, {
        claimType: 'warranty', customerId: companyId, reasonCode: 'defective',
        lines: [{ lineNo: 1, faultDescription: 'Issue 9110 authorization fixture', qtyClaimed: 1 }],
      })
      const claimId = claim.id!
      claimIds.push(claimId)
      const readPaths = [
        '/claims', `/claims/${claimId}`, `/events?claimId=${claimId}`,
        `/attachments?claimId=${claimId}`, '/options', '/troubleshooting', '/orders',
      ]
      for (const path of readPaths) {
        expect((await request.get(`${portalBase}${path}`, { headers })).status(), `${role} GET ${path}`).toBe(role === 'restricted' ? 403 : 200)
      }
      const orderLines = await request.get(`${portalBase}/orders/lines?orderId=${randomUUID()}`, { headers })
      expect(orderLines.status()).toBe(role === 'restricted' ? 403 : 404)
      const attachmentId = randomUUID()
      const writes = [
        { method: 'POST', path: '/claims', data: {} },
        { method: 'POST', path: `/claims/${claimId}/submit`, data: {} },
        { method: 'POST', path: `/claims/${claimId}/withdraw`, data: {} },
        { method: 'POST', path: '/events', data: {} },
        { method: 'POST', path: '/attachments', data: {} },
        { method: 'PUT', path: '/attachments', data: {} },
        { method: 'DELETE', path: `/attachments?attachmentId=${attachmentId}`, data: {} },
      ]
      if (role !== 'buyer') {
        for (const write of writes) {
          expect((await request.fetch(`${portalBase}${write.path}`, { method: write.method, data: write.data, headers })).status(), `${role} ${write.method} ${write.path}`).toBe(403)
        }
        const detail = await request.get(`/api/warranty_claims?id=${claimId}`, { headers: { Authorization: `Bearer ${token}` } })
        const body = await readJsonSafe<{ items: Array<{ status: string }> }>(detail)
        expect(body?.items[0]?.status).toBe('draft')
      } else {
        const intake = await request.post(`${portalBase}/claims`, {
          headers,
          data: { reasonCode: 'defective', lines: [{ faultDescription: 'Buyer still submits', qtyClaimed: 1 }] },
        })
        expect(intake.status()).toBe(201)
        const created = await readJsonSafe<{ claimId: string }>(intake)
        expect(created?.claimId).toBeTruthy()
        claimIds.push(created!.claimId)
        const createdDetail = await request.get(`${portalBase}/claims/${created!.claimId}`, { headers })
        expect((await readJsonSafe<{ item: { status: string } }>(createdDetail))?.item.status).toBe('submitted')
        expect((await request.post(`${portalBase}/claims/${claimId}/submit`, { headers })).status()).toBe(200)
        expect((await request.post(`${portalBase}/claims/${claimId}/withdraw`, { headers })).status()).toBe(200)
      }
    } finally {
      for (const claimId of claimIds.reverse()) await cancelThenDeleteClaimIfPossible(request, token, claimId)
      if (userId) await deleteCustomerUserFixture(request, token, userId)
      if (roleId) await deleteCustomerRoleFixture(request, token, roleId)
      await deleteCustomerCompanyFixture(request, token, companyId)
    }
  })
}

for (const role of ['viewer', 'buyer'] as const) {
  test(`TC-WC-9110: ${role} portal controls respect permissions and preserve action recovery`, async ({ request, browser }, testInfo) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(token)
    const companyId = await createCustomerCompanyFixture(request, token)
    let roleId: string | null = null
    let userId: string | null = null
    let claimId: string | null = null
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL })
    try {
      roleId = (await createCustomerRoleFixture(request, token, {
        features: ['portal.account.manage', 'portal.warranty_claims.view', ...(role === 'buyer' ? ['portal.warranty_claims.manage'] : [])],
      })).id
      const user = await createCustomerUserFixture(request, token, { customerEntityId: companyId, roleIds: [roleId] })
      userId = user.id
      const session = await portalLogin(request, { ...user, tenantId })
      const headers = portalCookieHeaders(session)
      const organizationResponse = await request.get(`/api/directory/organizations?view=manage&ids=${organizationId}&tenantId=${tenantId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(organizationResponse.status()).toBe(200)
      const organization = await readJsonSafe<{ items: Array<{ slug: string }> }>(organizationResponse)
      const orgSlug = organization?.items[0]?.slug
      expect(orgSlug).toBeTruthy()
      const claim = await createClaimFixture(request, token, {
        claimType: 'warranty', customerId: companyId, reasonCode: 'defective',
        lines: [{ lineNo: 1, faultDescription: 'Portal recovery regression', qtyClaimed: 1 }],
      })
      claimId = claim.id!
      const baseURL = testInfo.project.use.baseURL!
      await context.addCookies([
        { name: 'customer_auth_token', value: session.authToken, url: baseURL, sameSite: 'Lax' },
        { name: 'customer_session_token', value: session.sessionToken, url: baseURL, sameSite: 'Lax' },
        { name: 'locale', value: 'en', url: baseURL, sameSite: 'Lax' },
      ])
      const page = await context.newPage()
      await page.setViewportSize({ width: 390, height: 844 })
      const detailPath = `/api/warranty_claims/portal/claims/${claimId}`
      await page.goto(`/${orgSlug}/portal/claims/${claimId}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByText(claim.claimNumber!, { exact: true })).toBeVisible()
      if (role === 'viewer') {
        await expect(page.getByRole('button', { name: 'Submit claim', exact: true })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Withdraw claim', exact: true })).toHaveCount(0)
        await expect(page.getByRole('textbox')).toHaveCount(0)
        await expect(page.locator('input[type="file"]')).toHaveCount(0)
        const before = await request.get(detailPath, { headers })
        const beforeBody = await readJsonSafe<unknown>(before)
        expect((await request.post(`${detailPath}/submit`, { headers })).status()).toBe(403)
        expect((await request.post(`${portalBase}/events`, { headers, data: { claimId, body: 'Refused viewer comment' } })).status()).toBe(403)
        expect(await readJsonSafe<unknown>(await request.get(detailPath, { headers }))).toEqual(beforeBody)
        await page.screenshot({ path: testInfo.outputPath('viewer-read-only-mobile.png'), fullPage: true })
      } else {
        const submitTrigger = page.getByRole('button', { name: 'Submit claim', exact: true })
        const withdrawTrigger = page.getByRole('button', { name: 'Withdraw claim', exact: true })
        for (const trigger of [submitTrigger, withdrawTrigger]) {
          await expect(trigger).toBeVisible()
          const bounds = await trigger.boundingBox()
          expect(bounds).not.toBeNull()
          expect(bounds!.x).toBeGreaterThanOrEqual(0)
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
          const isUnclipped = await trigger.evaluate((element) => {
            const bounds = element.getBoundingClientRect()
            return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2))
          })
          expect(isUnclipped).toBe(true)
        }
        await page.screenshot({ path: testInfo.outputPath('buyer-actions-mobile.png'), fullPage: true })
        await context.addCookies([{ name: 'locale', value: 'pl', url: baseURL, sameSite: 'Lax' }])
        await page.reload({ waitUntil: 'domcontentloaded' })
        const polishWithdraw = page.getByRole('button', { name: plDict['warranty_claims.portal.detail.withdraw'], exact: true })
        await expect(polishWithdraw).toBeVisible()
        expect(await polishWithdraw.evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          return bounds.x >= 0 && bounds.right <= window.innerWidth
            && element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2))
        })).toBe(true)
        await page.screenshot({ path: testInfo.outputPath('buyer-actions-polish-mobile.png'), fullPage: true })
        await context.addCookies([{ name: 'locale', value: 'en', url: baseURL, sameSite: 'Lax' }])
        await page.reload({ waitUntil: 'domcontentloaded' })
        await expect(submitTrigger).toBeEnabled()
        await page.route(`**${detailPath}/submit`, (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
        await submitTrigger.click()
        const dialog = page.getByRole('dialog')
        await dialog.press('Control+Enter')
        await expect(page.getByText('The claim could not be submitted.', { exact: true })).toBeVisible()
        await dialog.press('Escape')
        await expect(dialog).toHaveCount(0)
        await expect(submitTrigger).toBeFocused()
        await page.unroute(`**${detailPath}/submit`)
        const comment = page.getByRole('textbox')
        await comment.fill('Own comment should refresh the claim version before submitting')
        const commentResponse = page.waitForResponse((response) => response.url().endsWith(`${portalBase}/events`) && response.request().method() === 'POST')
        await page.getByRole('button', { name: 'Send', exact: true }).click()
        expect((await commentResponse).status()).toBe(200)
        await expect(submitTrigger).toBeEnabled()
        const current = await readJsonSafe<{ item: { updatedAt: string } }>(await request.get(detailPath, { headers }))
        const actionResponse = page.waitForResponse((response) => response.url().endsWith(`${detailPath}/submit`) && response.request().method() === 'POST')
        await submitTrigger.click()
        await page.getByRole('dialog').press('Control+Enter')
        const submitted = await actionResponse
        expect(submitted.request().headers()['x-om-ext-optimistic-lock-expected-updated-at']).toBe(current?.item.updatedAt)
        expect(submitted.status()).toBe(200)
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await expect(submitTrigger).toHaveCount(0)
      }
    } finally {
      await context.close()
      await cancelThenDeleteClaimIfPossible(request, token, claimId)
      if (userId) await deleteCustomerUserFixture(request, token, userId)
      if (roleId) await deleteCustomerRoleFixture(request, token, roleId)
      await deleteCustomerCompanyFixture(request, token, companyId)
    }
  })
}
