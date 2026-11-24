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
