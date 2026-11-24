import { randomUUID } from 'node:crypto'
import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test'
import {
  createActivityFixture, expectActivityCount, expectLoginToken, firefoxLinux, signIn,
} from './helpers/signInActivityFixtures'
import { setAuthCookie } from './helpers/securityFixtures'

type Fixture = Awaited<ReturnType<typeof createActivityFixture>>
type Actor = Awaited<ReturnType<Fixture['createActor']>>
let fixtureRequest: APIRequestContext | undefined
let fixture: Fixture
let actor: Actor
let token: string

test.beforeAll(async ({ baseURL }) => {
  fixtureRequest = await playwrightRequest.newContext({ baseURL })
  fixture = await createActivityFixture(fixtureRequest)
  actor = await fixture.createActor()
  await signIn({ ...actor, password: `Wrong1!${randomUUID()}` }, { status: 401 })
  token = expectLoginToken(await signIn(actor))
  await expectActivityCount(fixtureRequest, fixture.adminToken, { userId: actor.userId }, 2)
})

test.afterAll(async () => {
  try {
    await fixture?.dispose()
  } finally {
    await fixtureRequest?.dispose()
  }
})

test('TC-SEC-019: filters sign-in failures and opens their details', async ({ page, baseURL }, testInfo) => {
  if (!baseURL) throw new Error('[internal] Browser integration tests require a base URL')
  await page.context().addCookies([{ name: 'om_selected_org', value: actor.organizationId, url: baseURL }])
  await setAuthCookie(page, fixture.adminToken)
  await page.goto(`/backend/security/sign-ins?userId=${actor.userId}`)
  await expect(page.getByRole('heading', { name: 'Sign-in activity' })).toBeVisible()
  await page.getByRole('button', { name: 'Filters' }).click()
  await page.getByRole('main').getByRole('combobox').nth(1).click()
  await page.getByRole('option', { name: 'Failed', exact: true }).click()
  await page.getByRole('button', { name: 'Apply', exact: true }).first().click()
  const row = page.getByRole('row').filter({ hasText: actor.email })
  await expect(row).toHaveCount(1)
  await expect(row.getByText('Failed', { exact: true })).toBeVisible()
  await testInfo.attach('Admin sign-in activity', {
    body: await page.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  })
  await row.getByRole('button', { name: 'View sign-in details' }).click()
  const drawer = page.getByRole('dialog', { name: 'Sign-in details' })
  await expect(drawer.getByText(firefoxLinux)).toBeVisible()
  await expect(drawer.getByRole('link', { name: 'Open user security' })).toBeVisible()
  await testInfo.attach('Admin sign-in detail', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
  await page.keyboard.press('Escape')
  await expect(drawer).not.toBeVisible()
})

test('TC-SEC-019: shows recent sign-ins in the personal security profile', async ({ page }, testInfo) => {
  await setAuthCookie(page, token)
  await page.goto('/backend/profile/security')
  const recentSignIns = page.getByRole('heading', { name: 'Recent sign-ins' })
  await expect(recentSignIns).toBeVisible()
  await recentSignIns.scrollIntoViewIfNeeded()
  await expect(page.getByText('Firefox', { exact: false }).first()).toBeVisible()
  await testInfo.attach('Profile recent sign-ins', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
})

test('TC-SEC-019: a delegated sign-in auditor cannot navigate to user security', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('[internal] Browser integration tests require a base URL')
  const auditor = await fixture.createActor({ isAdmin: true })
  const auditorToken = expectLoginToken(await signIn(auditor))
  if (!fixtureRequest) throw new Error('[internal] Sign-in activity fixture is unavailable')
  await expectActivityCount(fixtureRequest, fixture.adminToken, { userId: auditor.userId }, 1)
  await page.context().addCookies([{ name: 'om_selected_org', value: auditor.organizationId, url: baseURL }])
  await setAuthCookie(page, auditorToken)
  await page.goto(`/backend/security/sign-ins?userId=${auditor.userId}`)
  const row = page.getByRole('row').filter({ hasText: auditor.email })
  const permission = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/feature-check')
    && response.request().postDataJSON()?.features?.includes('security.admin.manage'),
  )
  await row.getByRole('button', { name: 'View sign-in details' }).click()
  expect(await (await permission).json()).toMatchObject({ ok: false })
  const drawer = page.getByRole('dialog', { name: 'Sign-in details' })
  await expect(drawer.getByRole('link', { name: 'All sign-ins for this user' })).toBeVisible()
  await expect(drawer.getByRole('link', { name: 'Open user security' })).toHaveCount(0)
})
