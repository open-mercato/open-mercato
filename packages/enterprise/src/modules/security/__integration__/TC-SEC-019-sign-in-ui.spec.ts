import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  createActivityFixture, expectActivityCount, expectLoginToken, firefoxLinux, signIn,
} from './helpers/signInActivityFixtures'
import { setAuthCookie } from './helpers/securityFixtures'

test('TC-SEC-019: filters sign-in failures, opens their details, and shows personal history', async ({ request, page }, testInfo) => {
  const fixture = await createActivityFixture(request)
  try {
    const actor = await fixture.createActor()
    await signIn({ ...actor, password: `Wrong1!${randomUUID()}` }, { status: 401 })
    const token = expectLoginToken(await signIn(actor))
    await expectActivityCount(request, fixture.adminToken, { userId: actor.userId }, 2)

    await setAuthCookie(page, fixture.adminToken)
    await page.goto(`/backend/security/sign-ins?userId=${actor.userId}`)
    await expect(page.getByRole('heading', { name: 'Sign-in activity' })).toBeVisible()
    await page.getByRole('button', { name: 'Filters' }).click()
    await page.getByText('Result', { exact: true }).last().locator('../..').getByRole('combobox').click()
    await page.getByRole('option', { name: 'Failed', exact: true }).click()
    await page.getByRole('button', { name: 'Apply', exact: true }).first().click()
    const row = page.getByRole('row').filter({ hasText: actor.email })
    await expect(row).toHaveCount(1)
    await expect(row.getByText('Failed', { exact: true })).toBeVisible()
    await row.getByRole('button', { name: 'View sign-in details' }).click()
    const drawer = page.getByRole('dialog', { name: 'Sign-in details' })
    await expect(drawer.getByText(firefoxLinux)).toBeVisible()
    await testInfo.attach('Admin sign-in detail', { body: await page.screenshot(), contentType: 'image/png' })
    await page.keyboard.press('Escape')
    await expect(drawer).not.toBeVisible()

    await setAuthCookie(page, token)
    await page.goto('/backend/profile/security')
    await expect(page.getByRole('heading', { name: 'Recent sign-ins' })).toBeVisible()
    await expect(page.getByText('Firefox', { exact: false }).first()).toBeVisible()
    await testInfo.attach('Profile recent sign-ins', { body: await page.screenshot(), contentType: 'image/png' })
  } finally {
    await fixture.dispose()
  }
})
