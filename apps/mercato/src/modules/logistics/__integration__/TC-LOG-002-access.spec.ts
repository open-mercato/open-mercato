import { expectAccessDenied, expectPlannedPage, sections, test } from './helpers/fixtures'

test.describe('Logistics effective permissions', () => {
  for (const section of sections) {
    test(`denies ${section.title} without logistics.view`, async ({ page, logistics }) => {
      await logistics.grant([])
      await page.goto(section.path)
      await expectAccessDenied(page)
    })
  }

  for (const wildcard of ['logistics.*', '*']) {
    test(`${wildcard} grants all seven pages`, async ({ page, logistics }) => {
      await logistics.grant([wildcard])
      for (const section of sections) {
        await page.goto(section.path)
        await expectPlannedPage(page, section)
      }
    })
  }

  test('retains a second role wildcard until the last effective grant is revoked', async ({ page, logistics }) => {
    await logistics.grant(['logistics.*'], [logistics.organizationId], true)
    await page.goto(sections[0].path)
    await expectPlannedPage(page, sections[0])
    await logistics.grant([])
    await page.reload()
    await expectPlannedPage(page, sections[0])
    await logistics.grant([], [logistics.organizationId], true)
    for (const section of sections) {
      await page.goto(section.path)
      await expectAccessDenied(page)
    }
  })
})
