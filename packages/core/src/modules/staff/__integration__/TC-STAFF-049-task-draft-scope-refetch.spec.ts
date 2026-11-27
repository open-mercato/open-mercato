import { expect, test } from '@playwright/test'
import { assertBoardDirectoryAccess, assertTaskDraft, boardCopy, prepareBoardScenario, enterTaskDraft, openBoard, saveAndReopenTask, type BoardLocale } from './helpers/taskBoard'

export const integrationMeta = { dependsOnModules: ['auth', 'customers'] }

for (const persona of ['manager', 'employee'] as const) {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const locale: BoardLocale = attempt % 2 === 0 ? 'pl' : 'en'
    test.describe(`TC-STAFF-049: ${persona} ${locale} cold-scope draft ${attempt}/10`, () => {
      const run = prepareBoardScenario(persona)
      test('preserves and persists every submitted field', async ({ page }, testInfo) => run(page, testInfo, async ({ page, fixture, baseURL, testInfo }) => {
        const surface = await openBoard(page, fixture, locale, baseURL, { coldScope: true })
        try {
          const copy = boardCopy(locale)
          await page.getByRole('button', { name: copy.filters, exact: true }).click()
          await page.keyboard.press('Escape')
          const title = `PR8830 ${persona} ${locale} ${attempt} Żółć ${fixture.projectId.slice(0, 8)}`
          await enterTaskDraft(page, locale, title, 'Working A')
          expect(surface.statusRequests).toBe(1)
          await surface.releaseScope()
          expect(surface.statusRequests, 'Cold scope settlement must cause a real second status GET').toBe(2)
          await assertTaskDraft(page, locale, title, 'Working A')
          if (attempt === 10) await page.screenshot({ path: testInfo.outputPath('preserved-cold-scope-draft.png'), fullPage: true })
          await saveAndReopenTask(page, fixture, locale, title, fixture.chosenStatusId, 'Working A')
          await assertBoardDirectoryAccess(page, surface, persona)
        } finally {
          await surface.dispose()
        }
      }))
    })
  }
}
