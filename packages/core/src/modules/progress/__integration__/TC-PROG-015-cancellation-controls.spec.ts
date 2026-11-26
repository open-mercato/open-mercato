import { expect, test, type Browser, type Page } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import { setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { getCapturedOmEvents, installOmEventCollector } from '@open-mercato/core/helpers/integration/sseEventCollector'
import {
  PROGRESS_FEATURES,
  createProgressJob,
  createProgressUserWithFeatures,
  deleteProgressUser,
  progressJobPath,
  uniqueJobName,
  type RestrictedProgressUser,
} from './helpers/progress'

async function openProgressPage(browser: Browser, baseURL: string, user: RestrictedProgressUser, locale: 'en' | 'pl') {
  const { organizationId, tenantId } = getTokenContext(user.token)
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } })
  try {
    await context.addCookies([
      { name: 'auth_token', value: user.token, url: baseURL, httpOnly: true },
      { name: 'om_selected_org', value: organizationId, url: baseURL },
      { name: 'om_selected_tenant', value: tenantId, url: baseURL },
      { name: 'locale', value: locale, url: baseURL },
    ])
    const page = await context.newPage()
    await acknowledgeGlobalNotices(page)
    await page.goto('/backend', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/backend(?:\/|$)/)
    return page
  } catch (error) {
    await context.close()
    throw error
  }
}

function jobCard(page: Page, name: string) {
  return page.locator('div.rounded-md.border.bg-card').filter({ has: page.getByText(name, { exact: true }) })
}

test('TC-PROG-015: job cancellation controls follow the current user’s capability', async ({ browser, baseURL, request }, testInfo) => {
  if (!baseURL) throw new Error('[internal] Playwright baseURL is required')
  const adminToken = await getAuthToken(request, 'admin')
  const { tenantId, organizationId } = getTokenContext(adminToken)
  const users: RestrictedProgressUser[] = []
  const pages: Page[] = []
  let jobId: string | undefined
  const jobName = uniqueJobName('QA progress cancellation control with a long job title')
  const { view, create, cancel, manage } = PROGRESS_FEATURES

  async function provision(features: string[], label: string) {
    const user = await withCredentialIsolatedRequest((isolated) => createProgressUserWithFeatures(isolated, adminToken, features, label))
    users.push(user)
    return user
  }

  try {
    const owner = await provision([view, create, cancel], 'control owner')
    const viewer = await provision([view, cancel], 'control viewer')
    const manager = await provision([view, cancel, manage], 'control manager')
    const id = await withCredentialIsolatedRequest((isolated) => createProgressJob(isolated, owner.token, {
      name: jobName,
      totalCount: 25,
      meta: { fixture: jobName },
    }))
    jobId = id
    const path = progressJobPath(id)
    const readJob = async () => {
      const response = await apiRequest(request, 'GET', path, { token: adminToken })
      expect(response.status()).toBe(200)
      return readJsonSafe<Record<string, unknown>>(response)
    }
    const before = await readJob()
    expect(before).toMatchObject({ status: 'pending', name: jobName })

    const openJob = async (user: RestrictedProgressUser, locale: 'en' | 'pl') => {
      const page = await openProgressPage(browser, baseURL, user, locale)
      pages.push(page)
      const summary = page.getByRole('button', { name: locale === 'pl' ? /operacji w toku/ : /operations running/ })
      await summary.click()
      const card = jobCard(page, jobName)
      await expect(card).toBeVisible()
      return { page, card, control: card.getByRole('button', { name: locale === 'pl' ? 'Anuluj' : 'Cancel', exact: true }) }
    }
    const [ownerView, viewerView, managerView] = await Promise.all([
      openJob(owner, 'pl'),
      openJob(viewer, 'en'),
      openJob(manager, 'en'),
    ])

    await expect(ownerView.control).toBeVisible()
    await expect(viewerView.control).toHaveCount(0)
    await expect(managerView.control).toBeVisible()
    const ownerButton = await ownerView.control.boundingBox()
    if (!ownerButton) throw new Error('[internal] Visible Cancel control has no bounding box')
    expect(ownerButton.x).toBeGreaterThanOrEqual(0)
    expect(ownerButton.x + ownerButton.width).toBeLessThanOrEqual(390)
    await expect(viewerView.card.getByText('0 / 25', { exact: true })).toBeVisible()

    await testInfo.attach('polish-cancellation-control-390px', {
      body: await jobCard(ownerView.page, jobName).screenshot(),
      contentType: 'image/png',
    })
    await installOmEventCollector(viewerView.page)
    await viewerView.page.waitForFunction(() =>
      (window as Window & { __omEventBridgeReady?: boolean }).__omEventBridgeReady === true,
    )

    const refused = await apiRequest(request, 'DELETE', path, { token: viewer.token })
    expect(refused.status()).toBe(400)
    expect(await readJob()).toEqual(before)

    const cancelRoute = `**${path}`
    const waitForCancellation = (page: Page) => page.waitForResponse((response) =>
      response.url().endsWith(path) && response.request().method() === 'DELETE',
    )
    await ownerView.page.route(cancelRoute, async (route) => {
      await setRoleAclFeatures(request, adminToken, { roleId: owner.roleId, features: [view, create] })
      await route.continue()
    }, { times: 1 })
    const stale = waitForCancellation(ownerView.page)
    await ownerView.control.click()
    expect((await stale).status()).toBe(403)
    await expect(ownerView.control).toHaveCount(0)
    expect(await readJob()).toEqual(before)

    await managerView.page.route(cancelRoute, (route) => route.fulfill({
      status: 503,
      json: { error: 'Temporary test failure' },
    }), { times: 1 })
    const failed = waitForCancellation(managerView.page)
    await managerView.control.click()
    expect((await failed).status()).toBe(503)
    await expect(managerView.control).toBeEnabled()
    expect(await readJob()).toEqual(before)

    const cancelled = waitForCancellation(managerView.page)
    await managerView.control.click()
    expect((await cancelled).ok()).toBe(true)
    await expect(viewerView.card).toBeVisible()
    await expect(viewerView.card.getByText('0 / 25', { exact: true })).toHaveCount(0)
    await expect.poll(async () => (await getCapturedOmEvents(viewerView.page)).some((event) =>
      event.id === 'progress.job.cancelled' && event.payload?.jobId === id,
    )).toBe(true)
    const terminal = await readJob()
    expect(terminal).toMatchObject({ status: 'cancelled', name: jobName, meta: { fixture: jobName } })
    const duplicate = await apiRequest(request, 'DELETE', path, { token: manager.token })
    expect(duplicate.ok()).toBe(true)
    expect(await readJob()).toEqual(terminal)
  } finally {
    await Promise.allSettled(pages.map((page) => page.context().close()))
    try {
      if (jobId) {
        await withClient((client) => client.query(
          'delete from progress_jobs where id = $1 and tenant_id = $2 and organization_id = $3',
          [jobId, tenantId, organizationId],
        ))
      }
    } finally {
      await Promise.all(users.map((user) => deleteProgressUser(request, adminToken, user)))
    }
  }
})
