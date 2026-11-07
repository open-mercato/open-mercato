import { expect, test } from '@playwright/test'
import { assertBoardDirectoryAccess, boardCopy, prepareBoardScenario, enterTaskDraft, openBoard, saveAndReopenTask } from './helpers/taskBoard'

export const integrationMeta = { dependsOnModules: ['auth', 'customers'] }

for (const persona of ['manager', 'employee'] as const) {
  const locale = persona === 'manager' ? 'en' : 'pl'
  test.describe(`TC-STAFF-053: ${persona} submits a long title by keyboard on the mobile global board`, () => {
    const run = prepareBoardScenario(persona)
    test('keeps mobile controls reachable and persists a keyboard submission', async ({ page }, testInfo) => run(page, testInfo, async ({ page, fixture, baseURL, testInfo }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      const surface = await openBoard(page, fixture, locale, baseURL, { global: true })
      try {
        const copy = boardCopy(locale)
        const title = `Mobile Żółć ${'Draft remains readable across the project workflow. '.repeat(3)}${fixture.projectId.slice(0, 8)}`
        const dialog = await enterTaskDraft(page, locale, title, 'Working A')
        await expect(dialog.getByRole('button', { name: copy.cancel, exact: true })).toBeInViewport({ ratio: 1 })
        await expect(dialog.getByRole('button', { name: copy.create, exact: true })).toBeInViewport({ ratio: 1 })
        await page.screenshot({ path: testInfo.outputPath('mobile-keyboard-draft.png'), fullPage: true })
        await saveAndReopenTask(page, fixture, locale, title, fixture.chosenStatusId, 'Working A', { keyboard: true })
        await assertBoardDirectoryAccess(page, surface, persona)
      } finally {
        await surface.dispose()
      }
    }))
  })
}
