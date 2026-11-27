import { expect, test } from '@playwright/test'
import { assertBoardDirectoryAccess, assertTaskDraft, boardCopy, prepareBoardScenario, enterTaskDraft, openBoard } from './helpers/taskBoard'

export const integrationMeta = { dependsOnModules: ['auth', 'customers'] }

for (const persona of ['manager', 'employee'] as const) {
  const locale = persona === 'manager' ? 'en' : 'pl'
  test.describe(`TC-STAFF-052: ${persona} resets only a closed lifecycle or changed project`, () => {
    const run = prepareBoardScenario(persona, { secondProject: true })
    test('starts a fresh draft after Escape, Cancel, and a project change', async ({ page }, testInfo) => run(page, testInfo, async ({ page, fixture, baseURL }) => {
      const surface = await openBoard(page, fixture, locale, baseURL, { global: true })
      try {
        const copy = boardCopy(locale)
        const discarded = await enterTaskDraft(page, locale, 'Discarded old project draft', 'Working A')
        await discarded.getByRole('textbox', { name: copy.title, exact: true }).press('Escape')
        await expect(discarded).toHaveCount(0)
        await page.getByRole('button', { name: copy.newTask, exact: true }).click()
        await assertTaskDraft(page, locale, '', 'Ready A')
        const dialog = page.getByRole('dialog', { name: copy.dialog, exact: true })
        await expect(dialog.getByRole('button', { name: copy.create, exact: true })).toBeDisabled()
        await dialog.getByRole('textbox', { name: copy.title, exact: true }).fill('Distinct draft discarded by Cancel')
        await dialog.getByRole('combobox', { name: copy.status, exact: true }).click()
        await page.getByRole('option', { name: 'Working A', exact: true }).click()
        await expect(page.getByRole('listbox')).toHaveCount(0)
        await assertTaskDraft(page, locale, 'Distinct draft discarded by Cancel', 'Working A')
        await dialog.getByRole('button', { name: copy.cancel, exact: true }).click()
        await expect(dialog).toHaveCount(0)
        await page.getByRole('button', { name: copy.newTask, exact: true }).click()
        await assertTaskDraft(page, locale, '', 'Ready A')
        await expect(dialog.getByRole('button', { name: copy.create, exact: true })).toBeDisabled()
        await dialog.getByRole('button', { name: copy.cancel, exact: true }).click()
        if (!fixture.secondProject) throw new Error('[internal] second owned project unavailable')
        await page.getByRole('combobox', { name: locale === 'pl' ? 'Projekt' : 'Project', exact: true }).click()
        await page.getByRole('option', { name: fixture.secondProject.name, exact: true }).click()
        await expect(page).toHaveURL(new RegExp(`projectId=${fixture.secondProject.id}`))
        await page.getByRole('button', { name: copy.newTask, exact: true }).click()
        await assertTaskDraft(page, locale, '', 'Ready B')
        await expect(page.getByRole('dialog').getByRole('button', { name: copy.create, exact: true })).toBeDisabled()
        await assertBoardDirectoryAccess(page, surface, persona)
      } finally {
        await surface.dispose()
      }
    }))
  })
}
